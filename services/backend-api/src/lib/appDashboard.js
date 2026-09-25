'use strict';

/**
 * Per-application dashboard metrics from PostgreSQL snapshots.
 * Entity options are discovered from live item payloads (not hard-coded).
 * Period: daily | weekly | monthly | quarterly | all
 */

const TRAVEL_APP_ID = 'Expense_and_Travel_Management_A00';
const { recommendedResourcesForApp } = require('./reportStarters');
const {
  classifyTicketSource,
  classifySolarCategory,
  cleanMisUsers,
  friendlyApplicationName,
} = require('./dashboardDisplay');
const { latestRunsCte, latestApplicationSnapshotAt } = require('./snapshotRuns');
const {
  loadApplicationEngagementCache,
  isEngagementCacheFresh,
  shouldPreferEngagementCache,
  ENGAGEMENT_CACHE_TTL_MS,
} = require('./engagementCache');
const { isDraftSql } = require('./appRecords');
const { buildPmPortfolioFromRecords, projectKeySql } = require('./pmPortfolio');
const { resolveCompanyIdFromText, normalizeCompanyText } = require('./refexCompanies');

const BOARD_DISPLAY_NAMES = {
  Project_Management_A01: 'Project Management Board',
};

function normalizeCompanyKey(raw) {
  const company = String(raw || '').toLowerCase();
  if (company.includes('extrovis')) return 'extrovis';
  if (company.includes('refex')) return 'refex';
  return company ? 'refex' : '';
}

function buildUserCompanyLookup(users) {
  const map = new Map();
  for (const u of users || []) {
    const sp = u.source_payload && typeof u.source_payload === 'object' ? u.source_payload : {};
    const ck = u.company_key || sp.company_key || normalizeCompanyKey(u.company || sp.company);
    if (!ck) continue;
    if (u.user_id) map.set(String(u.user_id).toLowerCase(), ck);
    if (u.email) map.set(String(u.email).toLowerCase(), ck);
    if (u.user_name) map.set(String(u.user_name).toLowerCase(), ck);
  }
  return map;
}

function companiesFromUsers(users) {
  const counts = new Map();
  for (const u of users || []) {
    const sp = u.source_payload && typeof u.source_payload === 'object' ? u.source_payload : {};
    const ck = u.company_key || sp.company_key || normalizeCompanyKey(u.company || sp.company);
    if (!ck) continue;
    counts.set(ck, (counts.get(ck) || 0) + 1);
  }
  return [
    { id: 'refex', label: 'Refex', count: Number(counts.get('refex') || 0) },
    { id: 'extrovis', label: 'Extrovis', count: Number(counts.get('extrovis') || 0) },
  ].filter((e) => e.count > 0).sort((a, b) => b.count - a.count);
}

function userMatchesEntityCompanyProfile(user, entityFilter) {
  if (!entityFilter || entityFilter === 'all') return true;
  const el = String(entityFilter).toLowerCase();
  const sp = user?.source_payload && typeof user.source_payload === 'object' ? user.source_payload : {};
  const ck = normalizeCompanyKey(user?.company_key || sp.company_key || user?.company || sp.company);
  if (!ck) return true;
  if (el === 'extrovis' || el.includes('extrovis')) return ck === 'extrovis';
  if (el === 'refex') return ck === 'refex';
  return ck === el || ck.includes(el);
}

function filterUsersForEntityCompany(users, entityFilter, itsmCompanyMode) {
  if (!itsmCompanyMode || !entityFilter || entityFilter === 'all') return users;
  return (users || []).filter((u) => userMatchesEntityCompanyProfile(u, entityFilter));
}

function buildUserFilterLookup(users) {
  const map = new Map();
  for (const u of users || []) {
    const keys = [u.user_id, u.user_name, u.email]
      .filter(Boolean)
      .map((k) => String(k).toLowerCase().trim());
    for (const key of keys) {
      if (!map.has(key)) map.set(key, u);
    }
  }
  return map;
}

function recordMatchesUserFilter(record, userFilter, userLookup) {
  if (!userFilter || userFilter === 'all') return true;
  const uf = String(userFilter).toLowerCase().trim();
  const keys = [
    record.assignee_id,
    record.assignee_email,
    record.assigned_to,
  ].filter(Boolean).map((k) => String(k).toLowerCase().trim());
  if (keys.some((k) => k === uf || k.includes(uf) || uf.includes(k))) return true;
  const profile = userLookup?.get(uf);
  if (!profile) return false;
  const aliases = [profile.user_id, profile.user_name, profile.email]
    .filter(Boolean)
    .map((k) => String(k).toLowerCase().trim());
  return keys.some((k) => aliases.some((a) => k === a || k.includes(a) || a.includes(k)));
}

function resolveAssigneeCompanyKey(record, userCompanyMap) {
  if (record?.assignee_company_key) {
    return String(record.assignee_company_key).toLowerCase();
  }
  const keys = [
    record?.assignee_id,
    record?.assignee_email,
    String(record?.assigned_to || '').toLowerCase(),
  ].filter(Boolean).map((k) => String(k).toLowerCase());
  for (const key of keys) {
    const hit = userCompanyMap?.get(key);
    if (hit) return String(hit).toLowerCase();
  }
  const ek = String(record?.entity_key || record?.entity || '').toLowerCase();
  if (ek.includes('extrovis')) return 'extrovis';
  return 'refex';
}

function recordMatchesCompanyFilter(record, entityFilter, userCompanyMap) {
  if (!entityFilter || entityFilter === 'all') return true;
  const el = String(entityFilter).toLowerCase();
  const ck = resolveAssigneeCompanyKey(record, userCompanyMap);
  if (el === 'extrovis' || el.includes('extrovis')) return ck === 'extrovis';
  if (el === 'refex') return ck === 'refex' || (!ck.includes('extrovis') && !ck.includes('venwind'));
  if (el === 'venwind' || el.includes('venwind')) {
    return ck.includes('venwind')
      || String(record?.entity_key || record?.entity || '').toLowerCase().includes('venwind');
  }
  // Catalog company id (29 legal entities): match Entity / company fields.
  const hay = normalizeCompanyText([
    record?.company_name,
    record?.assignee_company,
    record?.entity,
    record?.entity_key,
    record?.company,
    record?.company_key,
    record?.assignee_company_key,
  ].filter(Boolean).join(' '));
  const resolved =
    resolveCompanyIdFromText(record?.company_name)
    || resolveCompanyIdFromText(record?.assignee_company)
    || resolveCompanyIdFromText(record?.entity)
    || resolveCompanyIdFromText(record?.entity_key)
    || resolveCompanyIdFromText(record?.company)
    || resolveCompanyIdFromText(record?.company_key)
    || resolveCompanyIdFromText(hay);
  if (resolved) return resolved === el;
  return hay.includes(el.replace(/-/g, ' ')) || ck === el || ck.includes(el);
}

function liveItsmCompanyCatalogFromRecords(records, { userCompanyMap, dateFrom, dateTo } = {}) {
  const base = { userCompanyMap, dateFrom, dateTo, itsmCompanyMode: true };
  const refex = summarizeLiveCacheRecords(records, { ...base, entityFilter: 'refex' });
  const ext = summarizeLiveCacheRecords(records, { ...base, entityFilter: 'extrovis' });
  return [
    { id: 'refex', label: 'Refex', count: refex.total },
    { id: 'extrovis', label: 'Extrovis', count: ext.total },
  ].filter((e) => e.count > 0).sort((a, b) => b.count - a.count);
}

function recordMatchesEntityFilter(record, entityFilter, { itsmCompanyMode = false, userCompanyMap } = {}) {
  if (!entityFilter || entityFilter === 'all') return true;
  const el = String(entityFilter).toLowerCase();
  const isBucket = el === 'refex' || el === 'extrovis' || el === 'venwind'
    || el.includes('extrovis') || el.includes('venwind');
  if (itsmCompanyMode && isBucket) {
    return recordMatchesCompanyFilter(record, entityFilter, userCompanyMap || new Map());
  }
  if (!isBucket) {
    // Specific company from the 29-list.
    return recordMatchesCompanyFilter(record, entityFilter, userCompanyMap || new Map());
  }
  const k = String(record?.entity_key || record?.entity || record?.assignee_company_key || '').toLowerCase();
  if (el === 'extrovis' || el.includes('extrovis')) return k.includes('extrovis');
  if (el === 'refex') return !k.includes('extrovis') && !k.includes('venwind');
  if (el === 'venwind' || el.includes('venwind')) return k.includes('venwind');
  return k === el || k.includes(el);
}

function usersMisFromLiveRecords(records, users, {
  entityFilter = 'all',
  userFilter = 'all',
  dateFrom,
  dateTo,
  itsmCompanyMode = false,
  userCompanyMap,
  userLookup,
} = {}) {
  const byKey = new Map();
  for (const r of records || []) {
    if (!recordMatchesEntityFilter(r, entityFilter, { itsmCompanyMode, userCompanyMap })) continue;
    if (!recordMatchesUserFilter(r, userFilter, userLookup)) continue;
    if (!recordInDateRange(r, dateFrom, dateTo)) continue;
    const key = String(r.assignee_id || r.assignee_email || r.assigned_to || '').trim().toLowerCase();
    if (!key || key === '—') continue;
    const bucket = String(r.status || '').toLowerCase();
    const row = byKey.get(key) || { open: 0, closed: 0, rejected: 0, total: 0, assigned_name: r.assigned_to };
    if (bucket === 'closed') row.closed += 1;
    else if (bucket === 'rejected') row.rejected += 1;
    else row.open += 1;
    row.total += 1;
    byKey.set(key, row);
  }
  const profileByKey = new Map();
  for (const u of users || []) {
    if (u.user_id) profileByKey.set(String(u.user_id).toLowerCase(), u);
    if (u.email) profileByKey.set(String(u.email).toLowerCase(), u);
    if (u.user_name) profileByKey.set(String(u.user_name).toLowerCase(), u);
  }
  return [...byKey.entries()].map(([key, counts]) => {
    const profile = profileByKey.get(key) || {};
    return {
      user_id: profile.user_id || key,
      user_name: profile.user_name || counts.assigned_name || key,
      email: profile.email || '',
      last_sign_in: profile.last_sign_in || null,
      ever_logged_in: profile.ever_logged_in,
      active_status: profile.active_status || null,
      company: profile.company || null,
      company_key: profile.company_key || null,
      is_active: profile.is_active,
      open: counts.open,
      closed: counts.closed,
      rejected: counts.rejected,
      total: counts.total,
      pending: counts.open,
      completed: counts.closed,
      closure_ratio: closureRatio(counts.open, counts.closed),
    };
  });
}

function recordInDateRange(record, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true;
  const raw = record?.created_at;
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return false;
  if (dateFrom && t < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
  if (dateTo && t > new Date(`${dateTo}T23:59:59.999`).getTime()) return false;
  return true;
}

function summarizeLiveCacheRecords(records, {
  entityFilter = 'all',
  userFilter = 'all',
  dateFrom,
  dateTo,
  itsmCompanyMode = false,
  userCompanyMap,
  userLookup,
} = {}) {
  let open = 0;
  let closed = 0;
  let rejected = 0;
  const entityCounts = new Map();
  const entityStats = new Map();
  for (const r of records || []) {
    if (!recordMatchesEntityFilter(r, entityFilter, { itsmCompanyMode, userCompanyMap })) continue;
    if (!recordMatchesUserFilter(r, userFilter, userLookup)) continue;
    if (!recordInDateRange(r, dateFrom, dateTo)) continue;
    const k = String(r?.entity_key || r?.entity || '').toLowerCase();
    let ek = 'refex';
    if (k.includes('extrovis')) ek = 'extrovis';
    else if (k.includes('venwind')) ek = 'venwind';
    else if (k) ek = k;
    entityCounts.set(ek, (entityCounts.get(ek) || 0) + 1);
    const stat = entityStats.get(ek) || { open: 0, closed: 0, rejected: 0, total: 0 };
    stat.total += 1;
    const s = String(r?.status || '').toLowerCase();
    if (s === 'closed') stat.closed += 1;
    else if (s === 'rejected') stat.rejected += 1;
    else stat.open += 1;
    entityStats.set(ek, stat);
    if (s === 'open') open += 1;
    else if (s === 'closed') closed += 1;
    else if (s === 'rejected') rejected += 1;
  }
  return {
    open,
    closed,
    rejected,
    total: open + closed + rejected,
    entityCounts,
    entityStats,
  };
}

function liveEntityCatalogFromRecords(records, { dateFrom, dateTo, itsmMode, travelMode } = {}) {
  const summary = summarizeLiveCacheRecords(records, {
    entityFilter: 'all',
    dateFrom,
    dateTo,
  });
  if (itsmMode) {
    return [
      { id: 'refex', label: 'Refex', count: Number(summary.entityCounts.get('refex') || 0) },
      { id: 'extrovis', label: 'Extrovis', count: Number(summary.entityCounts.get('extrovis') || 0) },
    ];
  }
  if (travelMode) {
    return [
      { id: 'refex', label: 'Refex', count: Number(summary.entityCounts.get('refex') || 0) },
      { id: 'venwind', label: 'Venwind', count: Number(summary.entityCounts.get('venwind') || 0) },
    ];
  }
  return [...summary.entityCounts.entries()]
    .map(([id, count]) => ({ id, label: id.replace(/_/g, ' '), count: Number(count || 0) }))
    .sort((a, b) => b.count - a.count);
}

function parseIdList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.values(value).map(String).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return trimmed.split(/[\s,]+/).filter(Boolean);
    }
  }
  return [];
}

function resolveBoardIds(applicationId, rawBoardIds) {
  const fromDb = parseIdList(rawBoardIds);
  const recommended = recommendedResourcesForApp(applicationId);
  const fromStarter = parseIdList(recommended?.board_ids);
  return [...new Set([...fromDb, ...fromStarter])];
}

/** Lightweight sign-in strip — APP_ROLE members only (application user list). */
const APP_SIGNIN_SUMMARY_SQL = `
WITH members AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
),
ranked AS (
  SELECT
    m.user_id,
    u.last_sign_in,
    u.ever_logged_in,
    ROW_NUMBER() OVER (
      PARTITION BY m.user_id
      ORDER BY u.last_sign_in DESC NULLS LAST, u.snapshot_at DESC
    ) AS rn
  FROM members m
  LEFT JOIN engagement_reporting."user" u
    ON u.environment = $1 AND u.user_id = m.user_id
)
SELECT
  COUNT(*)::int AS total_users,
  COUNT(*) FILTER (
    WHERE last_sign_in IS NOT NULL
      AND (last_sign_in AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date
  )::int AS active_today,
  COUNT(*) FILTER (
    WHERE ever_logged_in IS TRUE OR last_sign_in IS NOT NULL
  )::int AS ever_logged_in,
  COUNT(*) FILTER (
    WHERE last_sign_in IS NOT NULL
      AND (last_sign_in AT TIME ZONE 'Asia/Kolkata')::date
        <> (now() AT TIME ZONE 'Asia/Kolkata')::date
  )::int AS inactive,
  COUNT(*) FILTER (
    WHERE COALESCE(ever_logged_in, false) IS FALSE AND last_sign_in IS NULL
  )::int AS never_logged_in
FROM ranked
WHERE rn = 1
`;

