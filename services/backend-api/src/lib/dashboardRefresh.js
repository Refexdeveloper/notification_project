'use strict';

/**
 * Soft refresh for dashboards:
 * - Related application users only (APP_ROLE + assignees) — no full Kissflow directory
 * - Live item counts via Admin Get-all-items (same as engagement refresh)
 * - Persists engagement_cache + upserts last_sign_in onto engagement_reporting."user"
 * Does not run full schedule-runner email ingest.
 */

const { getPool } = require('./db');
const { fetchLiveAppMetrics } = require('./kissflowLiveMetrics');
const { loadDashboardOverview } = require('./dashboardOverview');
const { loadApplicationDashboard } = require('./appDashboard');
const { isP2pApplication, loadP2pDashboard } = require('./p2pDashboard');
const {
  isEngagementCacheFresh,
  loadApplicationEngagementCache,
  ttlForApplication,
} = require('./engagementCache');

async function upsertUserLastSignIns(pool, environment, users) {
  if (!Array.isArray(users) || !users.length) return 0;
  let updated = 0;
  for (const row of users) {
    const userId = String(row.user_id || '').trim();
    if (!userId) continue;
    const lastSignIn = row.last_sign_in || null;
    const ever = Boolean(row.ever_logged_in || lastSignIn);
    const email = row.email || null;
    const name = row.user_name || null;
    const activeStatus = row.active_status || (row.is_active === false ? 'Inactive' : 'Active');
    const company = row.company || null;
    const companyKey = row.company_key || null;
    try {
      // Update the newest existing user row only (FK requires snapshot_run_id for inserts).
      const result = await pool.query(
        `UPDATE engagement_reporting."user" u
         SET last_sign_in = CASE
               WHEN $3::timestamptz IS NULL THEN u.last_sign_in
               WHEN u.last_sign_in IS NULL OR u.last_sign_in < $3::timestamptz THEN $3::timestamptz
               ELSE u.last_sign_in
             END,
             ever_logged_in = CASE WHEN $4 THEN true ELSE COALESCE(u.ever_logged_in, false) END,
             user_name = COALESCE(NULLIF($5, ''), u.user_name),
             email = COALESCE(NULLIF(lower(trim($6)), ''), u.email),
             active_status = COALESCE(NULLIF($7, ''), u.active_status),
             source_payload = COALESCE(u.source_payload, '{}'::jsonb)
               || jsonb_strip_nulls(jsonb_build_object(
                 'company', NULLIF($8, ''),
                 'company_key', NULLIF($9, ''),
                 'is_active', CASE WHEN $7 = 'Inactive' THEN false ELSE true END
               ))
         WHERE u.environment = $1
           AND u.user_id = $2
           AND u.snapshot_at = (
             SELECT max(u2.snapshot_at)
             FROM engagement_reporting."user" u2
             WHERE u2.environment = $1 AND u2.user_id = $2
           )`,
        [environment, userId, lastSignIn, ever, name, email, activeStatus, company, companyKey],
      );
      updated += result.rowCount || 0;
    } catch {
      // Best-effort; engagement_cache still holds the values for the UI.
    }
  }
  return updated;
}

