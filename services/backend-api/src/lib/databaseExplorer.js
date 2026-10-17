'use strict';

/**
 * Paginated GCP data browser for Admin UI /database.
 * Kissflow apps: latest raw item snapshot ∪ engagement_cache.records (no Kissflow HTTP).
 * P2P: read-only MySQL purchase_requests + purchase_orders.
 */

/** Newest completed snapshot per process — Database only, does not change dashboard KPIs. */
function newestRunsCte({ environmentParam = '$1', alias = 'latest_runs' } = {}) {
  return `${alias} AS (
  SELECT DISTINCT ON (sr.process_id)
    sr.process_id,
    sr.snapshot_run_id,
    COALESCE(sr.item_record_count, 0)::int AS item_record_count,
    COALESCE(sr.load_completed_at, sr.extraction_completed_at, sr.created_at) AS snapshot_at
  FROM engagement_reporting.snapshot_run sr
  WHERE sr.environment = ${environmentParam}
    AND sr.status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
    AND (
      sr.application_id IN (SELECT application_id FROM apps)
      OR sr.process_id IN (SELECT process_id FROM procs)
    )
  ORDER BY sr.process_id,
    COALESCE(sr.load_completed_at, sr.extraction_completed_at, sr.created_at) DESC,
    sr.created_at DESC
)`;
}

const latestRunsCte = newestRunsCte;
const { friendlyApplicationName } = require('./dashboardDisplay');
const { isHiddenNeApplication, LEAD_APP_ID, LEAD_VENWIND_PROCESS_ID } = require('./leadScope');
const { isP2pApplication } = require('./p2pDashboard');
const { isP2pConfigured, p2pQuery } = require('./p2pReadonly');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LEN = 80;

const ITEM_COLUMNS = [
  { id: 'row_source', label: 'row_source' },
  { id: 'instance_id', label: 'instance_id' },
  { id: 'request_id', label: 'request_id' },
  { id: 'process_id', label: 'process_id' },
  { id: 'process_status', label: 'process_status' },
  { id: 'current_step', label: 'current_step' },
  { id: 'stage', label: 'stage' },
  { id: 'entity', label: 'entity' },
  { id: 'requester_email', label: 'requester_email' },
  { id: 'criticality', label: 'criticality' },
  { id: 'request_number', label: 'request_number' },
  { id: 'snapshot_at', label: 'snapshot_at' },
  { id: 'snapshot_run_id', label: 'snapshot_run_id' },
  { id: 'source_payload', label: 'source_payload' },
];

function normalizeEnvironment(value) {
  const lower = String(value || 'production').toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower;
}

function normalizeApplicationId(applicationId) {
  const id = String(applicationId || '').trim();
  const m = id.match(/^(?:production|development|uat|staging)-(.+)$/i);
  return m ? m[1] : id;
}

function clampPage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(1_000_000, Math.floor(n));
}

function clampPageSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

function normalizeSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LEN);
}

function remappedApplicationIdSql(alias = 'p') {
  return `CASE
    WHEN ${alias}.process_id = '${LEAD_VENWIND_PROCESS_ID}' THEN '${LEAD_APP_ID}'
    ELSE ${alias}.application_id
  END`;
}

function identityKeys(row) {
  const keys = new Set();
  const inst = String(row.instance_id || row.id || '').trim().toLowerCase();
  const req = String(row.request_id || '').trim().toLowerCase();
  if (inst && inst !== '—' && inst !== '-') keys.add(`id:${inst}`);
  if (req && req !== '—' && req !== '-') keys.add(`req:${req}`);
  return keys;
}

function cacheRecordToRow(rec) {
  return {
    process_id: rec.process_id || '',
    process_name: rec.process_id || '',
    instance_id: String(rec.instance_id || rec.id || ''),
    request_id: rec.request_id || '',
    process_status: rec.status_raw || rec.status || '',
    current_step: rec.current_step || '',
    stage: rec.form_status || rec.stage || '',
    entity: rec.entity || rec.company || '',
    requester_email: rec.requested_by || rec.assignee_email || '',
    criticality: rec.criticality || '',
    request_number: null,
    snapshot_at: rec.created_at || rec.modified_at || rec.closed_at || null,
    snapshot_run_id: 'engagement_cache',
    source_payload: rec,
    row_source: 'engagement_cache',
  };
}

