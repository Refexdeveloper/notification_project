'use strict';

/**
 * Fast main-dashboard aggregates from PostgreSQL snapshots,
 * with optional engagement_cache overlay when fresher (soft live).
 */

const { snapshotAgeHours, DEFAULT_REPORT_TIMEZONE, isSameCalendarDay } = require('./reportTimezone');
const { latestRunsCte } = require('./snapshotRuns');
const {
  isEngagementCacheFresh,
  ENGAGEMENT_CACHE_TTL_MS,
} = require('./engagementCache');
const {
  P2P_APPLICATION_ID,
  P2P_APPLICATION_NAME,
  isP2pApplication,
  loadP2pDashboard,
} = require('./p2pDashboard');
const { isP2pConfigured } = require('./p2pReadonly');
const { friendlyApplicationName } = require('./dashboardDisplay');

const OVERVIEW_QUERY = `
WITH apps AS (
  SELECT environment, application_id, application_name, source_payload
  FROM engagement_reporting.application
  WHERE is_current = true AND environment = $1
),
procs AS (
  SELECT p.application_id, p.process_id
  FROM engagement_reporting.process p
  WHERE p.is_current = true AND p.environment = $1
),
${latestRunsCte({ environmentParam: '$1', alias: 'latest_runs' })},
run_totals AS (
  SELECT
    p.application_id,
    SUM(lr.item_record_count)::int AS total_items,
    MAX(lr.snapshot_at) AS snapshot_at
  FROM latest_runs lr
  INNER JOIN procs p ON p.process_id = lr.process_id
  GROUP BY p.application_id
),
status_stats AS (
  SELECT
    p.application_id,
    COUNT(*) FILTER (
      WHERE
        CASE
          WHEN p.application_id = 'IT_Service_Management_A00' THEN
            i.process_status IN ('Completed', 'Closed')
            OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done')
            OR (
              lower(coalesce(i.process_status, '')) IN ('inprogress', 'in progress', 'in-progress')
              AND (
                lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
                OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%reopen window%'
                OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%employee feedback%'
              )
            )
          ELSE
            i.process_status IN ('Completed', 'Closed')
            OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled')
        END
    )::int AS closed_items,
    COUNT(*) FILTER (
      WHERE i.process_status IN ('Withdrawn')
         OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
    )::int AS rejected_items,
    COUNT(*) FILTER (
      WHERE p.application_id <> 'IT_Service_Management_A00'
        AND (
          lower(coalesce(i.process_status, '')) IN ('inprogress', 'in progress', 'in-progress')
          OR lower(coalesce(i.process_status, '')) LIKE '%progress%'
        )
        AND NOT (
          i.process_status IN ('Completed', 'Closed', 'Withdrawn')
          OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled')
          OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
        )
    )::int AS in_progress_items,
    COUNT(*) FILTER (
      WHERE
        CASE
          WHEN p.application_id = 'IT_Service_Management_A00' THEN
            NOT (
              i.process_status IN ('Withdrawn')
              OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
              OR i.process_status IN ('Completed', 'Closed')
              OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done')
              OR (
                lower(coalesce(i.process_status, '')) IN ('inprogress', 'in progress', 'in-progress')
                AND (
                  lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
                  OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%reopen window%'
                  OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%employee feedback%'
                )
              )
            )
          ELSE
            NOT (
              i.process_status IN ('Completed', 'Closed', 'Withdrawn')
              OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled', 'inprogress', 'in progress', 'in-progress')
              OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
              OR lower(coalesce(i.process_status, '')) LIKE '%progress%'
            )
        END
    )::int AS open_items
  FROM latest_runs lr
  INNER JOIN procs p ON p.process_id = lr.process_id
  INNER JOIN engagement_reporting.item i
    ON i.snapshot_run_id = lr.snapshot_run_id
   AND i.process_id = lr.process_id
   AND i.environment = $1
  GROUP BY p.application_id
),
user_stats AS (
  SELECT
    pu.application_id,
    COUNT(DISTINCT pu.user_id)::int AS total_users
  FROM engagement_reporting.principal_user pu
  WHERE pu.environment = $1
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
  GROUP BY pu.application_id
)
SELECT
  a.environment,
  a.application_id,
  a.application_name,
  a.source_payload,
  r.snapshot_at,
  COALESCE(u.total_users, 0)::int AS total_users,
  COALESCE(s.open_items, 0)::int AS open_tickets,
  COALESCE(s.in_progress_items, 0)::int AS in_progress,
  COALESCE(s.closed_items, 0)::int AS closed_tickets,
  COALESCE(s.rejected_items, 0)::int AS rejected,
  COALESCE(r.total_items, 0)::int AS total_items
FROM apps a
LEFT JOIN run_totals r ON r.application_id = a.application_id
LEFT JOIN status_stats s ON s.application_id = a.application_id
LEFT JOIN user_stats u ON u.application_id = a.application_id
ORDER BY a.application_name
`;

