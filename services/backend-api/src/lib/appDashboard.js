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
} = require('./dashboardDisplay');
const { latestRunsCte } = require('./snapshotRuns');
const {
  loadApplicationEngagementCache,
  isEngagementCacheFresh,
  ENGAGEMENT_CACHE_TTL_MS,
} = require('./engagementCache');

const BOARD_DISPLAY_NAMES = {
  Project_Management_A01: 'Project Management Board',
};

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

const TRAVEL_PROCESS_META = [
  { process_id: 'Advance_Payment_Request_Process_A01', label: 'Payment Request', sort_order: 1 },
  { process_id: 'Expense_Management_A03', label: 'Expense Management', sort_order: 2 },
  { process_id: 'Travel_Management_A02', label: 'Travel Management', sort_order: 3 },
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
      return `${createdAtExpr} IS NOT NULL
        AND ${day} >= make_date(EXTRACT(YEAR FROM ${today})::int, 1, 1)
        AND ${day} <= ${today}`;
    case 'last_year': {
      const y = `EXTRACT(YEAR FROM ${today})::int - 1`;
      return `${createdAtExpr} IS NOT NULL
        AND ${day} >= make_date(${y}, 1, 1)
        AND ${day} <= make_date(${y}, 12, 31)`;
    }
    case 'fy': {
      const fy = indianFyBoundsSql();
      return `${createdAtExpr} IS NOT NULL AND ${day} BETWEEN ${fy.from} AND ${fy.to}`;
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
  const raw = String(entityRaw || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return 'true';

  const lower = raw.toLowerCase();
  const escaped = lower.replace(/'/g, "''");

  if (lower === '(blank)' || lower === 'blank' || lower === '__blank__') {
    // Blank Entity rolls into Refex for ITSM/Travel reports.
    return `(${keyColumn} IN ('', 'refex'))`;
  }

  if (lower === 'refex') {
    return `(${keyColumn} IN ('', 'refex') OR (${keyColumn} LIKE '%refex%' AND ${keyColumn} NOT LIKE '%venwind%' AND ${keyColumn} NOT LIKE '%extrovis%'))`;
  }

  if (lower === 'operation' || lower === 'operations') {
    return `(${keyColumn} IN ('operation', 'operations') OR ${keyColumn} LIKE '%operation%')`;
  }

  if (lower === 'finance') {
    return `(${keyColumn} IN ('finance') OR ${keyColumn} LIKE '%finance%')`;
  }

  if (lower === 'extrovis' || lower.includes('extrovis')) {
    return `(${keyColumn} = 'extrovis' OR ${keyColumn} LIKE '%extrovis%')`;
  }

  if (lower === 'venwind' || lower.includes('venwind')) {
    return `(${keyColumn} LIKE '%venwind%')`;
  }

  return `(${keyColumn} LIKE '%${escaped}%')`;
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

/**
 * @param {import('pg').Pool} pool
 * @param {{ environment: string, applicationId: string, entity?: string, processId?: string, resourceType?: string, resourceId?: string, period?: string, dateFrom?: string, dateTo?: string }} opts
 */
async function loadApplicationDashboard(pool, opts) {
  const environment = opts.environment || 'production';
  const applicationId = opts.applicationId;
  const entityFilter = String(opts.entity || 'all').trim() || 'all';
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
  const applicationName = appRows[0].application_name;
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

  const entityClause = entityFilterOnKeySql(entityFilter, 'entity_key');
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
  /** Solar slicer / matrix: Operation vs Finance (not site codes). */
  const solarCategoryKeySql = `CASE
      WHEN lower(trim(concat_ws(' ',
        coalesce(i.current_step, ''),
        coalesce(i.source_payload->>'Service_Category', ''),
        coalesce(i.source_payload->'Service_Category'->>'Name', ''),
        coalesce(i.source_payload->>'Expense_Type', ''),
        coalesce(i.source_payload->'Expense_Type'->>'Name', ''),
        coalesce(i.source_payload->>'Category', ''),
        coalesce(i.source_payload->'Category'->>'Name', ''),
        coalesce(i.source_payload->>'Department', ''),
        coalesce(i.source_payload->'Department'->>'Name', ''),
        coalesce(i.source_payload->>'Cost_Center', ''),
        coalesce(i.source_payload->>'Request_Type', '')
      ))) ~ '(financ|account|treasury|audit|invoice)' THEN 'finance'
      ELSE 'operation'
    END`;
  const entityKeyExpr = itsm
    ? itsmEntityKeySql('i')
    : solar
      ? solarCategoryKeySql
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
    NULLIF(trim(COALESCE(
      NULLIF(trim(i.source_payload->>'Project_ID'), ''),
      NULLIF(trim(i.source_payload->'Project_ID'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Project'), ''),
      NULLIF(trim(i.source_payload->'Project'->>'Name'), '')
    )), '') AS project_key,
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
),
filtered AS (
  SELECT * FROM classified
  WHERE (${entityClause})
    AND (${periodClause})
),
app_users AS (
  SELECT
    pu.user_id,
    COALESCE(NULLIF(trim(u.user_name), ''), pu.user_id) AS user_name,
    NULLIF(lower(trim(u.email)), '') AS email,
    u.last_sign_in
  FROM engagement_reporting.principal_user pu
  LEFT JOIN LATERAL (
    SELECT uu.user_name, uu.email, uu.last_sign_in
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
          WHEN 'Advance_Payment_Request_Process_A01' THEN 'Payment Request'
          WHEN 'Expense_Management_A03' THEN 'Expense Management'
          WHEN 'Travel_Management_A02' THEN 'Travel Management'
          ELSE replace(f.process_id, '_', ' ')
        END AS process_label,
        CASE f.process_id
          WHEN 'Advance_Payment_Request_Process_A01' THEN 1
          WHEN 'Expense_Management_A03' THEN 2
          WHEN 'Travel_Management_A02' THEN 3
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
            COALESCE(
              NULLIF(trim(f.source_payload->'Assigned_To'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'Assigned_To'->>'Id'), ''),
              CASE
                WHEN jsonb_typeof(f.source_payload->'Assigned_To') = 'string'
                  THEN NULLIF(trim(f.source_payload->>'Assigned_To'), '')
                ELSE NULL
              END,
              NULLIF(trim(f.source_payload->'Assignee'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'Assignee'->>'Id'), ''),
              CASE
                WHEN jsonb_typeof(f.source_payload->'Assignee') = 'string'
                  THEN NULLIF(trim(f.source_payload->>'Assignee'), '')
                ELSE NULL
              END,
              NULLIF(trim(f.source_payload->'AssignedTo'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'AssignedTo'->>'Id'), ''),
              CASE
                WHEN jsonb_typeof(f.source_payload->'AssignedTo') = 'string'
                  THEN NULLIF(trim(f.source_payload->>'AssignedTo'), '')
                ELSE NULL
              END,
              NULLIF(trim(f.source_payload->'Owner'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'Owner'->>'Id'), ''),
              CASE
                WHEN jsonb_typeof(f.source_payload->'Owner') = 'string'
                  THEN NULLIF(trim(f.source_payload->>'Owner'), '')
                ELSE NULL
              END,
              NULLIF(trim(f.source_payload->'Lead_Owner'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'Sales_Person'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'Sales_Person'->>'Id'), ''),
              CASE
                WHEN jsonb_typeof(f.source_payload->'Sales_Person') = 'string'
                  THEN NULLIF(trim(f.source_payload->>'Sales_Person'), '')
                ELSE NULL
              END,
              NULLIF(trim(f.source_payload->'assigned_to'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'_current_assigned_to'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'_modified_by'->>'_id'), ''),
              NULLIF(trim(f.source_payload->'_created_by'->>'_id'), ''),
              NULLIF(lower(trim(f.source_payload->'Assigned_To'->>'Email')), ''),
              NULLIF(lower(trim(f.source_payload->'Assignee'->>'Email')), ''),
              NULLIF(lower(trim(f.source_payload->'AssignedTo'->>'Email')), ''),
              NULLIF(lower(trim(f.source_payload->'Owner'->>'Email')), ''),
              NULLIF(lower(trim(f.source_payload->'Sales_Person'->>'Email')), ''),
              f.requester_email
            ) AS owner_key,
            COALESCE(
              NULLIF(trim(f.source_payload->'Assigned_To'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Assignee'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'AssignedTo'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Owner'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Lead_Owner'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'Sales_Person'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'_current_assigned_to'->>'Name'), ''),
              NULLIF(trim(f.source_payload->'_created_by'->>'Name'), ''),
              f.requester_name
            ) AS owner_name
          FROM filtered f
        ) owned
        WHERE owner_key IS NOT NULL AND owner_key <> ''
        GROUP BY owner_key
      ) ic
      LEFT JOIN LATERAL (
        SELECT au0.user_id, au0.user_name, au0.email, au0.last_sign_in
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
    || processIdFilter
    || boardIdFilter
    || (effectivePeriod && effectivePeriod !== 'all')
  );

  let dataSource = 'snapshot';
  let snapshotAt = row.snapshot_at || null;
  let users = Array.isArray(row.users) ? row.users : [];
  let liveSourceBuckets = null;
  let liveTotals = null;
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
        if (totals.by_source && typeof totals.by_source === 'object') {
          liveSourceBuckets = totals.by_source;
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
            return {
              ...u,
              user_name: u.user_name || hit.user_name || u.user_id,
              last_sign_in: hit.last_sign_in || u.last_sign_in || null,
            };
          });
          for (const u of cache.items) {
            const id = String(u.user_id || '');
            if (!id || seen.has(id)) continue;
            const assigned =
              Number(u.assigned || 0)
              || (Number(u.open || 0) + Number(u.completed || 0) + Number(u.closed || 0) + Number(u.rejected || 0));
            if (!lead && assigned <= 0) continue;
            users.push({
              user_id: id,
              user_name: u.user_name || u.email || id,
              email: u.email || '',
              last_sign_in: u.last_sign_in || null,
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
          return {
            ...u,
            user_name: u.user_name || hit.user_name || u.user_id,
            last_sign_in: hit.last_sign_in || u.last_sign_in || null,
          };
        });
      }
    }
  } catch {
    // cache overlay best-effort
  }

  users = cleanMisUsers(users);
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
  if (
    effectivePeriod === 'daily'
    && liveTotals
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

  // ITSM entity-only (period=all): scale snapshot entity share to live totals so
  // Refex / Extrovis KPIs match the unfiltered matrix (not raw snapshot 329/6).
  const entityLower = String(entityFilter || '').toLowerCase();
  const itsmEntityOnly =
    itsm
    && kpiFiltersActive
    && effectivePeriod === 'all'
    && !processIdFilter
    && !boardIdFilter
    && (entityLower === 'refex' || entityLower === 'extrovis' || entityLower.includes('extrovis'));
  if (itsmEntityOnly && liveTotals) {
    const liveOpen = Number(liveTotals.open_tickets || 0);
    const liveClosed = Number(liveTotals.closed_tickets || 0);
    const liveRejected = Number(liveTotals.rejected_tickets || 0);
    const liveTotal = liveOpen + liveClosed + liveRejected;
    if (liveTotal > 0) {
      const entitiesRaw = Array.isArray(row.entities) ? row.entities : [];
      let snapRefex = 0;
      let snapExt = 0;
      for (const e of entitiesRaw) {
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
  // Travel entity picker: Venwind + Refex only (Travel Management folded into Refex).
  if (travel) {
    entitiesOut = entitiesOut.filter((e) => e.id === 'venwind' || e.id === 'refex');
  }
  // Solar slicer: Operation / Finance only (same keys as entity matrix).
  if (solar) {
    const op = entityMerged.get('operation') || entityMerged.get('operations');
    const fin = entityMerged.get('finance');
    entitiesOut = [
      { id: 'operation', label: 'Operation', count: Number(op?.count || 0) },
      { id: 'finance', label: 'Finance', count: Number(fin?.count || 0) },
    ];
  }
  // ITSM: align entity picker counts with live-scaled by_entity (not stale snapshot 329/6).
  if (itsm && liveTotals && byEntity.length) {
    const liveMap = new Map(byEntity.map((e) => [String(e.entity_id).toLowerCase(), e.total]));
    if (!kpiFiltersActive || dataSource === 'live_overlay' || dataSource === 'live_overlay_entity') {
      entitiesOut = entitiesOut.map((e) => ({
        ...e,
        count: liveMap.has(e.id) ? Number(liveMap.get(e.id) || 0) : e.count,
      }));
      // When unfiltered, ensure both entities present with scaled totals.
      if (!kpiFiltersActive) {
        for (const e of byEntity) {
          const id = String(e.entity_id).toLowerCase();
          if (!entitiesOut.some((x) => x.id === id)) {
            entitiesOut.push({ id, label: e.entity_label, count: e.total });
          }
        }
        entitiesOut.sort((a, b) => b.count - a.count);
      }
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
  users = reconcileMisToKpis(users, {
    open: openCount,
    closed: closedCount,
    rejected: rejectedCount,
  });
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
  // Travel: always surface Payment Request / Expense / Travel with zero-fill for empty processes.
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
    board_filter_note: boardIdFilter
      ? 'Board selected — item KPIs still come from connected processes (boards have no ticket rows in PostgreSQL).'
      : undefined,
    report_layout: travel
      ? {
          kind: 'travel',
          rows: ['Overall KPIs', 'Entity matrix (Venwind / Refex)', 'MIS Open & Closed'],
          entity_reports: ['Venwind', 'Refex'],
          note: 'Travel Management process counts are included under Refex — not shown as a separate entity.',
        }
      : itsm
        ? {
            kind: 'itsm',
            rows: ['Overall KPIs', 'Entity + status', 'Source trend', 'Entity matrix', 'MIS users'],
            note: 'Refex = Live_IT_Service_Request_A00 (blank Entity counted as Refex). Extrovis = Extrovis process.',
          }
        : solar
          ? {
              kind: 'solar',
              rows: ['Overall KPIs', 'Operation vs Finance', 'Entity matrix', 'MIS users'],
              note: 'Non-Finance teams are counted under Operations.',
            }
          : pm
            ? {
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
              }
            : lead
              ? {
                  kind: 'lead',
                  rows: ['Overall KPIs', 'Entity matrix by closure ratio', 'MIS users'],
                  note: 'Lead Tracker — Open / Closed / Rejected; entity table sorted by closure ratio.',
                  kpi_labels: { total: 'Total leads', open: 'Open leads', closed: 'Closed leads' },
                }
              : {
                  kind: 'generic',
                  rows: ['Overall KPIs', 'Entity matrix', 'Users'],
                },
    filter_engine: 'v5-exec-filters-b',
  };
}

module.exports = {
  loadApplicationDashboard,
  isTravelApplication,
  TRAVEL_APP_ID,
};
