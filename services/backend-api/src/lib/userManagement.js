'use strict';

/**
 * Cross-application user management for CEO/CTO view.
 * PostgreSQL only (no BigQuery in this stack).
 */

const { isLoggedInToday } = require('./reportTimezone');
const { resolvePersonDisplayName, friendlyApplicationName } = require('./dashboardDisplay');
const { latestRunsCte } = require('./snapshotRuns');
const { isP2pConfigured } = require('./p2pReadonly');
const { loadP2pDashboard } = require('./p2pDashboard');

const USER_MGMT_SQL = `
WITH apps AS (
  SELECT application_id, application_name
  FROM engagement_reporting.application
  WHERE environment = $1 AND is_current = true
),
procs AS (
  SELECT application_id, process_id
  FROM engagement_reporting.process
  WHERE environment = $1 AND is_current = true
),
${latestRunsCte({ environmentParam: '$1', alias: 'latest_runs' })},
members AS (
  SELECT DISTINCT
    pu.user_id,
    pu.application_id,
    a.application_name
  FROM engagement_reporting.principal_user pu
  INNER JOIN apps a ON a.application_id = pu.application_id
  WHERE pu.environment = $1
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
),
ranked_user AS (
  SELECT
    m.user_id,
    COALESCE(NULLIF(trim(u.user_name), ''), NULLIF(trim(u.email), ''), m.user_id) AS user_name,
    NULLIF(lower(trim(u.email)), '') AS email,
    u.last_sign_in,
    u.ever_logged_in,
    ROW_NUMBER() OVER (
      PARTITION BY m.user_id
      ORDER BY u.last_sign_in DESC NULLS LAST, u.snapshot_at DESC
    ) AS rn
  FROM (SELECT DISTINCT user_id FROM members) m
  LEFT JOIN engagement_reporting."user" u
    ON u.environment = $1 AND u.user_id = m.user_id
),
classified_items AS (
  SELECT
    p.application_id,
    NULLIF(lower(trim(COALESCE(
      NULLIF(trim(i.requester_email), ''),
      NULLIF(trim(i.source_payload->>'Requested_Email'), ''),
      NULLIF(trim(i.source_payload->'Requester'->>'Email'), ''),
      NULLIF(trim(i.source_payload->'_created_by'->>'Email'), ''),
      NULLIF(trim(i.source_payload->'Assigned_To'->>'Email'), ''),
      NULLIF(trim(i.source_payload->'AssignedTo'->>'Email'), ''),
      NULLIF(trim(i.source_payload->'Owner'->>'Email'), '')
    ))), '') AS email,
    CASE
      WHEN i.process_status IN ('Withdrawn')
        OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
        THEN 'rejected'
      WHEN i.process_status IN ('Completed', 'Closed')
        OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled')
        OR (
          p.application_id = 'IT_Service_Management_A00'
          AND lower(coalesce(i.process_status, '')) IN ('inprogress', 'in progress', 'in-progress')
          AND (
            lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
            OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%reopen window%'
            OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%employee feedback%'
          )
        )
        THEN 'closed'
      ELSE 'open'
    END AS status_bucket
  FROM engagement_reporting.item i
  INNER JOIN latest_runs lr
    ON i.snapshot_run_id = lr.snapshot_run_id
   AND i.process_id = lr.process_id
  INNER JOIN procs p ON p.process_id = i.process_id
  WHERE i.environment = $1
),
item_stats AS (
  SELECT
    application_id,
    email,
    COUNT(*) FILTER (WHERE status_bucket = 'open')::int AS open_count,
    COUNT(*) FILTER (WHERE status_bucket = 'closed')::int AS closed_count,
    COUNT(*) FILTER (WHERE status_bucket = 'rejected')::int AS rejected_count
  FROM classified_items
  WHERE email IS NOT NULL
  GROUP BY application_id, email
)
SELECT
  ru.user_id,
  ru.user_name,
  ru.email,
  ru.last_sign_in,
  ru.ever_logged_in,
  COALESCE((
    SELECT json_agg(json_build_object(
      'application_id', m.application_id,
      'application_name', m.application_name,
      'open', COALESCE(st.open_count, 0),
      'closed', COALESCE(st.closed_count, 0),
      'rejected', COALESCE(st.rejected_count, 0)
    ) ORDER BY m.application_name)
    FROM members m
    LEFT JOIN item_stats st
      ON st.application_id = m.application_id
     AND st.email IS NOT NULL
     AND st.email = ru.email
    WHERE m.user_id = ru.user_id
  ), '[]'::json) AS applications
FROM ranked_user ru
WHERE ru.rn = 1
ORDER BY ru.user_name ASC NULLS LAST
`;