const OVERVIEW_SIGNIN_BY_APP_SQL = `
WITH members AS (
  SELECT pu.application_id, pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.environment = $1
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
),
ranked AS (
  SELECT
    m.application_id,
    m.user_id,
    u.last_sign_in,
    u.ever_logged_in,
    ROW_NUMBER() OVER (
      PARTITION BY m.application_id, m.user_id
      ORDER BY u.last_sign_in DESC NULLS LAST, u.snapshot_at DESC
    ) AS rn
  FROM members m
  LEFT JOIN engagement_reporting."user" u
    ON u.environment = $1 AND u.user_id = m.user_id
)
SELECT
  application_id,
  COUNT(*)::int AS total_users,
  COUNT(*) FILTER (
    WHERE last_sign_in IS NOT NULL
      AND (last_sign_in AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date
  )::int AS sign_in_today,
  COUNT(*) FILTER (
    WHERE ever_logged_in IS TRUE OR last_sign_in IS NOT NULL
  )::int AS ever_logged_in
FROM ranked
WHERE rn = 1
GROUP BY application_id
`;

const KF_TS = (col) => `CASE
  WHEN jsonb_typeof(${col}) = 'string' AND (${col} #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    CASE WHEN (${col} #>> '{}') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN (${col} #>> '{}')::timestamptz
         ELSE (${col} #>> '{}')::timestamp AT TIME ZONE 'Asia/Kolkata' END
  WHEN jsonb_typeof(${col}) = 'object' AND coalesce(${col}->>'v','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    CASE WHEN (${col}->>'v') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN (${col}->>'v')::timestamptz
         ELSE (${col}->>'v')::timestamp AT TIME ZONE 'Asia/Kolkata' END
  ELSE NULL
END`;

const ITEM_CREATED_AT = `COALESCE(
  ${KF_TS("i.source_payload->'_created_at'")},
  ${KF_TS("i.source_payload->'Requested_Date'")},
  ${KF_TS("i.source_payload->'Requester_Date__Time'")},
  ${KF_TS("i.source_payload->'_submitted_at'")},
  ${KF_TS("i.source_payload->'CreatedAt'")},
  ${KF_TS("i.source_payload->'Created_On'")},
  ${KF_TS("i.source_payload->'Lead_Created_Date'")}
)`;

const ITEM_COMPLETED_AT = `COALESCE(
  ${KF_TS("i.source_payload->'_completed_at'")},
  ${KF_TS("i.source_payload->'_closed_at'")},
  ${KF_TS("i.source_payload->'Completed_On'")},
  ${KF_TS("i.source_payload->'Closed_On'")},
  ${KF_TS("i.source_payload->'Completed_Date'")},
  ${KF_TS("i.source_payload->'Closed_Date'")},
  CASE
    WHEN i.process_status IN ('Completed', 'Closed')
      OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done')
      OR (
        p.application_id = 'IT_Service_Management_A00'
        AND i.process_status = 'InProgress'
        AND lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
      )
      OR lower(trim(coalesce(i.source_payload->>'Lead_Status', i.source_payload->>'Status', '')))
         IN ('close', 'closed', 'completed', 'done')
    THEN ${KF_TS("i.source_payload->'_modified_at'")}
    ELSE NULL
  END
)`;

const OVERVIEW_TODAY_BY_APP_SQL = `
WITH apps AS (
  SELECT DISTINCT application_id FROM engagement_reporting.process
  WHERE environment = $1 AND is_current = true
),
procs AS (
  SELECT application_id, process_id
  FROM engagement_reporting.process
  WHERE environment = $1 AND is_current = true
),
${latestRunsCte({ environmentParam: '$1', alias: 'latest_runs' })}
SELECT
  p.application_id,
  COUNT(*) FILTER (
    WHERE (${ITEM_CREATED_AT}) IS NOT NULL
      AND ((${ITEM_CREATED_AT}) AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date
  )::int AS opened_today,
  COUNT(*) FILTER (
    WHERE (${ITEM_COMPLETED_AT}) IS NOT NULL
      AND ((${ITEM_COMPLETED_AT}) AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date
  )::int AS closed_today
FROM engagement_reporting.item i
INNER JOIN latest_runs lr
  ON i.snapshot_run_id = lr.snapshot_run_id
 AND i.process_id = lr.process_id
INNER JOIN procs p ON p.process_id = i.process_id
WHERE i.environment = $1
GROUP BY p.application_id
`;