/** Prefer raw snapshot item when the same ticket also exists in engagement_cache. */
function mergeSnapshotAndCache(itemRows, cacheRecords) {
  const usedCache = new Set();
  const cacheByKey = new Map();
  (cacheRecords || []).forEach((rec, idx) => {
    for (const key of identityKeys(rec)) {
      if (!cacheByKey.has(key)) cacheByKey.set(key, idx);
    }
  });

  const merged = [];
  for (const item of itemRows || []) {
    for (const key of identityKeys(item)) {
      const idx = cacheByKey.get(key);
      if (idx != null) usedCache.add(idx);
    }
    merged.push({ ...item, row_source: item.row_source || 'item' });
  }
  (cacheRecords || []).forEach((rec, idx) => {
    if (usedCache.has(idx)) return;
    merged.push(cacheRecordToRow(rec));
  });
  return merged;
}

function rowSortTime(row) {
  const t = Date.parse(String(row.snapshot_at || ''));
  return Number.isNaN(t) ? 0 : t;
}

function filterMergedRows(rows, { processId = '', search = '', status = '', entity = '', source = '' } = {}) {
  const processFilter = String(processId || '').trim();
  const statusFilter = String(status || '').trim().toLowerCase();
  const entityFilter = String(entity || '').trim().toLowerCase();
  const sourceFilter = String(source || '').trim().toLowerCase();
  const q = normalizeSearch(search).toLowerCase();
  return (rows || []).filter((row) => {
    if (processFilter && String(row.process_id || '') !== processFilter) return false;
    if (statusFilter && String(row.process_status || '').toLowerCase() !== statusFilter) return false;
    if (entityFilter && String(row.entity || '').toLowerCase() !== entityFilter) return false;
    if (sourceFilter && String(row.row_source || '').toLowerCase() !== sourceFilter) return false;
    if (!q) return true;
    const hay = [
      row.instance_id,
      row.request_id,
      row.process_id,
      row.process_status,
      row.current_step,
      row.entity,
      row.requester_email,
      row.row_source,
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

const ROW_FIELD_IDS = [
  'row_source',
  'instance_id',
  'request_id',
  'process_id',
  'process_status',
  'current_step',
  'stage',
  'entity',
  'requester_email',
  'criticality',
  'request_number',
  'snapshot_at',
  'snapshot_run_id',
];

const DEFAULT_FIELD_PREF = [
  'request_id',
  'instance_id',
  'process_id',
  'process_status',
  'current_step',
  'entity',
  'snapshot_at',
];

function hasDisplayValue(value) {
  if (value == null) return false;
  if (typeof value === 'string' && (!value.trim() || value === '—')) return false;
  return true;
}

function collectAvailableFields(rows) {
  const counts = new Map();
  const add = (id, present) => {
    const key = String(id || '').trim();
    if (!key || key === 'source_payload') return;
    const cur = counts.get(key) || { id: key, label: key, value_count: 0 };
    if (present) cur.value_count += 1;
    counts.set(key, cur);
  };
  for (const row of rows || []) {
    for (const id of ROW_FIELD_IDS) add(id, hasDisplayValue(row[id]));
    const payload = row.source_payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'object' && value !== null) continue;
      add(key, hasDisplayValue(value));
    }
  }
  return [...counts.values()]
    .filter((field) => Number(field.value_count || 0) > 0)
    .sort((a, b) => b.value_count - a.value_count || a.id.localeCompare(b.id))
    .slice(0, 100);
}

function defaultVisibleFields(fields) {
  const usable = (fields || []).filter((field) => Number(field.value_count || 0) > 0);
  const preferred = DEFAULT_FIELD_PREF.filter((id) => usable.some((field) => field.id === id));
  const extras = usable.filter((field) => !preferred.includes(field.id)).slice(0, 8).map((field) => field.id);
  return [...preferred, ...extras].slice(0, 12);
}

function uniqueFilterValues(rows, key) {
  const set = new Set();
  for (const row of rows || []) {
    const value = String(row[key] || '').trim();
    if (value && value !== '—') set.add(value);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function decoratePagePayload(base, merged, pageRows, filters) {
  const fields = collectAvailableFields(pageRows.length ? pageRows : merged.slice(0, 25));
  return {
    ...base,
    columns: fields.filter((field) => field.value_count > 0).map((field) => ({ id: field.id, label: field.label })),
    available_fields: fields,
    default_columns: defaultVisibleFields(fields),
    filter_options: {
      statuses: uniqueFilterValues(merged, 'process_status'),
      entities: uniqueFilterValues(merged, 'entity'),
      sources: uniqueFilterValues(merged, 'row_source'),
    },
    process_id: filters.processId || null,
    status: filters.status || null,
    entity: filters.entity || null,
    source: filters.source || null,
    search: filters.search || null,
  };
}

function processOptionsFromRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row.process_id || '').trim();
    if (!id) continue;
    const cur = map.get(id) || { process_id: id, process_name: row.process_name || id, item_count: 0 };
    cur.item_count += 1;
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => String(a.process_name).localeCompare(String(b.process_name)));
}

function decorateApp(row) {
  return {
    application_id: row.application_id,
    application_name: friendlyApplicationName(row.application_id, row.application_name),
    schema: row.schema_name || 'engagement_reporting',
    table_name: row.table_name || 'item',
    item_count: Number(row.item_count || 0),
    snapshot_count: Number(row.snapshot_count || 0),
    cache_count: Number(row.cache_count || 0),
    process_count: Number(row.process_count || 0),
    snapshot_at: row.snapshot_at || null,
    last_seen_at: row.last_seen_at || null,
    data_source: row.data_source || 'snapshot+cache',
  };
}

async function p2pTableCounts() {
  if (!isP2pConfigured()) return { total: 0, purchase_requests: 0, purchase_orders: 0 };
  const [pr, po] = await Promise.all([
    p2pQuery('SELECT COUNT(*) AS n FROM purchase_requests'),
    p2pQuery('SELECT COUNT(*) AS n FROM purchase_orders'),
  ]);
  const purchase_requests = Number(pr?.[0]?.n || pr?.[0]?.N || 0);
  const purchase_orders = Number(po?.[0]?.n || po?.[0]?.N || 0);
  return { total: purchase_requests + purchase_orders, purchase_requests, purchase_orders };
}

async function listDatabaseApplications(pool, { environment = 'production' } = {}) {
  const env = normalizeEnvironment(environment);
  const sql = `
WITH apps AS (
  SELECT
    application_id,
    application_name,
    last_seen_at,
    COALESCE(jsonb_array_length(source_payload->'engagement_cache'->'records'), 0)::int AS cache_count
  FROM engagement_reporting.application
  WHERE environment = $1 AND is_current = true
),
procs AS (
  SELECT application_id, process_id
  FROM engagement_reporting.process
  WHERE environment = $1 AND is_current = true
),
${latestRunsCte({ environmentParam: '$1', alias: 'latest_runs' })},
counts AS (
  SELECT
    ${remappedApplicationIdSql('p')} AS application_id,
    count(*)::int AS snapshot_count,
    max(i.snapshot_at) AS snapshot_at,
    count(DISTINCT i.process_id)::int AS process_count
  FROM engagement_reporting.item i
  INNER JOIN latest_runs lr
    ON i.snapshot_run_id = lr.snapshot_run_id
   AND i.process_id = lr.process_id
  INNER JOIN procs p ON p.process_id = i.process_id
  WHERE i.environment = $1
  GROUP BY 1
)
SELECT
  a.application_id,
  a.application_name,
  a.last_seen_at,
  a.cache_count,
  COALESCE(c.snapshot_count, 0)::int AS snapshot_count,
  COALESCE(c.process_count, 0)::int AS process_count,
  c.snapshot_at
FROM apps a
LEFT JOIN counts c ON c.application_id = a.application_id
ORDER BY a.application_name
`;
  const { rows } = await pool.query(sql, [env]);
  let p2pCounts = { total: 0 };
  try {
    p2pCounts = await p2pTableCounts();
  } catch {
    p2pCounts = { total: 0 };
  }

  const items = (rows || [])
    .filter((row) => !isHiddenNeApplication(row.application_id, row.application_name))
    .map((row) => {
      const p2p = isP2pApplication(row.application_id, row.application_name);
      const snapshotCount = Number(row.snapshot_count || 0);
      const cacheCount = Number(row.cache_count || 0);
      const itemCount = p2p ? p2pCounts.total : Math.max(snapshotCount, cacheCount);
      return decorateApp({
        ...row,
        item_count: itemCount,
        snapshot_count: snapshotCount,
        cache_count: p2p ? p2pCounts.total : cacheCount,
        schema_name: p2p ? 'p2p_system' : 'engagement_reporting',
        table_name: p2p ? 'purchase_requests + purchase_orders' : 'item + engagement_cache',
        data_source: p2p ? 'p2p_mysql' : 'snapshot+cache',
        process_count: p2p ? 2 : row.process_count,
      });
    });
  return {
    schema: 'engagement_reporting',
    table_name: 'item',
    environment: env,
    items,
    count: items.length,
  };
}

async function loadSnapshotItemKeys(pool, env, appId) {
  const sql = `
WITH apps AS (
  SELECT DISTINCT application_id
  FROM engagement_reporting.process
  WHERE environment = $1 AND is_current = true
),
procs AS (
  SELECT application_id, process_id, process_name
  FROM engagement_reporting.process
  WHERE environment = $1 AND is_current = true
),
${latestRunsCte({ environmentParam: '$1', alias: 'latest_runs' })}
SELECT
  i.environment,
  i.process_id,
  COALESCE(p.process_name, i.process_id) AS process_name,
  i.instance_id,
  i.request_id,
  i.process_status,
  i.current_step,
  i.stage,
  i.entity,
  i.requester_email,
  i.criticality,
  i.request_number,
  i.snapshot_at,
  i.snapshot_run_id
FROM engagement_reporting.item i
INNER JOIN latest_runs lr
  ON i.snapshot_run_id = lr.snapshot_run_id
 AND i.process_id = lr.process_id
INNER JOIN procs p ON p.process_id = i.process_id
WHERE i.environment = $1
  AND ${remappedApplicationIdSql('p')} = $2
`;
  const { rows } = await pool.query(sql, [env, appId]);
  return rows || [];
}

async function loadCacheRecords(pool, env, appId) {
  const { rows } = await pool.query(
    `SELECT source_payload->'engagement_cache'->'records' AS records
     FROM engagement_reporting.application
     WHERE environment = $1 AND application_id = $2 AND is_current = true
     LIMIT 1`,
    [env, appId],
  );
  const records = rows[0]?.records;
  return Array.isArray(records) ? records : [];
}

async function hydrateItemPayloads(pool, env, pageRows) {
  const targets = pageRows.filter((row) => row.row_source === 'item' && row.instance_id && row.snapshot_run_id);
  if (!targets.length) return pageRows;
  const { rows } = await pool.query(
    `SELECT process_id, instance_id, snapshot_run_id, source_payload
     FROM engagement_reporting.item
     WHERE environment = $1
       AND (process_id, instance_id, snapshot_run_id) IN (
         SELECT * FROM unnest($2::text[], $3::text[], $4::text[])
           AS t(process_id, instance_id, snapshot_run_id)
       )`,
    [
      env,
      targets.map((row) => row.process_id),
      targets.map((row) => row.instance_id),
      targets.map((row) => row.snapshot_run_id),
    ],
  );
  const map = new Map();
  for (const row of rows || []) {
    map.set(`${row.process_id}|${row.instance_id}|${row.snapshot_run_id}`, row.source_payload);
  }
  return pageRows.map((row) => {
    if (row.row_source !== 'item') return row;
    const payload = map.get(`${row.process_id}|${row.instance_id}|${row.snapshot_run_id}`);
    return payload ? { ...row, source_payload: payload } : row;
  });
}

async function listP2pDatabaseItems({
  processId = '',
  search = '',
  status = '',
  entity = '',
  source = '',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const safePage = clampPage(page);
  const safeSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safeSize;
  const q = normalizeSearch(search).toLowerCase();
  const processFilter = String(processId || '').trim();

  const started = Date.now();
  const wantPr = !processFilter || processFilter === 'purchase_requests';
  const wantPo = !processFilter || processFilter === 'purchase_orders';
  const [prRows, poRows] = await Promise.all([
    wantPr ? p2pQuery('SELECT * FROM purchase_requests') : [],
    wantPo ? p2pQuery('SELECT * FROM purchase_orders') : [],
  ]);

  const mapped = [
    ...(prRows || []).map((row) => ({
      process_id: 'purchase_requests',
      process_name: 'purchase_requests',
      instance_id: String(row.id ?? ''),
      request_id: String(row.pr_number || row.request_number || row.id || ''),
      process_status: row.status || '',
      current_step: row.status || '',
      stage: row.status || '',
      entity: row.entity_id != null ? String(row.entity_id) : '',
      requester_email: '',
      criticality: '',
      request_number: row.id ?? null,
      snapshot_at: row.updated_at || row.submitted_at || row.created_at || null,
      snapshot_run_id: 'p2p_mysql',
      source_payload: row,
      row_source: 'p2p_mysql',
    })),
    ...(poRows || []).map((row) => ({
      process_id: 'purchase_orders',
      process_name: 'purchase_orders',
      instance_id: String(row.id ?? ''),
      request_id: String(row.po_number || row.order_number || row.id || ''),
      process_status: row.status || '',
      current_step: row.status || '',
      stage: row.status || '',
      entity: row.entity_id != null ? String(row.entity_id) : '',
      requester_email: '',
      criticality: '',
      request_number: row.id ?? null,
      snapshot_at: row.updated_at || row.created_at || row.po_date || null,
      snapshot_run_id: 'p2p_mysql',
      source_payload: row,
      row_source: 'p2p_mysql',
    })),
  ];

  const filters = { processId: processFilter, search: q, status, entity, source };
  const filtered = filterMergedRows(mapped, filters);
  filtered.sort((a, b) => rowSortTime(b) - rowSortTime(a) || String(b.instance_id).localeCompare(String(a.instance_id)));
  const total = filtered.length;
  const items = filtered.slice(offset, offset + safeSize);
  return decoratePagePayload({
    schema: 'p2p_system',
    table_name: 'purchase_requests + purchase_orders',
    environment: 'production',
    application_id: 'Procurement_to_Pay_A00',
    application_name: 'Procurement to Pay',
    items,
    processes: processOptionsFromRows(mapped),
    total,
    page: safePage,
    page_size: safeSize,
    page_count: Math.max(1, Math.ceil(total / safeSize)),
    query_ms: Date.now() - started,
    data_source: 'p2p_mysql',
  }, mapped, items, filters);
}

async function listDatabaseItems(pool, {
  environment = 'production',
  applicationId,
  processId = '',
  search = '',
  status = '',
  entity = '',
  source = '',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const env = normalizeEnvironment(environment);
  const appId = normalizeApplicationId(applicationId);
  if (!appId) {
    const err = new Error('applicationId is required');
    err.code = 'APP_ID_REQUIRED';
    throw err;
  }

  if (isP2pApplication(appId)) {
    if (!isP2pConfigured()) {
      return {
        schema: 'p2p_system',
        table_name: 'purchase_requests + purchase_orders',
        environment: env,
        application_id: appId,
        application_name: 'Procurement to Pay',
        columns: ITEM_COLUMNS,
        items: [],
        processes: [],
        total: 0,
        page: 1,
        page_size: clampPageSize(pageSize),
        page_count: 1,
        warning: 'P2P_NOT_CONFIGURED',
        data_source: 'p2p_mysql',
      };
    }
    return listP2pDatabaseItems({ processId, search, status, entity, source, page, pageSize });
  }

  const safePage = clampPage(page);
  const safeSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safeSize;
  const q = normalizeSearch(search);
  const processFilter = String(processId || '').trim();
  const started = Date.now();

  const [itemRows, cacheRecords] = await Promise.all([
    loadSnapshotItemKeys(pool, env, appId),
    loadCacheRecords(pool, env, appId),
  ]);
  const merged = mergeSnapshotAndCache(itemRows, cacheRecords);
  const filters = { processId: processFilter, search: q, status, entity, source };
  const filtered = filterMergedRows(merged, filters);
  filtered.sort((a, b) => rowSortTime(b) - rowSortTime(a) || String(b.instance_id || '').localeCompare(String(a.instance_id || '')));
  const total = filtered.length;
  const pageRows = await hydrateItemPayloads(pool, env, filtered.slice(offset, offset + safeSize));

  return decoratePagePayload({
    schema: 'engagement_reporting',
    table_name: 'item + engagement_cache',
    environment: env,
    application_id: appId,
    application_name: friendlyApplicationName(appId, appId),
    items: pageRows,
    processes: processOptionsFromRows(merged),
    total,
    page: safePage,
    page_size: safeSize,
    page_count: Math.max(1, Math.ceil(total / safeSize)),
    query_ms: Date.now() - started,
    snapshot_count: itemRows.length,
    cache_count: cacheRecords.length,
    data_source: 'snapshot+cache',
  }, merged, pageRows, filters);
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  ITEM_COLUMNS,
  normalizeEnvironment,
  normalizeApplicationId,
  clampPage,
  clampPageSize,
  normalizeSearch,
  identityKeys,
  mergeSnapshotAndCache,
  filterMergedRows,
  collectAvailableFields,
  defaultVisibleFields,
  listDatabaseApplications,
  listDatabaseItems,
};