async function listCurrentApps(pool, environment, applicationId) {
  if (applicationId) {
    const { rows } = await pool.query(
      `SELECT application_id, application_name
       FROM engagement_reporting.application
       WHERE environment = $1 AND application_id = $2 AND is_current = true
       LIMIT 1`,
      [environment, applicationId],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT application_id, application_name
     FROM engagement_reporting.application
     WHERE environment = $1 AND is_current = true
     ORDER BY application_name`,
    [environment],
  );
  return rows;
}

/**
 * @param {{ environment?: string, applicationId?: string, persist?: boolean, live?: boolean }} opts
 * Default is cache-first (incremental engagement_cache). Set live=true for Kissflow Get-all-items.
 */
async function refreshDashboardLive(opts = {}) {
  const environment = opts.environment || 'production';
  const applicationId = opts.applicationId ? String(opts.applicationId).trim() : '';
  const persist = opts.persist !== false;
  const liveKissflow = opts.live === true;
  const pool = getPool();
  const apps = await listCurrentApps(pool, environment, applicationId || null);

  if (!liveKissflow) {
    if (applicationId) {
      try {
        const cached = await loadApplicationEngagementCache(pool, environment, applicationId);
        const ttl = ttlForApplication(applicationId);
        if (!isEngagementCacheFresh(cached, ttl)) {
          void fetchLiveAppMetrics(environment, applicationId, { persistCache: persist }).catch((err) => {
            console.warn('[dashboard-refresh] background live overlay failed', applicationId, err.message || err);
          });
        }
      } catch {
        /* cache miss is fine — GET below still paints from SQL/cache */
      }
    }
    let overview = null;
    let appDashboard = null;
    try {
      overview = await loadDashboardOverview(pool, environment);
    } catch (err) {
      overview = { error: err.message };
    }
    if (applicationId) {
      try {
        if (isP2pApplication(applicationId)) {
          appDashboard = await loadP2pDashboard({ environment, period: 'all', entity: 'all' });
        } else {
          appDashboard = await loadApplicationDashboard(pool, {
            environment,
            applicationId,
            period: 'all',
            preferCache: true,
            allowStaleCache: true,
          });
        }
      } catch (err) {
        appDashboard = { error: err.message };
      }
    }
    return {
      environment,
      refreshed_at: new Date().toISOString(),
      mode: 'incremental_cache',
      note: 'Served from incremental engagement_cache. Kissflow live overlay runs in the background only when cache is stale.',
      application_count: apps.length,
      results: [],
      applications: Array.isArray(overview) ? overview : undefined,
      application_dashboard: appDashboard && !appDashboard.error ? appDashboard : undefined,
      warnings: [
        ...(overview?.error ? [`overview: ${overview.error}`] : []),
        ...(appDashboard?.error ? [`application: ${appDashboard.error}`] : []),
      ],
    };
  }

  const results = [];
  // Limit concurrency so Cloud Run stays responsive.
  const queue = [...apps];
  const workers = Math.min(2, queue.length || 1);

  async function worker() {
    while (queue.length) {
      const app = queue.shift();
      if (!app) return;
      const entry = {
        application_id: app.application_id,
        application_name: app.application_name,
        ok: false,
        error: null,
        metrics: null,
        users_upserted: 0,
      };
      try {
        const live = await fetchLiveAppMetrics(environment, app.application_id, {
          persistCache: persist,
        });
        entry.ok = true;
        entry.metrics = live.metrics;
        entry.item_count = live.item_count;
        entry.live_user_count = live.live_user_count;
        entry.fetched_at = live.fetched_at;
        if (persist && Array.isArray(live.users)) {
          entry.users_upserted = await upsertUserLastSignIns(pool, environment, live.users);
        }
      } catch (err) {
        entry.error = err.message || String(err);
      }
      results.push(entry);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));

  let overview = null;
  let appDashboard = null;
  try {
    overview = await loadDashboardOverview(pool, environment);
  } catch (err) {
    overview = { error: err.message };
  }
  if (applicationId) {
    try {
      if (isP2pApplication(applicationId)) {
        appDashboard = await loadP2pDashboard({ environment, period: 'all', entity: 'all' });
      } else {
        appDashboard = await loadApplicationDashboard(pool, {
          environment,
          applicationId,
          period: 'all',
          preferCache: true,
          allowStaleCache: false,
        });
      }
    } catch (err) {
      appDashboard = { error: err.message };
    }
  }

  return {
    environment,
    refreshed_at: new Date().toISOString(),
    mode: 'incremental_live_overlay',
    note: 'Related app users + live item counts. No full directory dump. Snapshot rows update on scheduled ingest.',
    application_count: apps.length,
    results,
    applications: Array.isArray(overview) ? overview : undefined,
    application_dashboard: appDashboard && !appDashboard.error ? appDashboard : undefined,
    warnings: [
      ...(overview?.error ? [`overview: ${overview.error}`] : []),
      ...results.filter((r) => !r.ok).map((r) => `${r.application_id}: ${r.error}`),
    ],
  };
}

module.exports = {
  refreshDashboardLive,
  upsertUserLastSignIns,
};