async function loadUserManagement(pool, environment = 'production') {
  const client = await pool.connect();
  try {
    await client.query('SET LOCAL statement_timeout = 45000');
    const { rows } = await client.query(USER_MGMT_SQL, [environment]);
    const byId = new Map();

    function upsert(row) {
      const id = String(row.user_id || '').trim();
      const display = resolvePersonDisplayName(row.user_name, row.email, id);
      if (!id || !display) return;
      const name = display;
      const key = id;
      const apps = Array.isArray(row.applications) ? row.applications : [];
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, {
          user_id: id,
          user_name: name,
          email: row.email || '',
          last_sign_in: row.last_sign_in || null,
          signed_in_today: isLoggedInToday(row.last_sign_in),
          ever_logged_in: Boolean(row.ever_logged_in || row.last_sign_in),
          applications: [...apps],
        });
        return;
      }
      // Prefer richer name / newer sign-in
      if (name && (existing.user_name === existing.user_id || name.length > existing.user_name.length)) {
        existing.user_name = name;
      }
      if (row.email && !existing.email) existing.email = row.email;
      if (row.last_sign_in && (!existing.last_sign_in || new Date(row.last_sign_in) > new Date(existing.last_sign_in))) {
        existing.last_sign_in = row.last_sign_in;
        existing.signed_in_today = isLoggedInToday(row.last_sign_in);
      }
      existing.ever_logged_in = existing.ever_logged_in || Boolean(row.ever_logged_in || row.last_sign_in);
      const appMap = new Map(existing.applications.map((a) => [a.application_id, a]));
      for (const a of apps) {
        const prev = appMap.get(a.application_id);
        if (!prev) appMap.set(a.application_id, { ...a });
        else {
          prev.open = Math.max(Number(prev.open || 0), Number(a.open || 0));
          prev.closed = Math.max(Number(prev.closed || 0), Number(a.closed || 0));
          prev.rejected = Math.max(Number(prev.rejected || 0), Number(a.rejected || 0));
        }
      }
      existing.applications = [...appMap.values()];
    }

    for (const row of rows) upsert(row);

    // Merge live engagement_cache users (same source MIS tables use after Refresh).
    const { rows: cacheRows } = await client.query(
      `SELECT application_id, application_name,
              source_payload->'engagement_cache' AS engagement_cache
       FROM engagement_reporting.application
       WHERE environment = $1 AND is_current = true`,
      [environment],
    );
    for (const crow of cacheRows) {
      const cache = crow.engagement_cache;
      const list = Array.isArray(cache?.items) ? cache.items : [];
      for (const u of list) {
        upsert({
          user_id: u.user_id,
          user_name: u.user_name || u.email || u.user_id,
          email: u.email || '',
          last_sign_in: u.last_sign_in || null,
          ever_logged_in: Boolean(u.ever_logged_in || u.last_sign_in),
          applications: [
            {
              application_id: crow.application_id,
              application_name: crow.application_name,
              open: Number(u.open || 0),
              closed: Number(u.completed ?? u.closed ?? 0),
              rejected: Number(u.rejected || 0),
            },
          ],
        });
      }
    }

    // Attach P2P MySQL users (not present in Kissflow principal_user).
    if (isP2pConfigured()) {
      try {
        const p2p = await loadP2pDashboard({ environment, period: 'all' });
        const p2pAppId = 'Procurement_to_Pay_A00';
        const p2pAppName = 'Procurement to Pay';
        for (const u of p2p.users || []) {
          const id = String(u.user_id || u.email || '').trim();
          if (!id) continue;
          upsert({
            user_id: id,
            user_name: u.user_name || u.email || id,
            email: u.email || '',
            last_sign_in: u.last_sign_in || null,
            ever_logged_in: Boolean(u.last_sign_in),
            applications: [
              {
                application_id: p2pAppId,
                application_name: p2pAppName,
                open: Number(u.open ?? u.pending ?? 0),
                closed: Number(u.closed ?? u.completed ?? 0),
                rejected: Number(u.rejected || 0),
              },
            ],
          });
        }
      } catch {
        /* P2P optional */
      }
    }

    const items = [...byId.values()]
      .map((u) => {
        const applications = (u.applications || []).map((a) => ({
          ...a,
          application_name: friendlyApplicationName(a.application_id, a.application_name),
        }));
        const open = applications.reduce((s, a) => s + Number(a.open || 0), 0);
        const closed = applications.reduce((s, a) => s + Number(a.closed || 0), 0);
        const rejected = applications.reduce((s, a) => s + Number(a.rejected || 0), 0);
        return {
          ...u,
          applications,
          open,
          closed,
          rejected,
          total: open + closed + rejected,
        };
      })
      .sort((a, b) => {
        const denA = Number(a.open || 0) + Number(a.closed || 0);
        const denB = Number(b.open || 0) + Number(b.closed || 0);
        const ratioA = denA > 0 ? Number(a.closed || 0) / denA : 0;
        const ratioB = denB > 0 ? Number(b.closed || 0) / denB : 0;
        if (ratioB !== ratioA) return ratioB - ratioA;
        const totalDiff = Number(b.total || 0) - Number(a.total || 0);
        if (totalDiff) return totalDiff;
        return String(a.user_name).localeCompare(String(b.user_name));
      });

    return {
      environment,
      generated_at: new Date().toISOString(),
      count: items.length,
      totals: {
        total_users: items.length,
        active_today: items.filter((u) => u.signed_in_today).length,
        open: items.reduce((s, u) => s + u.open, 0),
        closed: items.reduce((s, u) => s + u.closed, 0),
        rejected: items.reduce((s, u) => s + u.rejected, 0),
      },
      items,
    };
  } finally {
    client.release();
  }
}

module.exports = { loadUserManagement };