function isItsmLikeApplication(applicationId, applicationName) {
  const id = String(applicationId || '').toLowerCase();
  const name = String(applicationName || '').toLowerCase();
  return id.includes('itsm') || id.includes('service') || name.includes('itsm') || name.includes('service');
}

function readCache(sourcePayload) {
  const cache = sourcePayload && typeof sourcePayload === 'object' ? sourcePayload.engagement_cache : null;
  if (!cache || typeof cache !== 'object' || !cache.fetched_at) return null;
  return cache;
}

function metricsFromCachePayload(cache) {
  if (!cache || typeof cache !== 'object') return null;
  const totals = cache.totals && typeof cache.totals === 'object' ? cache.totals : {};
  const hasTotals =
    totals.open_tickets != null
    || totals.closed_tickets != null
    || totals.total_users != null;
  if (hasTotals) {
    return {
      open: Number(totals.open_tickets || 0),
      closed: Number(totals.closed_tickets || 0),
      rejected: Number(totals.rejected_tickets || totals.rejected || 0),
      total_users: Number(totals.total_users || 0),
      active_today: Number(totals.active_today || 0),
      never_logged_in: Number(totals.never_logged_in || 0),
      opened_today: Number(totals.opened_today || 0),
      closed_today: Number(totals.closed_today || 0),
    };
  }

  // Derive from cached records when totals were never written (failed refresh left empty totals).
  const records = Array.isArray(cache.records) ? cache.records : [];
  if (records.length) {
    let open = 0;
    let closed = 0;
    let rejected = 0;
    for (const r of records) {
      const s = String(r?.status || '').toLowerCase();
      if (s === 'closed') closed += 1;
      else if (s === 'rejected') rejected += 1;
      else open += 1;
    }
    const items = Array.isArray(cache.items) ? cache.items : [];
    return {
      open,
      closed,
      rejected,
      total_users: items.length || Number(totals.total_users || 0),
      active_today: Number(totals.active_today || 0),
      never_logged_in: Number(totals.never_logged_in || 0),
      opened_today: Number(totals.opened_today || 0),
      closed_today: Number(totals.closed_today || 0),
    };
  }

  const items = Array.isArray(cache.items) ? cache.items : [];
  if (items.length) {
    return {
      open: items.reduce((s, u) => s + Number(u.open || u.open_count || 0), 0),
      closed: items.reduce((s, u) => s + Number(u.completed || u.closed || u.completed_count || 0), 0),
      rejected: items.reduce((s, u) => s + Number(u.rejected || u.rejected_count || 0), 0),
      total_users: items.length,
      active_today: Number(totals.active_today || 0),
      never_logged_in: Number(totals.never_logged_in || 0),
      opened_today: Number(totals.opened_today || 0),
      closed_today: Number(totals.closed_today || 0),
    };
  }
  return null;
}

function overlayFromCache(row, signIn, today) {
  const cache = readCache(row.source_payload);
  const derived = metricsFromCachePayload(cache);
  const totals = cache?.totals || {};
  const cacheFresh = Boolean(cache) && isEngagementCacheFresh(cache, ENGAGEMENT_CACHE_TTL_MS);
  const cacheNewer =
    cache?.fetched_at &&
    (!row.snapshot_at || new Date(cache.fetched_at) > new Date(row.snapshot_at));

  const useCache = Boolean(derived) && (cacheFresh || cacheNewer || Boolean(cache?.fetched_at));
  const totalUsers = useCache && derived.total_users != null
    ? Number(derived.total_users)
    : Number(signIn.total_users ?? row.total_users ?? 0);
  const signInToday = useCache && derived.active_today != null
    ? Number(derived.active_today)
    : Number(signIn.sign_in_today || 0);
  const everLoggedIn = useCache && derived.total_users != null
    ? Math.max(0, totalUsers - Number(derived.never_logged_in || 0))
    : Number(signIn.ever_logged_in || 0);

  const openTickets = useCache
    ? Number(derived.open || 0)
    : row.application_id === 'IT_Service_Management_A00'
      ? Number(row.open_tickets || 0)
      : Number(row.open_tickets || 0) + Number(row.in_progress || 0);
  const closedTickets = useCache
    ? Number(derived.closed || 0)
    : Number(row.closed_tickets || 0);
  const openedToday = useCache
    ? Number(derived.opened_today || 0)
    : Number(today.opened_today || 0);
  const closedToday = useCache
    ? Number(derived.closed_today || 0)
    : Number(today.closed_today || 0);
  const rejected = useCache
    ? Number(derived.rejected || 0)
    : Number(row.rejected || 0);

  const snapshotAt = useCache && cache.fetched_at ? cache.fetched_at : row.snapshot_at || null;
  const dataSource = useCache ? 'live_overlay' : 'snapshot';

  return {
    totalUsers,
    signInToday,
    everLoggedIn,
    openTickets,
    closedTickets,
    openedToday,
    closedToday,
    inProgress: Number(row.in_progress || 0),
    rejected,
    snapshotAt,
    dataSource,
    cacheFresh: useCache,
  };
}