const APP_ROSTER_SQL = `
WITH ranked AS (
  SELECT
    pu.user_id,
    COALESCE(NULLIF(trim(u.user_name), ''), NULLIF(trim(u.email), ''), pu.user_id) AS user_name,
    NULLIF(lower(trim(u.email)), '') AS email,
    u.last_sign_in,
    COALESCE(u.ever_logged_in, false) OR (u.last_sign_in IS NOT NULL) AS ever_logged_in,
    u.active_status,
    ROW_NUMBER() OVER (
      PARTITION BY pu.user_id
      ORDER BY u.last_sign_in DESC NULLS LAST, u.snapshot_at DESC
    ) AS rn
  FROM engagement_reporting.principal_user pu
  LEFT JOIN engagement_reporting."user" u
    ON u.environment = $1 AND u.user_id = pu.user_id
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
)
SELECT user_id, user_name, email, last_sign_in, ever_logged_in, active_status
FROM ranked
WHERE rn = 1
ORDER BY user_name
`;

async function loadAppRoster(pool, environment, applicationId) {
  try {
    const { rows } = await pool.query(APP_ROSTER_SQL, [environment, applicationId]);
    return cleanMisUsers((rows || []).map((r) => ({
      user_id: r.user_id,
      user_name: r.user_name,
      email: r.email,
      last_sign_in: r.last_sign_in,
      ever_logged_in: r.ever_logged_in,
      active_status: r.active_status,
      open: 0,
      closed: 0,
      rejected: 0,
      total: 0,
    })));
  } catch {
    return [];
  }
}

const TRAVEL_PROCESS_META = [
  { process_id: 'Travel_Management_A02', label: 'Travel Request', sort_order: 1 },
  { process_id: 'Advance_Payment_Request_Process_A01', label: 'Travel Advance', sort_order: 2 },
  { process_id: 'Expense_Management_A03', label: 'Travel Expense', sort_order: 3 },
];

function travelProcessLabel(processId) {
  const id = String(processId || '');
  const meta = TRAVEL_PROCESS_META.find((m) => m.process_id === id);
  if (meta) return meta.label;
  return id.replace(/_/g, ' ');
}

/** Shared expression for Entity / Company / Org across apps & Travel processes. */
function entityExprSql(alias = 'i') {
  return `lower(trim(coalesce(
    nullif(trim(${alias}.entity), ''),
    nullif(trim(${alias}.source_payload->>'Entity'), ''),
    nullif(trim(${alias}.source_payload->'Entity'->>'Name'), ''),
    nullif(trim(${alias}.source_payload->'Entity'->>'Value'), ''),
    nullif(trim(${alias}.source_payload->'Entity'->>'v'), ''),
    nullif(trim(${alias}.source_payload->>'EntityFlow'), ''),
    nullif(trim(${alias}.source_payload->'EntityFlow'->>'Name'), ''),
    nullif(trim(${alias}.source_payload->>'Entity_Flow'), ''),
    nullif(trim(${alias}.source_payload->'Entity_Flow'->>'Name'), ''),
    nullif(trim(${alias}.source_payload->>'Employee_entity'), ''),
    nullif(trim(${alias}.source_payload->'Employee_entity'->>'Name'), ''),
    nullif(trim(${alias}.source_payload->>'Employee_Org_Type'), ''),
    nullif(trim(${alias}.source_payload->>'Company'), ''),
    nullif(trim(${alias}.source_payload->'Company'->>'Name'), ''),
    nullif(trim(${alias}.source_payload->>'Created_by_Company'), ''),
    nullif(trim(${alias}.source_payload->>'Creator_Company'), ''),
    nullif(trim(${alias}.source_payload->>'Createdby_company'), ''),
    ''
  )))`;
}

/** Kissflow timestamp JSON → timestamptz (item table has no created_at column). */
function kfTsSql(col) {
  return `CASE
    WHEN jsonb_typeof(${col}) = 'string' AND (${col} #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
      CASE WHEN (${col} #>> '{}') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN (${col} #>> '{}')::timestamptz
           ELSE (${col} #>> '{}')::timestamp AT TIME ZONE 'Asia/Kolkata' END
    WHEN jsonb_typeof(${col}) = 'object' AND coalesce(${col}->>'v','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
      CASE WHEN (${col}->>'v') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN (${col}->>'v')::timestamptz
           ELSE (${col}->>'v')::timestamp AT TIME ZONE 'Asia/Kolkata' END
    ELSE NULL
  END`;
}

function createdAtSql(alias = 'i', { allowSnapshotFallback = true, allowModifiedFallback = false } = {}) {
  const p = `${alias}.source_payload`;
  const parts = [
    kfTsSql(`${p}->'_created_at'`),
    kfTsSql(`${p}->'Requested_Date'`),
    kfTsSql(`${p}->'Requester_Date__Time'`),
    kfTsSql(`${p}->'_submitted_at'`),
    kfTsSql(`${p}->'CreatedAt'`),
    kfTsSql(`${p}->'Created_On'`),
    kfTsSql(`${p}->'Created_At'`),
    kfTsSql(`${p}->'Created_Date'`),
    kfTsSql(`${p}->'Date_Created'`),
    kfTsSql(`${p}->'Ticket_Created_Date'`),
    kfTsSql(`${p}->'Lead_Created_Date'`),
  ];
  // Period filters: recover undated Kissflow rows via modified time (never snapshot_at —
  // that falsely pulls every undated ticket into "today"/YTD).
  if (allowModifiedFallback) {
    parts.push(kfTsSql(`${p}->'_modified_at'`));
    parts.push(kfTsSql(`${p}->'Modified_At'`));
  }
  if (allowSnapshotFallback) parts.push(`${alias}.snapshot_at`);
  return `COALESCE(${parts.join(',\n    ')})`;
}

/** Completed / closed timestamp for activity-today filters (created OR completed today). */
function completedAtSql(alias = 'i') {
  const p = `${alias}.source_payload`;
  return `COALESCE(
    ${kfTsSql(`${p}->'_completed_at'`)},
    ${kfTsSql(`${p}->'Completed_At'`)},
    ${kfTsSql(`${p}->'Closed_At'`)},
    ${kfTsSql(`${p}->'CompletedAt'`)},
    ${kfTsSql(`${p}->'ClosedAt'`)},
    CASE WHEN ${alias}.process_status IN ('Completed', 'Closed') THEN ${alias}.snapshot_at ELSE NULL END
  )`;
}

function normalizePeriod(value) {
  const p = String(value || 'all').trim().toLowerCase();
  if (['daily', 'day', 'today'].includes(p)) return 'daily';
  if (['weekly', 'week'].includes(p)) return 'weekly';
  if (['monthly', 'month', 'mtd', 'month_to_date'].includes(p)) return 'monthly';
  if (['quarterly', 'quarter', 'qtd', 'quarter_to_date'].includes(p)) return 'quarterly';
  if (['ytd', 'year_to_date'].includes(p)) return 'ytd';
  if (['last_30', 'last30', 'l30', 'last_30_days'].includes(p)) return 'last_30';
  if (['last_year', 'previous_year', 'prev_year'].includes(p)) return 'last_year';
  if (['fy', 'financial_year', 'financial-year', 'fiscal', 'this_fy'].includes(p)) return 'fy';
  if (['prev_fy', 'previous_fy', 'last_fy'].includes(p)) return 'prev_fy';
  if (['year', 'calendar_year', 'calendar-year'].includes(p)) return 'year';
  if (['custom'].includes(p)) return 'custom';
  return 'all';
}

/** Indian FY: Apr 1 → Mar 31 (Asia/Kolkata), capped at today. */
function indianFyBoundsSql() {
  return {
    from: `(
      CASE
        WHEN EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Kolkata')) >= 4
          THEN make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int, 4, 1)
        ELSE make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int - 1, 4, 1)
      END
    )`,
    to: `(now() AT TIME ZONE 'Asia/Kolkata')::date`,
  };
}

function periodSqlClause(period, createdAtExpr, dateFrom, dateTo, completedAtExpr) {
  const day = `(${createdAtExpr} AT TIME ZONE 'Asia/Kolkata')::date`;
  const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
  switch (period) {
    case 'daily': {
      // Activity today: created today OR completed/closed today (fixes empty ITSM "Today").
      if (completedAtExpr) {
        const completedDay = `(${completedAtExpr} AT TIME ZONE 'Asia/Kolkata')::date`;
        return `((${createdAtExpr} IS NOT NULL AND ${day} = ${today})
          OR (${completedAtExpr} IS NOT NULL AND ${completedDay} = ${today}))`;
      }
      return `${createdAtExpr} IS NOT NULL AND ${day} = ${today}`;
    }
    case 'weekly':
      return `${createdAtExpr} IS NOT NULL AND ${day} >= (${today} - INTERVAL '6 days')`;
    case 'last_30':
      return `${createdAtExpr} IS NOT NULL AND ${day} >= (${today} - INTERVAL '29 days') AND ${day} <= ${today}`;
    case 'monthly':
      return `${createdAtExpr} IS NOT NULL AND date_trunc('month', ${day}) = date_trunc('month', ${today})`;
    case 'quarterly':
      return `${createdAtExpr} IS NOT NULL AND date_trunc('quarter', ${day}) = date_trunc('quarter', ${today})`;
    case 'ytd':
      // Include undated tickets in YTD so CEO inventory is not understated when Kissflow
      // payloads omit _created_at (still exclude them from last_year / custom windows).
      return `((${createdAtExpr} IS NOT NULL
        AND ${day} >= make_date(EXTRACT(YEAR FROM ${today})::int, 1, 1)
        AND ${day} <= ${today})
        OR ${createdAtExpr} IS NULL)`;
    case 'last_year': {
      const y = `EXTRACT(YEAR FROM ${today})::int - 1`;
      return `${createdAtExpr} IS NOT NULL
        AND ${day} >= make_date(${y}, 1, 1)
        AND ${day} <= make_date(${y}, 12, 31)`;
    }
    case 'fy': {
      const fy = indianFyBoundsSql();
      return `((${createdAtExpr} IS NOT NULL AND ${day} BETWEEN ${fy.from} AND ${fy.to})
        OR ${createdAtExpr} IS NULL)`;
    }
    case 'prev_fy': {
      // Previous Indian FY (Apr 1 → Mar 31), full year window.
      const from = `(
        CASE
          WHEN EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Kolkata')) >= 4
            THEN make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int - 1, 4, 1)
          ELSE make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int - 2, 4, 1)
        END
      )`;
      const to = `(
        CASE
          WHEN EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Kolkata')) >= 4
            THEN make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int, 3, 31)
          ELSE make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int - 1, 3, 31)
        END
      )`;
      return `${createdAtExpr} IS NOT NULL AND ${day} BETWEEN ${from} AND ${to}`;
    }
    case 'year': {
      // Calendar year — prefer explicit dateFrom/dateTo; else current IST year.
      const from = String(dateFrom || '').trim();
      const to = String(dateTo || '').trim();
      if (from && to) {
        return `${createdAtExpr} IS NOT NULL AND ${day} BETWEEN '${sqlLiteral(from)}'::date AND '${sqlLiteral(to)}'::date`;
      }
      const y = from && /^\d{4}/.test(from)
        ? Number(from.slice(0, 4))
        : null;
      const yearExpr = y && Number.isFinite(y)
        ? String(y)
        : `EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int`;
      return `${createdAtExpr} IS NOT NULL
        AND ${day} >= make_date(${yearExpr}, 1, 1)
        AND ${day} <= make_date(${yearExpr}, 12, 31)`;
    }
    case 'custom': {
      const from = String(dateFrom || '').trim();
      const to = String(dateTo || '').trim();
      if (from && to) {
        return `${createdAtExpr} IS NOT NULL AND ${day} BETWEEN '${sqlLiteral(from)}'::date AND '${sqlLiteral(to)}'::date`;
      }
      if (from) {
        return `${createdAtExpr} IS NOT NULL AND ${day} >= '${sqlLiteral(from)}'::date`;
      }
      if (to) {
        return `${createdAtExpr} IS NOT NULL AND ${day} <= '${sqlLiteral(to)}'::date`;
      }
      return 'true';
    }
    default:
      return 'true';
  }
}

function sqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

/**
 * ITSM report entities are process-scoped (same as email):
 * Live_IT_Service_Request_A00 (+ blank Entity) → Refex;
 * Live_IT_Service_Request_Extrovis_A00 → Extrovis.
 * Never surface "(Blank)" as its own slicer option.
 */
function itsmEntityKeySql(alias = 'i') {
  return `CASE
    WHEN ${alias}.process_id ILIKE '%extrovis%' THEN 'extrovis'
    WHEN (${entityExprSql(alias)}) LIKE '%extrovis%' THEN 'extrovis'
    ELSE 'refex'
  END`;
}

/**
 * Match a user-selected entity label against precomputed entity_key text.
 * Travel: "refex" includes blank Entity; Venwind is substring.
 * ITSM: use itsmEntityKeySql values (refex | extrovis only).
 */
function entityFilterOnKeySql(entityRaw, keyColumn = 'entity_key') {
  const { companyFilterSql } = require('./refexCompanies');
  return companyFilterSql(entityRaw, keyColumn);
}

function userFilterOnPayloadSql(userFilter, payloadColumn = 'source_payload') {
  const raw = String(userFilter || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return 'true';
  const esc = sqlLiteral(raw.toLowerCase());
  const p = payloadColumn;
  return `(
    lower(trim(coalesce(
      NULLIF(trim(${p}->'Assigned_To'->>'Name'), ''),
      NULLIF(trim(${p}->'Assignee'->>'Name'), ''),
      NULLIF(trim(${p}->'AssignedTo'->>'Name'), ''),
      NULLIF(trim(${p}->'Owner'->>'Name'), ''),
      NULLIF(trim(${p}->'_current_assigned_to'->>'Name'), '')
    ))) = '${esc}'
    OR lower(trim(coalesce(
      NULLIF(trim(${p}->'Assigned_To'->>'Name'), ''),
      NULLIF(trim(${p}->'Assignee'->>'Name'), ''),
      NULLIF(trim(${p}->'AssignedTo'->>'Name'), ''),
      NULLIF(trim(${p}->'Owner'->>'Name'), ''),
      NULLIF(trim(${p}->'_current_assigned_to'->>'Name'), '')
    ))) LIKE '%${esc}%'
    OR lower(trim(coalesce(
      NULLIF(trim(${p}->'Assigned_To'->>'Email'), ''),
      NULLIF(trim(${p}->'Assignee'->>'Email'), ''),
      NULLIF(trim(${p}->'AssignedTo'->>'Email'), ''),
      NULLIF(trim(${p}->'Owner'->>'Email'), '')
    ))) = '${esc}'
    OR lower(trim(coalesce(
      NULLIF(trim(${p}->'Assigned_To'->>'_id'), ''),
      NULLIF(trim(${p}->'Assignee'->>'_id'), ''),
      NULLIF(trim(${p}->'AssignedTo'->>'_id'), ''),
      NULLIF(trim(${p}->'Owner'->>'_id'), ''),
      NULLIF(trim(${p}->'_current_assigned_to'->>'_id'), '')
    ))) = '${esc}'
  )`;
}

function misOwnerKeyAssigneeSql(alias = 'f') {
  return `COALESCE(
    NULLIF(trim(${alias}.source_payload->'Assigned_To'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Assigned_To'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'Assigned_To') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'Assigned_To'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'Assignee'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Assignee'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'Assignee') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'Assignee'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'AssignedTo'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'AssignedTo'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'AssignedTo') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'AssignedTo'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'Owner'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Owner'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'Owner') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'Owner'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'assigned_to'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'_current_assigned_to'->>'_id'), ''),
    NULLIF(lower(trim(${alias}.source_payload->'Assigned_To'->>'Email')), ''),
    NULLIF(lower(trim(${alias}.source_payload->'Assignee'->>'Email')), ''),
    NULLIF(lower(trim(${alias}.source_payload->'AssignedTo'->>'Email')), ''),
    NULLIF(lower(trim(${alias}.source_payload->'Owner'->>'Email')), '')
  )`;
}

function misOwnerKeyFullSql(alias = 'f') {
  return `COALESCE(
    NULLIF(trim(${alias}.source_payload->'Assigned_To'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Assigned_To'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'Assigned_To') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'Assigned_To'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'Assignee'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Assignee'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'Assignee') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'Assignee'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'AssignedTo'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'AssignedTo'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'AssignedTo') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'AssignedTo'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'Owner'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Owner'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'Owner') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'Owner'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'Lead_Owner'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Sales_Person'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'Sales_Person'->>'Id'), ''),
    CASE
      WHEN jsonb_typeof(${alias}.source_payload->'Sales_Person') = 'string'
        THEN NULLIF(trim(${alias}.source_payload->>'Sales_Person'), '')
      ELSE NULL
    END,
    NULLIF(trim(${alias}.source_payload->'assigned_to'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'_current_assigned_to'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'_modified_by'->>'_id'), ''),
    NULLIF(trim(${alias}.source_payload->'_created_by'->>'_id'), ''),
    NULLIF(lower(trim(${alias}.source_payload->'Assigned_To'->>'Email')), ''),
    NULLIF(lower(trim(${alias}.source_payload->'Assignee'->>'Email')), ''),
    NULLIF(lower(trim(${alias}.source_payload->'AssignedTo'->>'Email')), ''),
    NULLIF(lower(trim(${alias}.source_payload->'Owner'->>'Email')), ''),
    NULLIF(lower(trim(${alias}.source_payload->'Sales_Person'->>'Email')), ''),
    ${alias}.requester_email
  )`;
}

function isTravelApplication(applicationId) {
  return String(applicationId || '') === TRAVEL_APP_ID
    || String(applicationId || '').toLowerCase().includes('travel');
}

function isItsmApplication(applicationId, applicationName) {
  const id = String(applicationId || '').toLowerCase();
  const name = String(applicationName || '').toLowerCase();
  return id.includes('itsm') || id.includes('service') || name.includes('itsm') || name.includes('service');
}
function isSolarApplication(applicationId, applicationName) {
  const hay = `${applicationId || ''} ${applicationName || ''}`.toLowerCase();
  return (
    hay.includes('solar')
    || hay.includes('technician_reimbursement')
    || hay.includes('reinvestment')
    || hay.includes('site_expense')
  );
}


function isPmApplication(applicationId, applicationName) {
  const id = String(applicationId || '').toLowerCase();
  const name = String(applicationName || '').toLowerCase();
  return id.includes('project_management') || name.includes('project management');
}

function isLeadApplication(applicationId, applicationName) {
  const hay = `${applicationId || ''} ${applicationName || ''}`.toLowerCase();
  return hay.includes('lead');
}

/** Closed / (Open + Closed); rejected excluded from ratio denominator. */
function closureRatio(open, closed) {
  const o = Number(open || 0);
  const c = Number(closed || 0);
  const den = o + c;
  return den > 0 ? c / den : 0;
}

function sortByClosureRatioDesc(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ra = closureRatio(a.open ?? a.pending, a.closed ?? a.completed);
    const rb = closureRatio(b.open ?? b.pending, b.closed ?? b.completed);
    if (rb !== ra) return rb - ra;
    return Number(b.total || 0) - Number(a.total || 0);
  });
}

function isTravelManagementLabel(id, label) {
  const hay = `${id || ''} ${label || ''}`.toLowerCase().replace(/[_-]+/g, ' ');
  return hay.includes('travel management') || hay.includes('travel_management');
}

function reconcileMisToKpis(users, { open, closed, rejected }) {
  const rows = (users || [])
    .map((u) => {
      const o = Number(u.open ?? u.pending ?? 0);
      const c = Number(u.closed ?? u.completed ?? 0);
      const r = Number(u.rejected || 0);
      return {
        ...u,
        open: o,
        closed: c,
        rejected: r,
        total: o + c + r,
        pending: undefined,
        completed: undefined,
      };
    })
    .filter((u) => u.total > 0);

  const sumO = rows.reduce((s, u) => s + u.open, 0);
  const sumC = rows.reduce((s, u) => s + u.closed, 0);
  const sumR = rows.reduce((s, u) => s + u.rejected, 0);
  const targetO = Number(open || 0);
  const targetC = Number(closed || 0);
  const targetR = Number(rejected || 0);
  if (!rows.length) return rows;
  if (
    Math.abs(sumO - targetO) <= 1
    && Math.abs(sumC - targetC) <= 1
    && Math.abs(sumR - targetR) <= 1
  ) {
    return rows;
  }
  if (sumO + sumC + sumR <= 0) return rows;

  const scaled = rows.map((u) => {
    const o = sumO > 0 ? Math.round((u.open / sumO) * targetO) : 0;
    const c = sumC > 0 ? Math.round((u.closed / sumC) * targetC) : 0;
    const r = sumR > 0 ? Math.round((u.rejected / sumR) * targetR) : 0;
    return {
      ...u,
      open: o,
      closed: c,
      rejected: r,
      total: o + c + r,
    };
  });

  const applyDrift = (key, target) => {
    let drift = target - scaled.reduce((s, u) => s + Number(u[key] || 0), 0);
    if (!drift) return;
    // Prefer adjusting the largest row; if clamped, walk others.
    const order = [...scaled.keys()].sort(
      (a, b) => Number(scaled[b][key] || 0) - Number(scaled[a][key] || 0),
    );
    for (const i of order) {
      if (!drift) break;
      const cur = Number(scaled[i][key] || 0);
      const next = Math.max(0, cur + drift);
      const used = next - cur;
      scaled[i][key] = next;
      drift -= used;
    }
  };
  applyDrift('open', targetO);
  applyDrift('closed', targetC);
  applyDrift('rejected', targetR);
  for (const u of scaled) {
    u.total = Number(u.open || 0) + Number(u.closed || 0) + Number(u.rejected || 0);
  }
  return scaled.filter((u) => u.total > 0);
}