async function queryWithTimeout(pool, sql, params, timeoutMs = 12000) {
  const connectMs = Math.min(4000, timeoutMs);
  const client = await Promise.race([
    pool.connect(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('pool connect timeout')), connectMs);
    }),
  ]);
  try {
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, timeoutMs)}`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Fast main-dashboard landing: prefer engagement_cache; fall back to snapshot SQL
 * only for apps missing usable cache totals (bounded timeout).
 */
async function loadDashboardOverview(pool, environment) {
  const { rows } = await pool.query(
    `SELECT environment, application_id, application_name, source_payload
     FROM engagement_reporting.application
     WHERE is_current = true AND environment = $1
     ORDER BY application_name`,
    [environment],
  );

  const needsSnapshot = rows.some((row) => !metricsFromCachePayload(readCache(row.source_payload)));
  let snapshotByApp = new Map();
  let signInByApp = new Map();
  let todayByApp = new Map();

  if (needsSnapshot) {
    try {
      const overviewResult = await queryWithTimeout(pool, OVERVIEW_QUERY, [environment], 8000);
      snapshotByApp = new Map((overviewResult.rows || []).map((r) => [r.application_id, r]));
    } catch {
      /* keep empty — cache-only for apps that have it */
    }
    const [signInResult, todayResult] = await Promise.all([
      queryWithTimeout(pool, OVERVIEW_SIGNIN_BY_APP_SQL, [environment], 5000).catch(() => ({ rows: [] })),
      queryWithTimeout(pool, OVERVIEW_TODAY_BY_APP_SQL, [environment], 5000).catch(() => ({ rows: [] })),
    ]);
    signInByApp = new Map((signInResult.rows || []).map((row) => [row.application_id, row]));
    todayByApp = new Map((todayResult.rows || []).map((row) => [row.application_id, row]));
  }

  const apps = rows.map((row) => {
    const snap = snapshotByApp.get(row.application_id) || {};
    const cache = readCache(row.source_payload);
    const snapshotAt = cache?.fetched_at || cache?.snapshot_at || snap.snapshot_at || null;
    const overlay = overlayFromCache(
      {
        ...row,
        open_tickets: Number(snap.open_items ?? snap.open_tickets ?? 0),
        closed_tickets: Number(snap.closed_items ?? snap.closed_tickets ?? 0),
        rejected: Number(snap.rejected_items ?? snap.rejected ?? 0),
        in_progress: Number(snap.in_progress_items ?? snap.in_progress ?? 0),
        snapshot_at: snapshotAt,
      },
      signInByApp.get(row.application_id) || {},
      todayByApp.get(row.application_id) || {},
    );
    const ageHours = snapshotAgeHours(overlay.snapshotAt);
    const snapshotStale =
      !overlay.snapshotAt ||
      !isSameCalendarDay(new Date(overlay.snapshotAt), new Date(), DEFAULT_REPORT_TIMEZONE) ||
      (ageHours != null && ageHours > 24);

    return {
      environment: row.environment,
      application_id: row.application_id,
      application_name: friendlyApplicationName(row.application_id, row.application_name),
      snapshot_at: overlay.snapshotAt,
      fetched_at: overlay.cacheFresh ? overlay.snapshotAt : null,
      data_source: overlay.dataSource,
      snapshot_stale: snapshotStale && !overlay.cacheFresh,
      metrics: {
        total_users: overlay.totalUsers,
        sign_in_today: overlay.signInToday,
        sign_in_rate_overall: overlay.totalUsers
          ? Math.round((overlay.everLoggedIn / overlay.totalUsers) * 100)
          : 0,
        sign_in_rate_today: overlay.totalUsers
          ? Math.round((overlay.signInToday / overlay.totalUsers) * 100)
          : 0,
        open_tickets: overlay.openTickets,
        closed_tickets: overlay.closedTickets,
        rejected: overlay.rejected,
        total_items: overlay.openTickets + overlay.closedTickets + overlay.rejected,
        opened_today: overlay.openedToday,
        closed_today: overlay.closedToday,
        in_progress: overlay.inProgress,
      },
      metric_labels: isItsmLikeApplication(row.application_id, row.application_name)
        ? {
            sign_in_today: 'Signed in today',
            sign_in_rate_overall: 'Sign-in rate (overall)',
            sign_in_rate_today: 'Sign-in rate today',
            open_tickets: 'Open tickets',
            closed_tickets: 'Closed tickets',
          }
        : {
            sign_in_today: 'Active today',
            sign_in_rate_overall: 'Login rate (overall)',
            sign_in_rate_today: 'Login rate today',
            open_tickets: 'Open items',
            closed_tickets: 'Closed items',
          },
    };
  });

  // Overlay live MySQL P2P KPIs onto the registered Procurement to Pay row.
  // Hard-cap wait so a slow/unreachable P2P MySQL cannot hang the whole main dashboard.
  if (isP2pConfigured()) {
    try {
      const p2p = await Promise.race([
        loadP2pDashboard({ environment, period: 'all', entity: 'all' }),
        new Promise((_, reject) => {
          setTimeout(() => {
            const err = new Error('P2P overview timed out');
            err.code = 'P2P_OVERVIEW_TIMEOUT';
            reject(err);
          }, 2500);
        }),
      ]);
      const m = p2p?.metrics || {};
      const open = Number(m.open ?? m.pending ?? 0);
      const closed = Number(m.closed ?? m.completed ?? 0);
      const rejected = Number(m.rejected || 0);
      const patch = {
        open_tickets: open,
        closed_tickets: closed,
        rejected,
        total_items: Number(m.total || open + closed + rejected),
        total_users: Number(m.total_users || 0),
        sign_in_today: Number(m.signed_in_today || 0),
        sign_in_rate_overall: Number(m.sign_in_rate_overall || 0),
        sign_in_rate_today: Number(m.sign_in_rate_today || 0),
        opened_today: 0,
        closed_today: 0,
        in_progress: 0,
      };
      const idx = apps.findIndex((a) => isP2pApplication(a.application_id, a.application_name));
      if (idx >= 0) {
        apps[idx] = {
          ...apps[idx],
          application_name: P2P_APPLICATION_NAME,
          snapshot_at: p2p.snapshot_at || apps[idx].snapshot_at,
          data_source: p2p.data_source || 'p2p_mysql_readonly',
          snapshot_stale: false,
          metrics: { ...apps[idx].metrics, ...patch },
          metric_labels: {
            sign_in_today: 'Signed in today',
            sign_in_rate_overall: 'Sign-in rate (overall)',
            sign_in_rate_today: 'Sign-in rate today',
            open_tickets: 'Open PR/PO',
            closed_tickets: 'Closed PR/PO',
          },
        };
      } else {
        apps.push({
          environment,
          application_id: P2P_APPLICATION_ID,
          application_name: P2P_APPLICATION_NAME,
          snapshot_at: p2p.snapshot_at || new Date().toISOString(),
          fetched_at: p2p.snapshot_at || null,
          data_source: p2p.data_source || 'p2p_mysql_readonly',
          snapshot_stale: false,
          metrics: {
            total_users: patch.total_users,
            sign_in_today: patch.sign_in_today,
            sign_in_rate_overall: patch.sign_in_rate_overall,
            sign_in_rate_today: patch.sign_in_rate_today,
            open_tickets: patch.open_tickets,
            closed_tickets: patch.closed_tickets,
            rejected: patch.rejected,
            total_items: patch.total_items,
            opened_today: 0,
            closed_today: 0,
            in_progress: 0,
          },
          metric_labels: {
            sign_in_today: 'Signed in today',
            sign_in_rate_overall: 'Sign-in rate (overall)',
            sign_in_rate_today: 'Sign-in rate today',
            open_tickets: 'Open PR/PO',
            closed_tickets: 'Closed PR/PO',
          },
        });
      }
      apps.sort((a, b) => String(a.application_name).localeCompare(String(b.application_name)));
    } catch {
      // P2P overlay is best-effort — keep PG zeros rather than failing the whole dashboard.
    }
  }

  return apps;
}

module.exports = {
  loadDashboardOverview,
};