function filterEngagementCacheRecords(records) {
  const seen = new Set();
  const out = [];
  for (const r of records || []) {
    const draft = String(r?.status || r?.status_raw || r?.current_step || '').toLowerCase();
    if (draft.includes('draft')) continue;
    const id = String(r?.request_id || r?.id || r?.instance_id || '').trim();
    if (!id || id === '—' || id === '-') continue;
    const key = String(r.instance_id || r.id || r.request_id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function unionCleanUsers(primary, extra) {
  const map = new Map();
  const keyOf = (u) => {
    const email = String(u?.email || '').trim().toLowerCase();
    if (email.includes('@')) return `email:${email}`;
    const name = String(u?.user_name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (name.length >= 3) return `name:${name}`;
    return `id:${String(u?.user_id || '').trim().toLowerCase()}`;
  };
  for (const u of [...(primary || []), ...(extra || [])]) {
    const k = keyOf(u);
    if (!k || k === 'id:') continue;
    if (!map.has(k)) map.set(k, u);
  }
  return [...map.values()];
}

function rosterFromCacheItems(items) {
  return (items || []).map((u) => {
    const sp = u.source_payload && typeof u.source_payload === 'object' ? u.source_payload : {};
    return {
      user_id: u.user_id,
      user_name: u.user_name,
      email: u.email,
      last_sign_in: u.last_sign_in,
      ever_logged_in: u.ever_logged_in,
      active_status: u.active_status,
      company: sp.company || u.company || null,
      company_key: sp.company_key || u.company_key || null,
      is_active: sp.is_active !== false,
      open: Number(u.open ?? 0),
      closed: Number(u.completed ?? u.closed ?? 0),
      rejected: Number(u.rejected ?? 0),
      pending: Number(u.open ?? 0),
      completed: Number(u.completed ?? u.closed ?? 0),
    };
  });
}

function recordMatchesProcessFilter(record, processIdFilter) {
  if (!processIdFilter) return true;
  return String(record?.process_id || '') === processIdFilter;
}

function dashboardReportLayout({ travel, itsm, solar, pm, lead }) {
  if (travel) {
    return {
      kind: 'travel',
      rows: ['Overall KPIs', 'Entity matrix (Venwind / Refex)', 'MIS Open & Closed'],
      entity_reports: ['Venwind', 'Refex'],
      note: 'Travel request / Travel advance / Travel expense. Entity matrix: Venwind / Refex.',
    };
  }
  if (itsm) {
    return {
      kind: 'itsm',
      rows: ['Overall KPIs', 'Entity + status', 'Source trend', 'Entity matrix', 'MIS users'],
      note: 'Company filter uses assignee company (Refex / Extrovis). Open counts use Assigned To only.',
    };
  }
  if (solar) {
    return {
      kind: 'solar',
      rows: ['Overall KPIs', 'Entity + company', 'Operation vs Finance category', 'MIS users'],
      note: 'Entity and Company filters match other apps. Operation / Finance remain request categories.',
    };
  }
  if (pm) {
    return {
      kind: 'pm',
      rows: [
        'Projects (from linked tasks)',
        'All Tasks',
        'Individual Tasks (no Project ID)',
        'Sub-tasks',
        'MIS users',
      ],
      note:
        'Projects = distinct Project_ID on Project Task process. All Tasks = every Project Task. Individual = tasks with no Project ID. Sub-tasks = Sub Task process (child work under a task).',
    };
  }
  if (lead) {
    return {
      kind: 'lead',
      rows: ['Overall KPIs', 'Entity matrix by closure ratio', 'MIS users'],
      note: 'Lead Tracker — Open / Closed / Rejected; entity table sorted by closure ratio.',
      kpi_labels: { total: 'Total leads', open: 'Open leads', closed: 'Closed leads' },
    };
  }
  return {
    kind: 'generic',
    rows: ['Overall KPIs', 'Entity matrix', 'Users'],
  };
}

/**
 * Fast dashboard from GCP engagement_cache (scheduler / POST refresh). In-memory filters only.
 */
async function buildDashboardFromEngagementCache(pool, ctx) {
  const {
    environment,
    applicationId,
    applicationName,
    entityFilter,
    userFilter,
    processIdFilter,
    boardIdFilter,
    effectivePeriod,
    dateFrom,
    dateTo,
    itsm,
    travel,
    solar,
    pm,
    lead,
    processRows,
    boardIds,
    dataformIds,
    datasetIds,
    allowStale,
  } = ctx;

  const cache = await loadApplicationEngagementCache(pool, environment, applicationId);
  const solarHasTotals = solar && cache && cache.totals && typeof cache.totals === 'object';
  if (!cache || ((!Array.isArray(cache.records) || !cache.records.length) && !solarHasTotals)) return null;
  const snapshotAt = solar ? null : await latestApplicationSnapshotAt(pool, environment, applicationId);
  if (!shouldPreferEngagementCache(cache, { snapshotAt, applicationId })) {
    if (!allowStale && !solar) return null;
  }

  const cacheRecords = filterEngagementCacheRecords(Array.isArray(cache.records) ? cache.records : []);
  if (!cacheRecords.length && !solarHasTotals) return null;

  const totals = cache.totals && typeof cache.totals === 'object' ? cache.totals : {};
  const periodScoped = effectivePeriod && effectivePeriod !== 'all';
  const df = periodScoped ? dateFrom : undefined;
  const dt = periodScoped ? dateTo : undefined;
  const roster = rosterFromCacheItems(cache.items);
  const sqlAppUsers = solar ? [] : await loadAppRoster(pool, environment, applicationId);
  const roleFromCache = rosterFromCacheItems(
    (cache.items || []).filter((u) => u && u.has_app_role),
  );
  const appUsers = unionCleanUsers(sqlAppUsers, cleanMisUsers(roleFromCache));
  const userCompanyMap = buildUserCompanyLookup(roster);
  const userFilterLookup = buildUserFilterLookup(roster);
  const itsmCompanyMode = itsm && entityFilter !== 'all';
  const userFilterActive = userFilter !== 'all';
  const slicerActive = entityFilter !== 'all'
    || userFilterActive
    || Boolean(processIdFilter)
    || Boolean(boardIdFilter)
    || periodScoped;

  const filteredRecords = cacheRecords.filter((r) => {
    if (!recordMatchesEntityFilter(r, entityFilter, { itsmCompanyMode, userCompanyMap })) return false;
    if (!recordMatchesUserFilter(r, userFilter, userFilterLookup)) return false;
    if (!recordMatchesProcessFilter(r, processIdFilter)) return false;
    if (!recordInDateRange(r, df, dt)) return false;
    return true;
  });

  const sum = summarizeLiveCacheRecords(cacheRecords, {
    entityFilter,
    userFilter,
    itsmCompanyMode,
    userCompanyMap,
    userLookup: userFilterLookup,
    dateFrom: df,
    dateTo: dt,
  });

  let openCount = sum.open;
  let closedCount = sum.closed;
  let rejectedCount = sum.rejected;
  let totalCount = sum.total;

  if (!slicerActive && totals.open_tickets != null) {
    openCount = Number(totals.open_tickets || 0);
    closedCount = Number(totals.closed_tickets || 0);
    rejectedCount = Number(totals.rejected_tickets || 0);
    totalCount = openCount + closedCount + rejectedCount;
  }

  let users = usersMisFromLiveRecords(cacheRecords, roster, {
    entityFilter,
    userFilter,
    itsmCompanyMode,
    userCompanyMap,
    userLookup: userFilterLookup,
    dateFrom: df,
    dateTo: dt,
  });
  users = cleanMisUsers(users);

  if (userFilterActive && users.length) {
    openCount = users.reduce((s, u) => s + Number(u.open ?? u.pending ?? 0), 0);
    closedCount = users.reduce((s, u) => s + Number(u.closed ?? u.completed ?? 0), 0);
    rejectedCount = users.reduce((s, u) => s + Number(u.rejected ?? 0), 0);
    totalCount = openCount + closedCount + rejectedCount;
  } else if (!slicerActive) {
    users = reconcileMisToKpis(users, { open: openCount, closed: closedCount, rejected: rejectedCount });
  }

  let entitiesOut = [];
  if (itsm) {
    entitiesOut = liveItsmCompanyCatalogFromRecords(cacheRecords, {
      userCompanyMap,
      dateFrom: df,
      dateTo: dt,
    });
  } else if (travel) {
    entitiesOut = liveEntityCatalogFromRecords(cacheRecords, {
      dateFrom: df,
      dateTo: dt,
      travelMode: true,
    });
  } else {
    entitiesOut = liveEntityCatalogFromRecords(cacheRecords, {
      dateFrom: df,
      dateTo: dt,
    });
  }

  const engagement = {
    total_users: Number(appUsers.length || totals.total_users || 0),
    active_today: Number(totals.active_today || 0),
    never_logged_in: Number(totals.never_logged_in || 0),
    inactive: Number(totals.inactive || 0),
    sign_in_rate_overall: 0,
    sign_in_rate_today: 0,
  };
  if (engagement.total_users > 0) {
    engagement.sign_in_rate_today = Math.round((engagement.active_today / engagement.total_users) * 100);
    const ever = Math.max(0, engagement.total_users - engagement.never_logged_in);
    engagement.sign_in_rate_overall = Math.round((ever / engagement.total_users) * 100);
  }
  const adoptionPct = engagement.sign_in_rate_overall;

  const SOURCE_ORDER = ['Email', 'WhatsApp', 'Mobile', 'Web', 'Other'];
  let by_source = [];
  if (itsm) {
    const src = totals.by_source && typeof totals.by_source === 'object' ? totals.by_source : {};
    by_source = SOURCE_ORDER
      .filter((name) => Number(src[name] || 0) > 0)
      .map((name) => ({ name, count: Number(src[name] || 0) }));
  }

  const byEntity = entitiesOut.map((e) => {
    const stat = sum.entityStats?.get(e.id) || { open: 0, closed: 0, rejected: 0, total: e.count };
    return {
      entity_id: e.id,
      entity_label: e.label,
      total: Number(stat.total ?? e.count ?? 0),
      open: Number(stat.open || 0),
      closed: Number(stat.closed || 0),
      rejected: Number(stat.rejected || 0),
    };
  });

  const processMap = new Map();
  for (const r of filteredRecords) {
    const pid = String(r.process_id || 'unknown');
    const row = processMap.get(pid) || {
      process_id: pid,
      open_count: 0,
      closed: 0,
      rejected: 0,
    };
    const s = String(r.status || '').toLowerCase();
    if (s === 'closed') row.closed += 1;
    else if (s === 'rejected') row.rejected += 1;
    else row.open_count += 1;
    processMap.set(pid, row);
  }

  let by_process = [...processMap.values()].map((p) => ({
    process_id: p.process_id,
    process_label: travel ? travelProcessLabel(p.process_id) : p.process_id.replace(/_/g, ' '),
    process_name: travel ? travelProcessLabel(p.process_id) : p.process_id.replace(/_/g, ' '),
    total: p.open_count + p.closed + p.rejected,
    pending: p.open_count,
    open_count: p.open_count,
    in_progress: 0,
    completed: p.closed,
    closed: p.closed,
    rejected: p.rejected,
  }));

  if (travel) {
    const byId = new Map(by_process.map((p) => [p.process_id, p]));
    by_process = TRAVEL_PROCESS_META.map((meta) => {
      const found = byId.get(meta.process_id);
      return found || {
        process_id: meta.process_id,
        process_label: meta.label,
        process_name: meta.label,
        total: 0,
        pending: 0,
        open_count: 0,
        in_progress: 0,
        completed: 0,
        closed: 0,
        rejected: 0,
      };
    });
  }

  const resourceOptions = [
    ...processRows.map((p) => ({
      resource_type: 'process',
      resource_id: p.process_id,
      resource_name: travel
        ? travelProcessLabel(p.process_id)
        : (p.process_name || p.process_id).replace(/_/g, ' '),
    })),
    ...boardIds.map((id) => ({
      resource_type: 'board',
      resource_id: id,
      resource_name: BOARD_DISPLAY_NAMES[id] || id.replace(/_/g, ' '),
    })),
  ];

  const cacheSnapshotAt = cache.fetched_at || cache.snapshot_at || new Date().toISOString();
  const dataSource = shouldPreferEngagementCache(cache, { snapshotAt }) ? 'live_cache_fast' : 'live_cache_stale';
  const cachePortfolio = pm ? buildPmPortfolioFromRecords(filteredRecords) : undefined;
  // Live cache rows historically omitted Project ID, so Projects/Individual stay 0.
  // Fall through to SQL snapshot, which reads Project_ID from source_payload.
  if (pm) {
    const hasProjectKeys = filteredRecords.some((r) => String(r.project_id || r.project_key || '').trim());
    if (!hasProjectKeys) return null;
  }

  return {
    environment,
    application_id: applicationId,
    application_name: applicationName,
    snapshot_at: cacheSnapshotAt,
    data_source: dataSource,
    filters: {
      entity: entityFilter,
      user: userFilter,
      process_id: processIdFilter || 'all',
      resource_type: boardIdFilter ? 'board' : processIdFilter ? 'process' : 'all',
      resource_id: boardIdFilter || processIdFilter || 'all',
      period: effectivePeriod,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      supports_entity_filter: true,
      supports_period_filter: true,
      supports_resource_filter: true,
    },
    entities: entitiesOut,
    processes: processRows.map((p) => ({
      process_id: p.process_id,
      process_name: travel ? travelProcessLabel(p.process_id) : p.process_name,
      resource_type: 'process',
    })),
    boards: boardIds.map((id) => ({
      board_id: id,
      board_name: BOARD_DISPLAY_NAMES[id] || id.replace(/_/g, ' '),
      resource_type: 'board',
    })),
    resource_options: resourceOptions,
    resources: {
      processes: processRows.length,
      boards: boardIds.length,
      dataforms: dataformIds.length,
      datasets: datasetIds.length,
    },
    metrics: {
      total: totalCount,
      open: openCount,
      in_progress: 0,
      pending: openCount,
      completed: closedCount,
      closed: closedCount,
      rejected: rejectedCount,
      projects: Number(cachePortfolio?.projects_total || totals.projects_total || 0),
      total_users: engagement.total_users,
      signed_in_today: engagement.active_today,
      sign_in_rate_overall: adoptionPct,
      sign_in_rate_today: engagement.sign_in_rate_today,
      user_adoption_pct: adoptionPct,
      never_logged_in: engagement.never_logged_in,
      inactive_users: engagement.inactive,
      status_model: 'open_closed',
    },
    by_entity: byEntity,
    by_process,
    by_source,
    by_category: [],
    portfolio: cachePortfolio,
    users: sortByClosureRatioDesc(users).slice(0, 80),
    app_users: appUsers.length ? appUsers : [],
    board_filter_note: boardIdFilter
      ? 'Board selected — item KPIs still come from connected processes (boards have no ticket rows in PostgreSQL).'
      : undefined,
    report_layout: dashboardReportLayout({ travel, itsm, solar, pm, lead }),
    filter_engine: 'v6-engagement-cache-fast',
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ environment: string, applicationId: string, entity?: string, processId?: string, resourceType?: string, resourceId?: string, period?: string, dateFrom?: string, dateTo?: string, preferCache?: boolean, allowStaleCache?: boolean, forceFullSql?: boolean }} opts
 */
async function loadApplicationDashboard(pool, opts) {
  const environment = opts.environment || 'production';
  const applicationId = opts.applicationId;
  const entityFilter = String(opts.entity || 'all').trim() || 'all';
  const userFilter = String(opts.user || opts.assignee || 'all').trim() || 'all';
  let processIdFilter = String(opts.processId || '').trim();
  const resourceType = String(opts.resourceType || '').trim().toLowerCase();
  const resourceId = String(opts.resourceId || '').trim();
  if (resourceType === 'process' && resourceId) processIdFilter = resourceId;
  const boardIdFilter = resourceType === 'board' ? resourceId : '';
  const period = normalizePeriod(opts.period);
  const dateFrom = String(opts.dateFrom || '').trim();
  const dateTo = String(opts.dateTo || '').trim();
  const effectivePeriod = period === 'custom' || dateFrom || dateTo
    ? (period === 'all' && (dateFrom || dateTo) ? 'custom' : period)
    : period;

  const { rows: appRows } = await pool.query(
    `SELECT application_id, application_name,
            COALESCE(source_payload->'board_ids', '[]'::jsonb) AS board_ids,
            COALESCE(source_payload->'dataform_ids', '[]'::jsonb) AS dataform_ids,
            COALESCE(source_payload->'dataset_ids', '[]'::jsonb) AS dataset_ids
     FROM engagement_reporting.application
     WHERE is_current = true AND environment = $1 AND application_id = $2
     LIMIT 1`,
    [environment, applicationId],
  );
  if (!appRows.length) {
    const err = new Error(`Application not found: ${applicationId}`);
    err.code = 'APP_NOT_FOUND';
    throw err;
  }
  const applicationName = friendlyApplicationName(applicationId, appRows[0].application_name);
  const boardIds = resolveBoardIds(applicationId, appRows[0].board_ids);
  const dataformIds = Array.isArray(appRows[0].dataform_ids) ? appRows[0].dataform_ids.map(String) : [];
  const datasetIds = Array.isArray(appRows[0].dataset_ids) ? appRows[0].dataset_ids.map(String) : [];
  const travel = isTravelApplication(applicationId);
  const itsm = isItsmApplication(applicationId, applicationName);
  const solar = isSolarApplication(applicationId, applicationName);
  const pm = isPmApplication(applicationId, applicationName);
  const lead = isLeadApplication(applicationId, applicationName);

  const { rows: processRows } = await pool.query(
    `SELECT process_id, process_name
     FROM engagement_reporting.process
     WHERE is_current = true AND environment = $1 AND application_id = $2
     ORDER BY process_name`,
    [environment, applicationId],
  );

  const preferCache = opts.preferCache !== false && !opts.forceFullSql;
  if (preferCache) {
    let fromCache = await buildDashboardFromEngagementCache(pool, {
      environment,
      applicationId,
      applicationName,
      entityFilter,
      userFilter,
      processIdFilter,
      boardIdFilter,
      effectivePeriod,
      dateFrom,
      dateTo,
      itsm,
      travel,
      solar,
      pm,
      lead,
      processRows,
      boardIds,
      dataformIds,
      datasetIds,
      allowStale: opts.allowStaleCache === true || solar,
    });
    if (!fromCache && itsm) {
      try {
        const { fetchLiveAppMetrics } = require('./kissflowLiveMetrics');
        await fetchLiveAppMetrics(environment, applicationId, { persistCache: true });
        fromCache = await buildDashboardFromEngagementCache(pool, {
          environment,
          applicationId,
          applicationName,
          entityFilter,
          userFilter,
          processIdFilter,
          boardIdFilter,
          effectivePeriod,
          dateFrom,
          dateTo,
          itsm,
          travel,
          solar,
          pm,
          lead,
          processRows,
          boardIds,
          dataformIds,
          datasetIds,
          allowStale: false,
        });
      } catch {
        /* SQL snapshot fallback */
      }
    }
    if (fromCache) return fromCache;
  }

  const entityClause = entityFilterOnKeySql(entityFilter, 'entity_key');
  const userFilterClause = userFilterOnPayloadSql(userFilter, 'source_payload');
  const misOwnerKeySql = itsm ? misOwnerKeyAssigneeSql('f') : misOwnerKeyFullSql('f');
  const processClause = processIdFilter
    ? `AND i.process_id = '${sqlLiteral(processIdFilter)}'`
    : '';
  const periodScoped = effectivePeriod && effectivePeriod !== 'all';
  const createdAt = createdAtSql('i', {
    allowSnapshotFallback: !periodScoped,
    // Recover undated tickets into YTD/MTD/etc without using snapshot_at (which skews all → "now").
    allowModifiedFallback: periodScoped,
  });
  const completedAt = completedAtSql('i');
  const periodClause = periodSqlClause(effectivePeriod, 'created_at', dateFrom, dateTo, 'completed_at');
  const entityKeyExpr = itsm
    ? itsmEntityKeySql('i')
    : entityExprSql('i');
  const latestCte = latestRunsCte({
    environmentParam: '$2',
    applicationIdParam: '$1',
    alias: 'latest',
  });

  // All apps: Open / Closed / Rejected only (ITSM Admin All reopen steps count as Closed).
  // Lead Tracker also treats Lead_Status closed/done as Closed.
  // Also honor Kissflow payload Status/_status (live metrics use these for Rejected).
  const statusBucketSql = `CASE
      WHEN i.process_status IN ('Withdrawn')
        OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
        OR lower(coalesce(
          i.source_payload->>'_status',
          i.source_payload->>'Status',
          i.source_payload->'Status'->>'Name',
          i.source_payload->'Status'->>'Value',
          i.source_payload->>'Process_Status',
          i.source_payload->'Process_Status'->>'Name',
          ''
        )) ~ '(reject|cancel|withdraw)'
        THEN 'rejected'
      WHEN i.process_status IN ('Completed', 'Closed')
        OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled')
        OR (
          ${lead ? 'true' : 'false'}
          AND lower(trim(coalesce(
            i.source_payload->>'Lead_Status',
            i.source_payload->>'Status',
            ''
          ))) IN ('close', 'closed', 'completed', 'done', 'won', 'converted')
        )
        OR (
          ${itsm ? 'true' : 'false'}
          AND lower(coalesce(i.process_status, '')) IN ('inprogress', 'in progress', 'in-progress')
          AND (
            lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
            OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%reopen window%'
            OR lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%employee feedback%'
          )
        )
        THEN 'closed'
      ELSE 'open'
    END`;

  const sql = `
WITH ${latestCte},
classified AS (
  SELECT
    i.instance_id,
    i.process_id,
    i.process_status,
    (${createdAt}) AS created_at,
    (${completedAt}) AS completed_at,
    (${entityKeyExpr}) AS entity_key,
    (${projectKeySql('i')}) AS project_key,
    COALESCE(l.snapshot_at, now()) AS snapshot_at,
    (${statusBucketSql}) AS status_bucket,
    COALESCE(
      NULLIF(trim(i.source_payload->'Requester'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Requested_By'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Employee'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'_created_by'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Created_By'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Assigned_To'->>'Name'), ''),
      NULLIF(trim(i.requester_email), '')
    ) AS requester_name,
    NULLIF(lower(trim(COALESCE(
      NULLIF(trim(i.requester_email), ''),
      NULLIF(trim(i.source_payload->>'Requested_Email'), ''),
      NULLIF(trim(i.source_payload->'Requester'->>'Email'), ''),
      NULLIF(trim(i.source_payload->'_created_by'->>'Email'), '')
    ))), '') AS requester_email,
    i.source_payload,
    COALESCE(NULLIF(trim(i.current_step), ''), NULLIF(trim(i.source_payload->>'_current_step'), '')) AS current_step
  FROM engagement_reporting.item i
  JOIN latest l
    ON i.snapshot_run_id = l.snapshot_run_id
   AND i.process_id = l.process_id
  WHERE true
    ${processClause}
    AND NOT (${isDraftSql('i')})
),
filtered AS (
  SELECT * FROM classified
  WHERE (${entityClause})
    AND (${periodClause})
    AND (${userFilterClause})
),
app_users AS (
  SELECT
    pu.user_id,
    COALESCE(NULLIF(trim(u.user_name), ''), pu.user_id) AS user_name,
    NULLIF(lower(trim(u.email)), '') AS email,
    u.last_sign_in,
    COALESCE(u.ever_logged_in, false) OR (u.last_sign_in IS NOT NULL) AS ever_logged_in,
    u.active_status,
    NULLIF(trim(u.source_payload->>'company'), '') AS company,
    NULLIF(trim(u.source_payload->>'company_key'), '') AS company_key,
    CASE
      WHEN lower(coalesce(u.active_status, '')) = 'inactive' THEN false
      WHEN (u.source_payload->>'is_active') = 'false' THEN false
      ELSE true
    END AS is_active
  FROM engagement_reporting.principal_user pu
  LEFT JOIN LATERAL (
    SELECT uu.user_name, uu.email, uu.last_sign_in, uu.ever_logged_in, uu.active_status, uu.source_payload
    FROM engagement_reporting."user" uu
    WHERE uu.environment = $2 AND uu.user_id = pu.user_id
    ORDER BY uu.last_sign_in DESC NULLS LAST, uu.snapshot_at DESC
    LIMIT 1
  ) u ON true
  WHERE pu.environment = $2
    AND pu.application_id = $1
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
)
SELECT
  (SELECT max(snapshot_at) FROM latest) AS snapshot_at,
  (SELECT count(*) FROM filtered)::int AS total,
  (SELECT count(*) FROM filtered WHERE status_bucket = 'open')::int AS open_count,
  0::int AS in_progress,
  (SELECT count(*) FROM filtered WHERE status_bucket = 'open')::int AS pending,
  (SELECT count(*) FROM filtered WHERE status_bucket = 'closed')::int AS completed,
  (SELECT count(*) FROM filtered WHERE status_bucket = 'rejected')::int AS rejected,
  (SELECT count(*) FROM classified WHERE (${entityClause}))::int AS snap_inventory,
  (SELECT count(*) FROM classified WHERE (${entityClause}) AND status_bucket = 'open')::int AS snap_inventory_open,
  (SELECT count(*) FROM classified WHERE (${entityClause}) AND status_bucket = 'closed')::int AS snap_inventory_closed,
  (SELECT count(*) FROM classified WHERE (${entityClause}) AND status_bucket = 'rejected')::int AS snap_inventory_rejected,
  COALESCE((
    SELECT json_agg(row_to_json(e) ORDER BY e.count DESC, e.entity_label)
    FROM (
      SELECT
        CASE WHEN entity_key = '' THEN 'refex' ELSE entity_key END AS entity_id,
        CASE
          WHEN entity_key IN ('', 'refex') THEN 'Refex'
          WHEN entity_key = 'extrovis' THEN 'Extrovis'
          WHEN entity_key LIKE '%venwind%' THEN 'Venwind'
          WHEN entity_key IN ('operation', 'operations') THEN 'Operation'
          WHEN entity_key IN ('finance') THEN 'Finance'
          ELSE initcap(entity_key)
        END AS entity_label,
        count(*)::int AS count
      FROM filtered
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 40
    ) e
  ), '[]'::json) AS entities,
  COALESCE((
    SELECT json_agg(row_to_json(e) ORDER BY e.count DESC, e.entity_label)
    FROM (
      SELECT
        CASE WHEN entity_key = '' THEN 'refex' ELSE entity_key END AS entity_id,
        CASE
          WHEN entity_key IN ('', 'refex') THEN 'Refex'
          WHEN entity_key = 'extrovis' THEN 'Extrovis'
          WHEN entity_key LIKE '%venwind%' THEN 'Venwind'
          WHEN entity_key IN ('operation', 'operations') THEN 'Operation'
          WHEN entity_key IN ('finance') THEN 'Finance'
          ELSE initcap(entity_key)
        END AS entity_label,
        count(*)::int AS count
      FROM classified
      WHERE (${periodClause})
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 40
    ) e
  ), '[]'::json) AS entity_catalog,
  COALESCE((
    SELECT json_agg(row_to_json(e) ORDER BY e.closure_ratio DESC, e.total DESC, e.entity_label)
    FROM (
      SELECT
        CASE WHEN c.entity_key = '' THEN 'refex' ELSE c.entity_key END AS entity_id,
        CASE
          WHEN c.entity_key IN ('', 'refex') THEN 'Refex'
          WHEN c.entity_key = 'extrovis' OR c.entity_key LIKE '%extrovis%' THEN 'Extrovis'
          WHEN c.entity_key LIKE '%venwind%' THEN 'Venwind'
          WHEN c.entity_key IN ('operation', 'operations') THEN 'Operation'
          WHEN c.entity_key IN ('finance') THEN 'Finance'
          ELSE initcap(c.entity_key)
        END AS entity_label,
        count(*)::int AS total,
        count(*) FILTER (WHERE c.status_bucket = 'open')::int AS open_count,
        count(*) FILTER (WHERE c.status_bucket = 'closed')::int AS closed_count,
        count(*) FILTER (WHERE c.status_bucket = 'rejected')::int AS rejected,
        CASE
          WHEN (count(*) FILTER (WHERE c.status_bucket = 'open')
              + count(*) FILTER (WHERE c.status_bucket = 'closed')) > 0
            THEN (count(*) FILTER (WHERE c.status_bucket = 'closed'))::float
                 / (count(*) FILTER (WHERE c.status_bucket = 'open')
                    + count(*) FILTER (WHERE c.status_bucket = 'closed'))::float
          ELSE 0::float
        END AS closure_ratio
      FROM filtered c
      GROUP BY 1, 2
    ) e
  ), '[]'::json) AS by_entity,
  COALESCE((
    SELECT json_agg(row_to_json(p) ORDER BY p.sort_order, p.process_label)
    FROM (
      SELECT
        f.process_id,
        CASE f.process_id
          WHEN 'Travel_Management_A02' THEN 'Travel Request'
          WHEN 'Advance_Payment_Request_Process_A01' THEN 'Travel Advance'
          WHEN 'Expense_Management_A03' THEN 'Travel Expense'
          ELSE replace(f.process_id, '_', ' ')
        END AS process_label,
        CASE f.process_id
          WHEN 'Travel_Management_A02' THEN 1
          WHEN 'Advance_Payment_Request_Process_A01' THEN 2
          WHEN 'Expense_Management_A03' THEN 3
          ELSE 99
        END AS sort_order,
        count(*)::int AS total,
        count(*) FILTER (WHERE f.status_bucket = 'open')::int AS open_count,
        count(*) FILTER (WHERE f.status_bucket = 'closed')::int AS closed_count,
        count(*) FILTER (WHERE f.status_bucket = 'rejected')::int AS rejected
      FROM filtered f
      GROUP BY f.process_id
    ) p
  ), '[]'::json) AS by_process,
  COALESCE((
    SELECT json_agg(row_to_json(u) ORDER BY u.closure_ratio DESC, u.total DESC, u.user_name)
    FROM (
      SELECT
        COALESCE(au.user_id, ic.owner_key) AS user_id,
        COALESCE(au.user_name, ic.owner_name, ic.owner_key) AS user_name,
        au.email,
        au.last_sign_in,
        au.ever_logged_in,
        au.active_status,
        au.company,
        au.company_key,
        au.is_active,
        ic.total,
        ic.pending,
        ic.completed,
        ic.rejected,
        CASE
          WHEN (ic.pending + ic.completed) > 0
            THEN ic.completed::float / (ic.pending + ic.completed)::float
          ELSE 0::float
        END AS closure_ratio
      FROM (
        -- Assignee-first (same basis as live MIS), then attach APP_ROLE profile when present.
        SELECT
          owner_key,
          MAX(owner_name) AS owner_name,
          count(*)::int AS total,
          count(*) FILTER (WHERE status_bucket = 'open')::int AS pending,
          count(*) FILTER (WHERE status_bucket = 'closed')::int AS completed,
          count(*) FILTER (WHERE status_bucket = 'rejected')::int AS rejected
        FROM (
          SELECT
            f.status_bucket,
            ${misOwnerKeySql} AS owner_key,
            COALESCE(
              NULLIF(trim(f.source_payload->'Assigned_To'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Assignee'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'AssignedTo'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Owner'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Lead_Owner'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Sales_Person'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'_current_assigned_to'->>'Name'), ''),
              ${itsm ? "NULL" : "NULLIF(trim(f.source_payload->'_created_by'->>'Name'), '')"},
              ${itsm ? "NULL" : 'f.requester_name'}
            ) AS owner_name
          FROM filtered f
        ) owned
        WHERE owner_key IS NOT NULL AND owner_key <> ''
        GROUP BY owner_key
      ) ic
      LEFT JOIN LATERAL (
        SELECT au0.user_id, au0.user_name, au0.email, au0.last_sign_in, au0.ever_logged_in,
               au0.active_status, au0.company, au0.company_key, au0.is_active
        FROM app_users au0
        WHERE au0.user_id = ic.owner_key
           OR (au0.email IS NOT NULL AND au0.email = lower(trim(ic.owner_key)))
        ORDER BY CASE WHEN au0.user_id = ic.owner_key THEN 0 ELSE 1 END
        LIMIT 1
      ) au ON true
      WHERE ic.total > 0
      ORDER BY 9 DESC, 5 DESC, 2
      LIMIT 200
    ) u
  ), '[]'::json) AS users,
  COALESCE((
    SELECT json_agg(json_build_object(
      'source_text', COALESCE(
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Source'), ''),
      NULLIF(trim(f.source_payload->'Source'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Source'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Source'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Source'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Source'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Ticket_Source'), ''),
      NULLIF(trim(f.source_payload->'Ticket_Source'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Ticket_Source'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Ticket_Source'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Ticket_Source'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Ticket_Source'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Channel'), ''),
      NULLIF(trim(f.source_payload->'Channel'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Channel'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Channel'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Channel'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Channel'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Column_BDSZ_sAHys'), ''),
      NULLIF(trim(f.source_payload->'Column_BDSZ_sAHys'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Column_BDSZ_sAHys'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Column_BDSZ_sAHys'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Column_BDSZ_sAHys'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Column_BDSZ_sAHys'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Column_hFjGV8lRrn'), ''),
      NULLIF(trim(f.source_payload->'Column_hFjGV8lRrn'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Column_hFjGV8lRrn'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Column_hFjGV8lRrn'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Column_hFjGV8lRrn'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Column_hFjGV8lRrn'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Column_1XTRxinP7c'), ''),
      NULLIF(trim(f.source_payload->'Column_1XTRxinP7c'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Column_1XTRxinP7c'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Column_1XTRxinP7c'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Column_1XTRxinP7c'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Column_1XTRxinP7c'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Column_uSnNcJOfiS'), ''),
      NULLIF(trim(f.source_payload->'Column_uSnNcJOfiS'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Column_uSnNcJOfiS'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Column_uSnNcJOfiS'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Column_uSnNcJOfiS'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Column_uSnNcJOfiS'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Column_nEM1x9oVe4'), ''),
      NULLIF(trim(f.source_payload->'Column_nEM1x9oVe4'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Column_nEM1x9oVe4'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Column_nEM1x9oVe4'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Column_nEM1x9oVe4'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Column_nEM1x9oVe4'->>'dv'), '')
    )), ''),
        NULLIF(trim(COALESCE(
      NULLIF(trim(f.source_payload->>'Column_zugAS-mL2N'), ''),
      NULLIF(trim(f.source_payload->'Column_zugAS-mL2N'->>'Name'), ''),
      NULLIF(trim(f.source_payload->'Column_zugAS-mL2N'->>'Value'), ''),
      NULLIF(trim(f.source_payload->'Column_zugAS-mL2N'->>'v'), ''),
      NULLIF(trim(f.source_payload->'Column_zugAS-mL2N'->>'label'), ''),
      NULLIF(trim(f.source_payload->'Column_zugAS-mL2N'->>'dv'), '')
    )), '')
      ),
      'source_payload', jsonb_strip_nulls(jsonb_build_object(
        'Source', f.source_payload->'Source',
        'Ticket_Source', f.source_payload->'Ticket_Source',
        'Channel', f.source_payload->'Channel',
        'Column_BDSZ_sAHys', f.source_payload->'Column_BDSZ_sAHys',
        'Column_hFjGV8lRrn', f.source_payload->'Column_hFjGV8lRrn',
        'Service_Category', f.source_payload->'Service_Category',
        'Expense_Type', f.source_payload->'Expense_Type',
        'Category', f.source_payload->'Category',
        'Department', f.source_payload->'Department',
        'Cost_Center', f.source_payload->'Cost_Center',
        'Request_Type', f.source_payload->'Request_Type'
      )),
      'current_step', f.current_step,
      'status_bucket', f.status_bucket
    ))
    FROM filtered f
  ), '[]'::json) AS breakdown_items,
  (
    SELECT count(DISTINCT project_key)::int
    FROM filtered
    WHERE project_key IS NOT NULL
  ) AS distinct_projects,
  COALESCE((
    SELECT json_build_object(
      'projects_total', (
        SELECT count(*)::int FROM (
          SELECT project_key
          FROM filtered
          WHERE process_id ILIKE '%Project_Sub_Task%'
            AND project_key IS NOT NULL
          GROUP BY project_key
        ) p
      ),
      'projects_open', (
        SELECT count(*)::int FROM (
          SELECT project_key
          FROM filtered
          WHERE process_id ILIKE '%Project_Sub_Task%'
            AND project_key IS NOT NULL
          GROUP BY project_key
          HAVING bool_or(status_bucket = 'open')
        ) p
      ),
      'projects_closed', (
        SELECT count(*)::int FROM (
          SELECT project_key
          FROM filtered
          WHERE process_id ILIKE '%Project_Sub_Task%'
            AND project_key IS NOT NULL
          GROUP BY project_key
          HAVING bool_or(status_bucket = 'open') = false
             AND bool_or(status_bucket = 'closed')
        ) p
      ),
      'tasks_total', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Project_Sub_Task%'
      ),
      'tasks_open', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Project_Sub_Task%' AND status_bucket = 'open'
      ),
      'tasks_closed', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Project_Sub_Task%' AND status_bucket = 'closed'
      ),
      'linked_tasks', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Project_Sub_Task%' AND project_key IS NOT NULL
      ),
      'individual_total', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Project_Sub_Task%' AND project_key IS NULL
      ),
      'individual_open', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Project_Sub_Task%' AND project_key IS NULL AND status_bucket = 'open'
      ),
      'individual_closed', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Project_Sub_Task%' AND project_key IS NULL AND status_bucket = 'closed'
      ),
      'subtasks_total', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Sub_Task_Process%'
      ),
      'subtasks_open', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Sub_Task_Process%' AND status_bucket = 'open'
      ),
      'subtasks_closed', (
        SELECT count(*)::int FROM filtered
        WHERE process_id ILIKE '%Sub_Task_Process%' AND status_bucket = 'closed'
      )
    )
  ), '{}'::json) AS portfolio,
  (SELECT count(*)::int FROM app_users) AS app_user_count
  `;

  const { rows } = await pool.query(sql, [applicationId, environment]);
  const row = { ...(rows[0] || {}) };

  let engagement = {
    total_users: Number(row.app_user_count || 0),
    active_today: 0,
    sign_in_rate_overall: 0,
    sign_in_rate_today: 0,
    never_logged_in: 0,
    inactive: 0,
  };
  try {
    const { rows: engRows } = await pool.query(APP_SIGNIN_SUMMARY_SQL, [environment, applicationId]);
    const e = engRows[0] || {};
    const totalUsers = Number(e.total_users || row.app_user_count || 0);
    const activeToday = Number(e.active_today || 0);
    const everLoggedIn = Number(e.ever_logged_in || 0);
    engagement = {
      total_users: totalUsers,
      active_today: activeToday,
      never_logged_in: Number(e.never_logged_in || 0),
      inactive: Number(e.inactive || 0),
      sign_in_rate_overall: totalUsers ? Math.round((everLoggedIn / totalUsers) * 100) : 0,
      sign_in_rate_today: totalUsers ? Math.round((activeToday / totalUsers) * 100) : 0,
    };
  } catch {
    // best-effort
  }

  // Ticket KPI overlay only when no slicers — filtered views stay on snapshot SQL.
  const kpiFiltersActive = Boolean(
    (entityFilter && entityFilter !== 'all')
    || (userFilter && userFilter !== 'all')
    || processIdFilter
    || boardIdFilter
    || (effectivePeriod && effectivePeriod !== 'all')
  );

  let dataSource = 'snapshot';
  let snapshotAt = row.snapshot_at || null;
  let users = Array.isArray(row.users) ? row.users : [];
  let liveSourceBuckets = null;
  let liveTotals = null;
  let cacheRecords = null;
  try {
    const cache = await loadApplicationEngagementCache(pool, environment, applicationId);
    const cacheFresh = cache && isEngagementCacheFresh(cache, ENGAGEMENT_CACHE_TTL_MS);
    const cacheNewer =
      cache?.fetched_at && (!snapshotAt || new Date(cache.fetched_at) > new Date(snapshotAt));
    if (cache && (cacheFresh || cacheNewer)) {
      dataSource = kpiFiltersActive ? 'snapshot_filtered' : 'live_overlay';
      if (!kpiFiltersActive) snapshotAt = cache.fetched_at || snapshotAt;
      const totals = cache.totals || {};
      liveTotals = totals;
      cacheRecords = Array.isArray(cache.records) ? cache.records : null;
      // Source mix is needed for Today / filtered views too (chart fallback).
      if (totals.by_source && typeof totals.by_source === 'object') {
        liveSourceBuckets = totals.by_source;
      }
      // Adoption / sign-in is always today-scoped — never tied to date filters.
      if (totals.total_users != null) engagement.total_users = Number(totals.total_users);
      if (totals.active_today != null) engagement.active_today = Number(totals.active_today);
      if (engagement.total_users) {
        engagement.sign_in_rate_today = Math.round(
          (engagement.active_today / engagement.total_users) * 100,
        );
        const never = Number(totals.never_logged_in || 0);
        const ever = Math.max(0, engagement.total_users - never);
        engagement.sign_in_rate_overall = Math.round((ever / engagement.total_users) * 100);
        engagement.never_logged_in = never;
        engagement.inactive = Number(totals.inactive || 0);
      }
      if (!kpiFiltersActive) {
        if (totals.open_tickets != null) row.open_count = Number(totals.open_tickets);
        if (totals.closed_tickets != null) row.completed = Number(totals.closed_tickets);
        if (totals.rejected_tickets != null) row.rejected = Number(totals.rejected_tickets);
        if (totals.open_tickets != null && totals.closed_tickets != null) {
          row.in_progress = 0;
          row.pending = Number(totals.open_tickets);
          row.total =
            Number(totals.open_tickets)
            + Number(totals.closed_tickets)
            + Number(row.rejected || 0);
        }
        // Keep SQL assignee MIS as source of truth (Lead/ITSM parity with item set).
        // Live cache only enriches names / last_sign_in and fills gaps.
        if (Array.isArray(cache.items) && cache.items.length) {
          const byId = new Map(cache.items.map((u) => [String(u.user_id || ''), u]));
          const byEmail = new Map(
            cache.items
              .filter((u) => u.email)
              .map((u) => [String(u.email).toLowerCase(), u]),
          );
          const seen = new Set();
          users = users.map((u) => {
            const hit = byId.get(String(u.user_id || '')) || byEmail.get(String(u.email || '').toLowerCase());
            if (u.user_id) seen.add(String(u.user_id));
            if (!hit) return u;
            const sp = hit.source_payload && typeof hit.source_payload === 'object' ? hit.source_payload : {};
            return {
              ...u,
              user_name: u.user_name || hit.user_name || u.user_id,
              last_sign_in: hit.last_sign_in || u.last_sign_in || null,
              ever_logged_in: u.ever_logged_in ?? hit.ever_logged_in ?? Boolean(hit.last_sign_in || u.last_sign_in),
              active_status: hit.active_status || u.active_status || null,
              company: sp.company || hit.company || u.company || null,
              company_key: sp.company_key || hit.company_key || u.company_key || null,
              is_active: sp.is_active !== false && String(hit.active_status || u.active_status || '').toLowerCase() !== 'inactive',
            };
          });
          for (const u of cache.items) {
            const id = String(u.user_id || '');
            if (!id || seen.has(id)) continue;
            const assigned =
              Number(u.assigned || 0)
              || (Number(u.open || 0) + Number(u.completed || 0) + Number(u.closed || 0) + Number(u.rejected || 0));
            if (!lead && assigned <= 0) continue;
            const sp = u.source_payload && typeof u.source_payload === 'object' ? u.source_payload : {};
            users.push({
              user_id: id,
              user_name: u.user_name || u.email || id,
              email: u.email || '',
              last_sign_in: u.last_sign_in || null,
              active_status: u.active_status || null,
              company: sp.company || null,
              company_key: sp.company_key || null,
              is_active: sp.is_active !== false && String(u.active_status || '').toLowerCase() !== 'inactive',
              total: assigned,
              pending: Number(u.open || 0),
              completed: Number(u.completed ?? u.closed ?? 0),
              rejected: Number(u.rejected || 0),
            });
            seen.add(id);
          }
        }
      } else if (Array.isArray(cache.items) && cache.items.length) {
        // Filtered MIS: keep SQL open/closed/rejected; only enrich last_sign_in from cache.
        const byId = new Map(cache.items.map((u) => [String(u.user_id || ''), u]));
        const byEmail = new Map(
          cache.items
            .filter((u) => u.email)
            .map((u) => [String(u.email).toLowerCase(), u]),
        );
        users = users.map((u) => {
          const hit = byId.get(String(u.user_id || '')) || byEmail.get(String(u.email || '').toLowerCase());
          if (!hit) return u;
          const sp = hit.source_payload && typeof hit.source_payload === 'object' ? hit.source_payload : {};
          return {
            ...u,
            user_name: u.user_name || hit.user_name || u.user_id,
            last_sign_in: hit.last_sign_in || u.last_sign_in || null,
            ever_logged_in: u.ever_logged_in ?? hit.ever_logged_in ?? Boolean(hit.last_sign_in || u.last_sign_in),
            active_status: hit.active_status || u.active_status || null,
            company: sp.company || hit.company || u.company || null,
            company_key: sp.company_key || hit.company_key || u.company_key || null,
            is_active: sp.is_active !== false && String(hit.active_status || u.active_status || '').toLowerCase() !== 'inactive',
          };
        });
      }
    }
  } catch {
    // cache overlay best-effort
  }

  const userCompanyMap = buildUserCompanyLookup(users);

  users = cleanMisUsers(users);
  const usersRoster = users.map((u) => ({ ...u }));
  const userFilterLookup = buildUserFilterLookup(usersRoster);
  // Hide zero-activity rows — except Lead, where APP_ROLE teammates with 0 still belong on the roster.
  if (!lead) {
    users = users.filter(
      (u) => Number(u.total || 0) > 0
        || Number(u.open || 0) + Number(u.closed || 0) + Number(u.rejected || 0) > 0
        || Number(u.pending || 0) + Number(u.completed || 0) > 0,
    );
  }
  users = sortByClosureRatioDesc(users).slice(0, lead ? 100 : 80);

  let byEntity = (Array.isArray(row.by_entity) ? row.by_entity : []).map((e) => {
    const open = Number(e.open_count ?? e.open ?? 0);
    const closed = Number(e.closed_count ?? e.closed ?? e.completed ?? 0);
    const rejected = Number(e.rejected || 0);
    return {
      entity_id: e.entity_id,
      entity_label: e.entity_label,
      total: Number(e.total || open + closed + rejected),
      open,
      closed,
      rejected,
      closure_ratio: closureRatio(open, closed),
    };
  });

  // Travel: drop "Travel Management" as its own row — fold counts into Refex.
  // Also drop junk entity keys like "yes".
  if (travel && byEntity.length) {
    const merged = new Map();
    for (const e of byEntity) {
      let id = String(e.entity_id || '').toLowerCase();
      let label = String(e.entity_label || id);
      if (id === 'yes' || id === 'no' || id === 'true' || id === 'false') continue;
      if (isTravelManagementLabel(id, label)) {
        id = 'refex';
        label = 'Refex';
      }
      if (id.includes('venwind')) {
        id = 'venwind';
        label = 'Venwind';
      } else if (id === 'refex' || id === '' || (id.includes('refex') && !id.includes('venwind'))) {
        id = 'refex';
        label = 'Refex';
      }
      const prev = merged.get(id);
      if (prev) {
        prev.open += e.open;
        prev.closed += e.closed;
        prev.rejected += e.rejected;
        prev.total += e.total;
      } else {
        merged.set(id, {
          entity_id: id,
          entity_label: label,
          open: e.open,
          closed: e.closed,
          rejected: e.rejected,
          total: e.total,
          closure_ratio: 0,
        });
      }
    }
    byEntity = [...merged.values()].map((e) => ({
      ...e,
      closure_ratio: closureRatio(e.open, e.closed),
    }));
  }

  let openCount = Number(row.open_count || 0);
  let closedCount = Number(row.completed || 0);
  let rejectedCount = Number(row.rejected || 0);
  let totalCount = Number(row.total || 0);

  // ITSM / all apps: "Today" on a stale snapshot often returns 0 even when live
  // Kissflow has opened/closed today. Prefer live today activity KPIs when present.
  const userFilterActive = Boolean(userFilter && userFilter !== 'all');
  if (
    effectivePeriod === 'daily'
    && liveTotals
    && !userFilterActive
    && (totalCount === 0 || Number(liveTotals.opened_today || 0) + Number(liveTotals.closed_today || 0) > totalCount)
  ) {
    const ot = Number(liveTotals.opened_today || 0);
    const ct = Number(liveTotals.closed_today || 0);
    if (ot + ct > 0) {
      openCount = ot;
      closedCount = ct;
      rejectedCount = 0;
      totalCount = ot + ct;
      dataSource = 'live_today';
      // Keep entity matrix proportional if we already had rows; else single All row.
      if (byEntity.length && byEntity.reduce((s, e) => s + e.total, 0) > 0) {
        const snapT = byEntity.reduce((s, e) => s + e.total, 0);
        byEntity = byEntity.map((e) => {
          const share = e.total / snapT;
          const open = Math.round(openCount * share);
          const closed = Math.round(closedCount * share);
          return {
            ...e,
            open,
            closed,
            rejected: 0,
            total: open + closed,
            closure_ratio: closureRatio(open, closed),
          };
        });
      } else {
        byEntity = [{
          entity_id: 'all',
          entity_label: 'Today activity',
          open: openCount,
          closed: closedCount,
          rejected: 0,
          total: totalCount,
          closure_ratio: closureRatio(openCount, closedCount),
        }];
      }
    }
  }

  // ITSM / Travel entity or period filters: prefer live cache records over stale snapshot SQL.
  const entityLower = String(entityFilter || '').toLowerCase();
  const entityOnlyActive = Boolean(
    entityFilter && entityFilter !== 'all' && !processIdFilter && !boardIdFilter,
  );
  const liveRecordApps = itsm || travel || lead || pm;
  const itsmCompanyMode = itsm;
  if (cacheRecords?.length && liveRecordApps && (entityOnlyActive || (kpiFiltersActive && periodScoped) || (userFilter && userFilter !== 'all'))) {
    const liveSum = summarizeLiveCacheRecords(cacheRecords, {
      entityFilter,
      userFilter,
      itsmCompanyMode: itsm && entityFilter !== 'all',
      userCompanyMap,
      userLookup: userFilterLookup,
      dateFrom: periodScoped ? dateFrom : undefined,
      dateTo: periodScoped ? dateTo : undefined,
    });
    const liveHint = Number(liveTotals?.open_tickets || 0)
      + Number(liveTotals?.closed_tickets || 0)
      + Number(liveTotals?.rejected_tickets || 0);
    const useLive = (entityOnlyActive && itsm)
      || (liveSum.total > 0
        && (entityOnlyActive || (userFilter && userFilter !== 'all') || liveSum.total >= totalCount * 0.5 || cacheRecords.length >= liveHint * 0.85));
    if (useLive) {
      openCount = liveSum.open;
      closedCount = liveSum.closed;
      rejectedCount = liveSum.rejected;
      totalCount = liveSum.total;
      dataSource = entityOnlyActive
        ? 'live_records_entity'
        : (userFilter && userFilter !== 'all' ? 'live_records_user' : 'live_records_period');
      if (entityOnlyActive) {
        const isExt = entityLower === 'extrovis' || entityLower.includes('extrovis');
        byEntity = [{
          entity_id: isExt ? 'extrovis' : 'refex',
          entity_label: isExt ? 'Extrovis' : 'Refex',
          open: openCount,
          closed: closedCount,
          rejected: rejectedCount,
          total: totalCount,
          closure_ratio: closureRatio(openCount, closedCount),
        }];
        if (cacheRecords?.length && liveRecordApps) {
          users = usersMisFromLiveRecords(cacheRecords, usersRoster, {
            entityFilter,
            userFilter,
            itsmCompanyMode: itsm,
            userCompanyMap,
            userLookup: userFilterLookup,
            dateFrom: periodScoped ? dateFrom : undefined,
            dateTo: periodScoped ? dateTo : undefined,
          });
        }
      }
    }
  }

  // ITSM entity-only (period=all): scale snapshot entity share to live totals so
  // Refex / Extrovis KPIs match the unfiltered matrix (not raw snapshot 329/6).
  const itsmEntityOnly =
    itsm
    && !cacheRecords?.length
    && kpiFiltersActive
    && !userFilterActive
    && effectivePeriod === 'all'
    && !processIdFilter
    && !boardIdFilter
    && (entityLower === 'refex' || entityLower === 'extrovis' || entityLower.includes('extrovis'))
    && dataSource !== 'live_records_entity';
  if (itsmEntityOnly && liveTotals) {
    const liveOpen = Number(liveTotals.open_tickets || 0);
    const liveClosed = Number(liveTotals.closed_tickets || 0);
    const liveRejected = Number(liveTotals.rejected_tickets || 0);
    const liveTotal = liveOpen + liveClosed + liveRejected;
    if (liveTotal > 0) {
      const catalogRaw = Array.isArray(row.entity_catalog)
        ? row.entity_catalog
        : (Array.isArray(row.entities) ? row.entities : []);
      let snapRefex = 0;
      let snapExt = 0;
      for (const e of catalogRaw) {
        const id = String(e.entity_id || e.entity_label || '').trim().toLowerCase();
        const n = Number(e.count || 0);
        if (id === 'extrovis' || id.includes('extrovis')) snapExt += n;
        else snapRefex += n;
      }
      const snapAll = snapRefex + snapExt;
      const isExt = entityLower === 'extrovis' || entityLower.includes('extrovis');
      const share = snapAll > 0
        ? (isExt ? snapExt : snapRefex) / snapAll
        : (isExt ? 0 : 1);
      openCount = Math.round(liveOpen * share);
      closedCount = Math.round(liveClosed * share);
      // Unfiltered UI drifts all live Rejected onto Refex.
      rejectedCount = isExt ? 0 : liveRejected;
      totalCount = openCount + closedCount + rejectedCount;
      dataSource = 'live_overlay_entity';
      byEntity = [{
        entity_id: isExt ? 'extrovis' : 'refex',
        entity_label: isExt ? 'Extrovis' : 'Refex',
        open: openCount,
        closed: closedCount,
        rejected: rejectedCount,
        total: totalCount,
        closure_ratio: closureRatio(openCount, closedCount),
      }];
    }
  }

  // Period-only scaling: never re-inflate KPIs when entity/process slicers are active
  // (that wiped Lead/PM entity filters back to full inventory).
  const entityOrResourceSlicer = Boolean(
    (entityFilter && entityFilter !== 'all')
    || processIdFilter
    || boardIdFilter,
  );
  if (
    kpiFiltersActive
    && periodScoped
    && liveTotals
    && !userFilterActive
    && !entityOrResourceSlicer
    && dataSource !== 'live_today'
    && dataSource !== 'live_overlay_entity'
  ) {
    const snapInv = Number(row.snap_inventory || 0);
    const snapFiltered = Number(row.total || 0);
    const liveOpen = Number(liveTotals.open_tickets || 0);
    const liveClosed = Number(liveTotals.closed_tickets || 0);
    const liveRejected = Number(liveTotals.rejected_tickets || 0);
    const liveTotal = liveOpen + liveClosed + liveRejected;
    if (snapInv > 0 && liveTotal > snapInv * 1.05) {
      const share = Math.min(1, snapFiltered / snapInv);
      openCount = Math.round(liveOpen * share);
      closedCount = Math.round(liveClosed * share);
      rejectedCount = Math.round(liveRejected * share);
      totalCount = openCount + closedCount + rejectedCount;
      dataSource = 'live_scaled_period';
      if (byEntity.length) {
        const entitySnap = byEntity.reduce((s, e) => s + Number(e.total || 0), 0) || 1;
        byEntity = byEntity.map((e) => {
          const eShare = (Number(e.total || 0) / entitySnap) * share;
          const open = Math.round(liveOpen * eShare);
          const closed = Math.round(liveClosed * eShare);
          const rejected = Math.round(liveRejected * eShare);
          return {
            ...e,
            open,
            closed,
            rejected,
            total: open + closed + rejected,
            closure_ratio: closureRatio(open, closed),
          };
        });
      }
    }
  }

  // User filter: KPI cards must always match assignee-scoped totals (embed MIS drill-down).
  if (userFilterActive) {
    if (cacheRecords?.length) {
      const sum = summarizeLiveCacheRecords(cacheRecords, {
        entityFilter,
        userFilter,
        itsmCompanyMode: itsm && entityFilter !== 'all',
        userCompanyMap,
        userLookup: userFilterLookup,
        dateFrom: periodScoped ? dateFrom : undefined,
        dateTo: periodScoped ? dateTo : undefined,
      });
      openCount = sum.open;
      closedCount = sum.closed;
      rejectedCount = sum.rejected;
      totalCount = sum.total;
      dataSource = 'filter_user';
      if (itsm && cacheRecords.length) {
        users = usersMisFromLiveRecords(cacheRecords, usersRoster, {
          entityFilter,
          userFilter,
          itsmCompanyMode: entityFilter !== 'all',
          userCompanyMap,
          userLookup: userFilterLookup,
          dateFrom: periodScoped ? dateFrom : undefined,
          dateTo: periodScoped ? dateTo : undefined,
        });
      } else {
        const uf = String(userFilter).toLowerCase();
        users = usersRoster.filter((u) =>
          String(u.user_id || '').toLowerCase() === uf
          || String(u.user_name || '').toLowerCase() === uf
          || String(u.email || '').toLowerCase() === uf,
        );
      }
    } else {
      const uf = String(userFilter).toLowerCase();
      users = usersRoster.filter((u) =>
        String(u.user_id || '').toLowerCase() === uf
        || String(u.user_name || '').toLowerCase() === uf
        || String(u.email || '').toLowerCase() === uf,
      );
      if (users.length) {
        openCount = users.reduce((s, u) => s + Number(u.open ?? u.pending ?? 0), 0);
        closedCount = users.reduce((s, u) => s + Number(u.closed ?? u.completed ?? 0), 0);
        rejectedCount = users.reduce((s, u) => s + Number(u.rejected ?? 0), 0);
        totalCount = openCount + closedCount + rejectedCount;
        dataSource = 'filter_user_mis';
      }
    }
  } else if (entityOnlyActive && cacheRecords?.length && liveRecordApps) {
    users = usersMisFromLiveRecords(cacheRecords, usersRoster, {
      entityFilter,
      userFilter,
      itsmCompanyMode: itsm,
      userCompanyMap,
      userLookup: userFilterLookup,
      dateFrom: periodScoped ? dateFrom : undefined,
      dateTo: periodScoped ? dateTo : undefined,
    });
  }

  // Keep entity matrix totals consistent with KPI cards (scale snapshot mix to live totals).
  const snapOpen = byEntity.reduce((s, e) => s + e.open, 0);
  const snapClosed = byEntity.reduce((s, e) => s + e.closed, 0);
  const snapRejected = byEntity.reduce((s, e) => s + e.rejected, 0);
  const snapTotal = byEntity.reduce((s, e) => s + e.total, 0);
  if (!kpiFiltersActive && byEntity.length && snapTotal > 0 && totalCount > 0 && (snapTotal !== totalCount || snapOpen !== openCount)) {
    byEntity = byEntity.map((e) => {
      const open = snapOpen > 0 ? Math.round((e.open / snapOpen) * openCount) : 0;
      const closed = snapClosed > 0 ? Math.round((e.closed / snapClosed) * closedCount) : 0;
      const rejected = snapRejected > 0 ? Math.round((e.rejected / snapRejected) * rejectedCount) : 0;
      return {
        ...e,
        open,
        closed,
        rejected,
        total: open + closed + rejected,
      };
    });
    // Fix rounding drift on largest entity
    const driftOpen = openCount - byEntity.reduce((s, e) => s + e.open, 0);
    const driftClosed = closedCount - byEntity.reduce((s, e) => s + e.closed, 0);
    const driftRejected = rejectedCount - byEntity.reduce((s, e) => s + e.rejected, 0);
    if (byEntity.length) {
      const idx = byEntity.reduce((best, e, i, arr) => (e.total > arr[best].total ? i : best), 0);
      byEntity[idx].open = Math.max(0, byEntity[idx].open + driftOpen);
      byEntity[idx].closed = Math.max(0, byEntity[idx].closed + driftClosed);
      byEntity[idx].rejected = Math.max(0, byEntity[idx].rejected + driftRejected);
      byEntity[idx].total = byEntity[idx].open + byEntity[idx].closed + byEntity[idx].rejected;
    }
  }

  // Build source / category breakdowns from same filtered item set as KPIs
  const breakdownRaw = Array.isArray(row.breakdown_items) ? row.breakdown_items : [];
  const sourceCounts = new Map();
  const categoryCounts = new Map();
  const categoryStatus = new Map(); // name -> {open,closed,rejected}
  for (const item of breakdownRaw) {
    const bucket = String(item.status_bucket || 'open');
    if (itsm) {
      const ch = item.source_text
        ? classifyTicketSource(String(item.source_text))
        : classifyTicketSource(item.source_payload || {});
      sourceCounts.set(ch, (sourceCounts.get(ch) || 0) + 1);
    }
    if (solar) {
      const cat = classifySolarCategory(item.source_payload || {}, item.current_step);
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      const st = categoryStatus.get(cat) || { open: 0, closed: 0, rejected: 0 };
      if (bucket === 'closed') st.closed += 1;
      else if (bucket === 'rejected') st.rejected += 1;
      else st.open += 1;
      categoryStatus.set(cat, st);
    }
  }
  const SOURCE_ORDER = ['Email', 'WhatsApp', 'Mobile', 'Web', 'Other'];
  let by_source = itsm
    ? SOURCE_ORDER.filter((k) => (sourceCounts.get(k) || 0) > 0).map((name) => ({
        name,
        count: sourceCounts.get(name) || 0,
      }))
    : [];
  // Unfiltered live refresh: prefer Kissflow list source counts (matches email HTML).
  if (itsm && !kpiFiltersActive && liveSourceBuckets) {
    by_source = SOURCE_ORDER.filter((k) => Number(liveSourceBuckets[k] || 0) > 0).map((name) => ({
      name,
      count: Number(liveSourceBuckets[name] || 0),
    }));
  }
  // Today filter: use live today-activity source mix when snapshot today items are empty.
  if (
    itsm
    && effectivePeriod === 'daily'
    && liveTotals
  ) {
    const todayBuckets = liveTotals.by_source_today && typeof liveTotals.by_source_today === 'object'
      ? liveTotals.by_source_today
      : null;
    let liveTodaySource = todayBuckets
      ? SOURCE_ORDER.filter((k) => Number(todayBuckets[k] || 0) > 0).map((name) => ({
          name,
          count: Number(todayBuckets[name] || 0),
        }))
      : [];
    // Fallback: proportion all-time live source mix onto today's activity total.
    const allTimeBuckets = liveSourceBuckets
      || (liveTotals.by_source && typeof liveTotals.by_source === 'object' ? liveTotals.by_source : null);
    if (!liveTodaySource.length && allTimeBuckets && totalCount > 0) {
      const bucketSum = SOURCE_ORDER.reduce((s, k) => s + Number(allTimeBuckets[k] || 0), 0);
      const liveOpen = Number(liveTotals.open_tickets || 0);
      const liveClosed = Number(liveTotals.closed_tickets || 0);
      const liveRejected = Number(liveTotals.rejected_tickets || 0);
      const liveAll = liveOpen + liveClosed + liveRejected;
      const denom = bucketSum > 0 ? bucketSum : liveAll;
      if (denom > 0) {
        liveTodaySource = SOURCE_ORDER
          .map((name) => ({
            name,
            count: Math.round((Number(allTimeBuckets[name] || 0) / denom) * totalCount),
          }))
          .filter((r) => r.count > 0);
      }
    }
    if (liveTodaySource.length) by_source = liveTodaySource;
  }
  const CAT_ORDER = ['Operation', 'Finance'];
  const by_category = solar
    ? CAT_ORDER.filter((k) => categoryCounts.has(k)).map((name) => ({
        name,
        count: categoryCounts.get(name) || 0,
      }))
    : [];

  // Solar: Entity matrix = Operation / Finance (not site codes / process names).
  if (solar && categoryStatus.size) {
    byEntity = CAT_ORDER.filter((k) => categoryStatus.has(k)).map((name) => {
      const st = categoryStatus.get(name);
      return {
        entity_id: name.toLowerCase(),
        entity_label: name,
        open: st.open,
        closed: st.closed,
        rejected: st.rejected,
        total: st.open + st.closed + st.rejected,
        closure_ratio: closureRatio(st.open, st.closed),
      };
    });
  }

  byEntity = sortByClosureRatioDesc(byEntity);

  const entitiesRaw = Array.isArray(row.entities) ? row.entities : [];
  const entities = entitiesRaw
    .map((e) => {
      let id = String(e.entity_id || e.entity_label || '').trim().toLowerCase();
      if (!id || id === '(blank)' || id === 'blank') id = 'refex';
      let label = String(e.entity_label || id);
      if (isTravelManagementLabel(id, label)) {
        id = 'refex';
        label = 'Refex';
      }
      if (id === 'refex' || (id.includes('refex') && !id.includes('venwind') && !id.includes('extrovis'))) {
        id = 'refex';
        label = 'Refex';
      }
      if (id === 'extrovis' || id.includes('extrovis')) {
        id = 'extrovis';
        label = 'Extrovis';
      }
      if (id.includes('venwind')) {
        id = 'venwind';
        label = 'Venwind';
      }
      return { id, label, count: Number(e.count || 0) };
    })
    .filter((e) => e.id !== '(blank)' && e.id !== 'yes');

  const entityMerged = new Map();
  for (const e of entities) {
    const prev = entityMerged.get(e.id);
    if (prev) prev.count += e.count;
    else entityMerged.set(e.id, { ...e });
  }
  let entitiesOut = [...entityMerged.values()].sort((a, b) => b.count - a.count);
  // ITSM / Travel / Solar: always expose the full entity catalog in the picker
  // even when the selected entity filters metrics to one row (so Extrovis never disappears).
  if (itsm) {
    if (cacheRecords?.length) {
      entitiesOut = liveItsmCompanyCatalogFromRecords(cacheRecords, {
        userCompanyMap,
        dateFrom: periodScoped ? dateFrom : undefined,
        dateTo: periodScoped ? dateTo : undefined,
      });
    } else {
      const fromUsers = companiesFromUsers(usersRoster);
      if (fromUsers.length) {
        entitiesOut = fromUsers;
      } else {
        const catalogRaw = Array.isArray(row.entity_catalog) ? row.entity_catalog : entitiesRaw;
        const snapMap = new Map();
        for (const e of catalogRaw) {
          let id = String(e.entity_id || e.entity_label || '').trim().toLowerCase();
          if (!id || id === '(blank)' || id === 'blank') id = 'refex';
          if (id === 'extrovis' || id.includes('extrovis')) id = 'extrovis';
          else if (id.includes('refex') || id === '') id = 'refex';
          snapMap.set(id, (snapMap.get(id) || 0) + Number(e.count || 0));
        }
        entitiesOut = [
          {
            id: 'refex',
            label: 'Refex',
            count: Number(snapMap.get('refex') || 0),
          },
          {
            id: 'extrovis',
            label: 'Extrovis',
            count: Number(snapMap.get('extrovis') || 0),
          },
        ];
      }
    }
  } else if (travel) {
    if (cacheRecords?.length) {
      entitiesOut = liveEntityCatalogFromRecords(cacheRecords, {
        dateFrom: periodScoped ? dateFrom : undefined,
        dateTo: periodScoped ? dateTo : undefined,
        travelMode: true,
      });
    } else {
    const snapMap = new Map(entitiesOut.map((e) => [e.id, e.count]));
    entitiesOut = [
      { id: 'refex', label: 'Refex', count: Number(snapMap.get('refex') || 0) },
      { id: 'venwind', label: 'Venwind', count: Number(snapMap.get('venwind') || 0) },
    ];
    }
  } else if (solar) {
    if (cacheRecords?.length) {
      entitiesOut = liveEntityCatalogFromRecords(cacheRecords, {
        dateFrom: periodScoped ? dateFrom : undefined,
        dateTo: periodScoped ? dateTo : undefined,
      });
    }
  }

  const resourceOptions = [
    ...processRows.map((p) => ({
      resource_type: 'process',
      resource_id: p.process_id,
      resource_name: travel
        ? travelProcessLabel(p.process_id)
        : (p.process_name || p.process_id).replace(/_/g, ' '),
    })),
    ...boardIds.map((id) => ({
      resource_type: 'board',
      resource_id: id,
      resource_name: BOARD_DISPLAY_NAMES[id] || id.replace(/_/g, ' '),
    })),
  ];

  // CEO/CTO: MIS Open/Closed/Rejected must reconcile to the KPI cards (same totals).
  const leadZeroRoster = lead
    ? users.filter((u) => {
        const t = Number(u.open ?? u.pending ?? 0)
          + Number(u.closed ?? u.completed ?? 0)
          + Number(u.rejected || 0);
        return t <= 0;
      })
    : [];
  if (userFilterActive) {
    if (users.length) {
      openCount = users.reduce((s, u) => s + Number(u.open ?? u.pending ?? 0), 0);
      closedCount = users.reduce((s, u) => s + Number(u.closed ?? u.completed ?? 0), 0);
      rejectedCount = users.reduce((s, u) => s + Number(u.rejected ?? 0), 0);
      totalCount = openCount + closedCount + rejectedCount;
    }
    users = users
      .map((u) => {
        const o = Number(u.open ?? u.pending ?? 0);
        const c = Number(u.closed ?? u.completed ?? 0);
        const r = Number(u.rejected ?? 0);
        return {
          ...u,
          open: o,
          closed: c,
          rejected: r,
          total: o + c + r,
          pending: undefined,
          completed: undefined,
        };
      })
      .filter((u) => u.total > 0);
  } else if (entityOnlyActive && itsm) {
    users = filterUsersForEntityCompany(users, entityFilter, true);
    users = users
      .map((u) => {
        const o = Number(u.open ?? u.pending ?? 0);
        const c = Number(u.closed ?? u.completed ?? 0);
        const r = Number(u.rejected ?? 0);
        return {
          ...u,
          open: o,
          closed: c,
          rejected: r,
          total: o + c + r,
          pending: undefined,
          completed: undefined,
        };
      })
      .filter((u) => u.total > 0);
  } else if (entityOnlyActive && String(dataSource || '').startsWith('live_records')) {
    users = users
      .map((u) => {
        const o = Number(u.open ?? u.pending ?? 0);
        const c = Number(u.closed ?? u.completed ?? 0);
        const r = Number(u.rejected ?? 0);
        return {
          ...u,
          open: o,
          closed: c,
          rejected: r,
          total: o + c + r,
          pending: undefined,
          completed: undefined,
        };
      })
      .filter((u) => u.total > 0);
  } else {
    users = reconcileMisToKpis(users, {
      open: openCount,
      closed: closedCount,
      rejected: rejectedCount,
    });
  }
  if (leadZeroRoster.length) {
    const seen = new Set(users.map((u) => String(u.user_id || u.user_name || '').toLowerCase()));
    for (const z of leadZeroRoster) {
      const key = String(z.user_id || z.user_name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      users.push({
        ...z,
        open: 0,
        closed: 0,
        rejected: 0,
        total: 0,
        pending: undefined,
        completed: undefined,
      });
      seen.add(key);
    }
  }
  users = sortByClosureRatioDesc(users).slice(0, lead ? 100 : 50);

  const adoptionPct = Number(engagement.sign_in_rate_overall || 0);

  const byProcessRaw = Array.isArray(row.by_process) ? row.by_process : [];
  let by_process = byProcessRaw.map((p) => ({
    process_id: p.process_id,
    process_label: travel ? travelProcessLabel(p.process_id) : (p.process_label || p.process_id),
    process_name: travel ? travelProcessLabel(p.process_id) : (p.process_label || p.process_id),
    total: Number(p.total || 0),
    pending: Number(p.open_count || 0),
    open_count: Number(p.open_count || 0),
    in_progress: 0,
    completed: Number(p.closed_count || 0),
    closed: Number(p.closed_count || 0),
    rejected: Number(p.rejected || 0),
  }));
  // Travel: always surface Travel request / advance / expense with zero-fill for empty processes.
  if (travel) {
    const byId = new Map(by_process.map((p) => [p.process_id, p]));
    by_process = TRAVEL_PROCESS_META.map((meta) => {
      const found = byId.get(meta.process_id);
      return found || {
        process_id: meta.process_id,
        process_label: meta.label,
        process_name: meta.label,
        total: 0,
        pending: 0,
        open_count: 0,
        in_progress: 0,
        completed: 0,
        closed: 0,
        rejected: 0,
      };
    });
  } else if (!by_process.length) {
    // Legacy fallback for apps without process rows in the filtered set.
    by_process = byEntity.map((e) => ({
      process_id: e.entity_id,
      process_label: e.entity_label,
      process_name: e.entity_label,
      total: e.total,
      pending: e.open,
      open_count: e.open,
      in_progress: 0,
      completed: e.closed,
      closed: e.closed,
      rejected: e.rejected,
    }));
  }

  // Keep process breakdown totals consistent with KPI cards (esp. Travel live overlay).
  if (by_process.length && totalCount > 0) {
    const pOpen = by_process.reduce((s, p) => s + Number(p.open_count || 0), 0);
    const pClosed = by_process.reduce((s, p) => s + Number(p.closed || 0), 0);
    const pRejected = by_process.reduce((s, p) => s + Number(p.rejected || 0), 0);
    const pTotal = pOpen + pClosed + pRejected;
    if (pTotal > 0 && (pTotal !== totalCount || pOpen !== openCount)) {
      by_process = by_process.map((p) => {
        const open = pOpen > 0 ? Math.round((Number(p.open_count || 0) / pOpen) * openCount) : 0;
        const closed = pClosed > 0 ? Math.round((Number(p.closed || 0) / pClosed) * closedCount) : 0;
        const rejected = pRejected > 0 ? Math.round((Number(p.rejected || 0) / pRejected) * rejectedCount) : 0;
        return {
          ...p,
          open_count: open,
          pending: open,
          closed,
          completed: closed,
          rejected,
          total: open + closed + rejected,
        };
      });
      const driftOpen = openCount - by_process.reduce((s, p) => s + p.open_count, 0);
      const driftClosed = closedCount - by_process.reduce((s, p) => s + p.closed, 0);
      const driftRejected = rejectedCount - by_process.reduce((s, p) => s + p.rejected, 0);
      if (by_process.length) {
        const idx = by_process.reduce((best, p, i, arr) => (p.total > arr[best].total ? i : best), 0);
        by_process[idx].open_count = Math.max(0, by_process[idx].open_count + driftOpen);
        by_process[idx].pending = by_process[idx].open_count;
        by_process[idx].closed = Math.max(0, by_process[idx].closed + driftClosed);
        by_process[idx].completed = by_process[idx].closed;
        by_process[idx].rejected = Math.max(0, by_process[idx].rejected + driftRejected);
        by_process[idx].total = by_process[idx].open_count + by_process[idx].closed + by_process[idx].rejected;
      }
    }
  }

  return {
    environment,
    application_id: applicationId,
    application_name: applicationName,
    snapshot_at: snapshotAt,
    data_source: dataSource,
    filters: {
      entity: entityFilter,
      user: userFilter,
      process_id: processIdFilter || 'all',
      resource_type: boardIdFilter ? 'board' : processIdFilter ? 'process' : 'all',
      resource_id: boardIdFilter || processIdFilter || 'all',
      period: effectivePeriod,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      supports_entity_filter: true,
      supports_period_filter: true,
      supports_resource_filter: true,
    },
    entities: entitiesOut,
    processes: processRows.map((p) => ({
      process_id: p.process_id,
      process_name: travel ? travelProcessLabel(p.process_id) : p.process_name,
      resource_type: 'process',
    })),
    boards: boardIds.map((id) => ({
      board_id: id,
      board_name: BOARD_DISPLAY_NAMES[id] || id.replace(/_/g, ' '),
      resource_type: 'board',
    })),
    resource_options: resourceOptions,
    resources: {
      processes: processRows.length,
      boards: boardIds.length,
      dataforms: dataformIds.length,
      datasets: datasetIds.length,
    },
    metrics: {
      total: totalCount,
      open: openCount,
      in_progress: 0,
      pending: openCount,
      completed: closedCount,
      closed: closedCount,
      rejected: rejectedCount,
      projects: Number(row.distinct_projects || 0),
      total_users: Number(engagement.total_users || 0),
      signed_in_today: Number(engagement.active_today || 0),
      sign_in_rate_overall: adoptionPct,
      sign_in_rate_today: Number(engagement.sign_in_rate_today || 0),
      user_adoption_pct: adoptionPct,
      never_logged_in: Number(engagement.never_logged_in || 0),
      inactive_users: Number(engagement.inactive || 0),
      status_model: 'open_closed',
    },
    by_entity: byEntity,
    by_process,
    by_source,
    by_category,
    portfolio: (() => {
      const p = row.portfolio && typeof row.portfolio === 'object' ? row.portfolio : {};
      if (!pm) return undefined;
      return {
        projects_total: Number(p.projects_total || row.distinct_projects || 0),
        projects_open: Number(p.projects_open || 0),
        projects_closed: Number(p.projects_closed || 0),
        tasks_total: Number(p.tasks_total || 0),
        tasks_open: Number(p.tasks_open || 0),
        tasks_closed: Number(p.tasks_closed || 0),
        linked_tasks: Number(p.linked_tasks || 0),
        individual_total: Number(p.individual_total || 0),
        individual_open: Number(p.individual_open || 0),
        individual_closed: Number(p.individual_closed || 0),
        subtasks_total: Number(p.subtasks_total || 0),
        subtasks_open: Number(p.subtasks_open || 0),
        subtasks_closed: Number(p.subtasks_closed || 0),
      };
    })(),
    users,
    app_users: await loadAppRoster(pool, environment, applicationId),
    board_filter_note: boardIdFilter
      ? 'Board selected — item KPIs still come from connected processes (boards have no ticket rows in PostgreSQL).'
      : undefined,
    report_layout: dashboardReportLayout({ travel, itsm, solar, pm, lead }),
    filter_engine: 'v5-exec-filters-b',
  };
}

module.exports = {
  loadApplicationDashboard,
  isTravelApplication,
  TRAVEL_APP_ID,
};
