'use strict';

/**
 * Procurement to Pay dashboard metrics — direct read-only MySQL.
 * Schema mapping is best-effort; adjust SQL once the live p2p_system tables are confirmed.
 */

const { isP2pConfigured, p2pQuery } = require('./p2pReadonly');

const P2P_APPLICATION_ID = 'Procurement_to_Pay_A00';
const P2P_APPLICATION_NAME = 'Procurement to Pay';

function isP2pApplication(applicationId, applicationName) {
  const hay = `${applicationId || ''} ${applicationName || ''}`.toLowerCase();
  return (
    hay.includes('procurement')
    || hay.includes('procurement_to_pay')
    || applicationId === P2P_APPLICATION_ID
    || hay === 'p2p'
  );
}

const P2P_PROCESS_ID = 'p2p_system';

/** Live p2p_system document tables (confirmed Aug 2026). */
const P2P_PR_TABLE = 'purchase_requests';
const P2P_PO_TABLE = 'purchase_orders';

/** PR statuses are uppercase varchar; PO statuses are lowercase enum. */
const P2P_PO_REJECTED_STATUSES = ['rejected', 'cancelled'];
const P2P_PO_CLOSED_STATUSES = [
  'approved',
  'awaiting_grn',
  'grn_completed',
  'invoice_entry',
  'pending_accounts_approval',
  'approved_for_payment',
  'paid',
];
const P2P_PO_OPEN_STATUSES = [
  'draft',
  'imported',
  'pending_approval',
  'pending_buyer_verify',
  'sent_to_vendor',
];

function sqlInList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
}

function knownP2pColumns(tableName) {
  const t = String(tableName || '').toLowerCase();
  if (t === P2P_PR_TABLE) return { statusCol: 'status', amountCol: 'total_amount' };
  if (t === P2P_PO_TABLE) return { statusCol: 'status', amountCol: 'grand_total' };
  return null;
}

function buildP2pStatusSql(tableName, statusCol, amountCol, tableAlias = '') {
  const t = String(tableName || '').toLowerCase();
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const status = `${prefix}\`${statusCol}\``;
  const amount = amountCol ? `${prefix}\`${amountCol}\`` : null;

  if (t === P2P_PR_TABLE) {
    const st = `UPPER(TRIM(CAST(${status} AS CHAR)))`;
    return {
      rejectedExpr: `CASE WHEN ${st} = 'REJECTED' THEN 1 ELSE 0 END`,
      closedExpr: `CASE WHEN ${st} = 'APPROVED' THEN 1 ELSE 0 END`,
      openExpr: `CASE WHEN ${st} NOT IN ('REJECTED', 'APPROVED') AND ${st} != '' THEN 1 ELSE 0 END`,
      amountOpenExpr: amount ? `CASE WHEN ${st} NOT IN ('REJECTED', 'APPROVED') AND ${st} != '' THEN ${amount} ELSE 0 END` : '0',
      amountTotalExpr: amount ? amount : '0',
    };
  }

  if (t === P2P_PO_TABLE) {
    const rejectedIn = sqlInList(P2P_PO_REJECTED_STATUSES);
    const closedIn = sqlInList(P2P_PO_CLOSED_STATUSES);
    const openIn = sqlInList(P2P_PO_OPEN_STATUSES);
    const statusLower = `LOWER(${status})`;
    return {
      rejectedExpr: `CASE WHEN ${statusLower} IN (${rejectedIn}) THEN 1 ELSE 0 END`,
      closedExpr: `CASE WHEN ${statusLower} IN (${closedIn}) THEN 1 ELSE 0 END`,
      openExpr: `CASE WHEN ${statusLower} IN (${openIn}) THEN 1 ELSE 0 END`,
      amountOpenExpr: amount ? `CASE WHEN ${statusLower} IN (${openIn}) THEN ${amount} ELSE 0 END` : '0',
      amountTotalExpr: amount ? amount : '0',
    };
  }

  return null;
}

/** Child / config tables — never use for PR/PO KPI totals. */
const P2P_AUX_TABLE_RE =
  /_(approvals|line_items|letterhead|site_lookup|configs|documents|invitations|submissions|permissions|logs|lookups|masters)$/;

/**
 * Register P2P in engagement_reporting so Admin UI lists it.
 * No Kissflow credentials — MySQL RO is configured via env/secrets only.
 */
async function ensureP2pApplication(client, { environment = 'production' } = {}) {
  const env = String(environment || 'production').toLowerCase() === 'production'
    ? 'production'
    : String(environment || 'production').toLowerCase();

  const sourcePayload = {
    description: 'Procurement to Pay · direct Cloud SQL MySQL (read-only)',
    data_source: 'p2p_mysql_readonly',
    integration: 'mysql_readonly',
    process_ids: [P2P_PROCESS_ID],
    dataform_ids: [],
    board_ids: [],
    dataset_ids: [],
    registered_at: new Date().toISOString(),
  };

  await client.query(
    `INSERT INTO engagement_reporting.application
       (environment, application_id, application_name, first_seen_at, last_seen_at, is_current, source_payload)
     VALUES ($1, $2, $3, now(), now(), true, $4::jsonb)
     ON CONFLICT (environment, application_id) DO UPDATE
       SET application_name = EXCLUDED.application_name,
           last_seen_at = now(),
           is_current = true,
           source_payload = COALESCE(engagement_reporting.application.source_payload, '{}'::jsonb)
             || EXCLUDED.source_payload`,
    [env, P2P_APPLICATION_ID, P2P_APPLICATION_NAME, JSON.stringify(sourcePayload)],
  );

  await client.query(
    `INSERT INTO engagement_reporting.process
       (environment, process_id, application_id, process_name, first_seen_at, last_seen_at, is_current, source_payload)
     VALUES ($1, $2, $3, $4, now(), now(), true, $5::jsonb)
     ON CONFLICT (environment, process_id) DO UPDATE
       SET application_id = EXCLUDED.application_id,
           process_name = EXCLUDED.process_name,
           last_seen_at = now(),
           is_current = true`,
    [
      env,
      P2P_PROCESS_ID,
      P2P_APPLICATION_ID,
      'P2P MySQL (read-only)',
      JSON.stringify({ data_source: 'p2p_mysql_readonly' }),
    ],
  );

  return {
    environment: env,
    application_id: P2P_APPLICATION_ID,
    application_name: P2P_APPLICATION_NAME,
    process_id: P2P_PROCESS_ID,
  };
}

/**
 * Lightweight inventory used when credentials are present.
 * Uses information_schema only (always SELECT) so we never guess write paths.
 */
async function loadP2pDashboard(opts = {}) {
  const environment = opts.environment || 'production';
  if (!isP2pConfigured()) {
    return {
      environment,
      application_id: P2P_APPLICATION_ID,
      application_name: P2P_APPLICATION_NAME,
      data_source: 'p2p_not_configured',
      filter_engine: 'p2p-ro',
      metrics: {
        total: 0,
        open: 0,
        closed: 0,
        rejected: 0,
        pending: 0,
        completed: 0,
        total_users: 0,
        signed_in_today: 0,
        sign_in_rate_overall: 0,
        sign_in_rate_today: 0,
        status_model: 'open_closed',
      },
      by_entity: [],
      by_process: [],
      users: [],
      entities: [],
      processes: [],
      resource_options: [],
      report_layout: {
        kind: 'p2p',
        kpi_labels: { total: 'Total records', open: 'Open', closed: 'Closed', rejected: 'Rejected' },
        note: 'P2P MySQL read-only credentials are not configured yet (P2P_DB_USER / P2P_DB_PASSWORD / instance).',
      },
      filters: {
        entity: 'all',
        period: opts.period || 'all',
        supports_entity_filter: false,
        supports_period_filter: false,
        supports_resource_filter: false,
      },
      warning: 'P2P_NOT_CONFIGURED',
    };
  }

  const tables = await p2pQuery(
    `SELECT table_name AS name, table_rows AS approx_rows
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_type = 'BASE TABLE'
     ORDER BY table_rows DESC
     LIMIT 80`,
  );

  const REJECTED_STATUS_RE = '(reject|cancel|cancell|withdraw|declin|void|discard)';
  const CLOSED_STATUS_RE = '(close|complet|approv|paid|settled|done|fulfil|fulfill|deliver|received|posted|final)';
  const OPEN_STATUS_RE = '(draft|pending|submit|progress|await|open|new|partial|hold|review|in.?process)';

  function scoreDocTable(name, kind) {
    const n = String(name || '').toLowerCase();
    if (kind === 'PR' && n === P2P_PR_TABLE) return 100;
    if (kind === 'PO' && n === P2P_PO_TABLE) return 100;
    if (P2P_AUX_TABLE_RE.test(n)) return 0;
    if (kind === 'PR') {
      if (/^purchase_requests?$/.test(n)) return 30;
      if (/purchase_request/.test(n)) return 24;
      return 0;
    }
    if (kind === 'PO') {
      if (/^purchase_orders?$/.test(n) && !/requis/.test(n)) return 30;
      if (/purchase_order/.test(n) && !/requis/.test(n)) return 24;
      return 0;
    }
    return 0;
  }

  function pickStatusColumn(colNames) {
    const ordered = [
      /^(approval_)?status$/,
      /workflow_status/,
      /document_status/,
      /req_status/,
      /po_status/,
      /pr_status/,
      /status/,
      /state/,
      /stage/,
      /approval/,
    ];
    for (const re of ordered) {
      const hit = colNames.find((c) => re.test(c));
      if (hit) return hit;
    }
    return null;
  }

  function pickAmountColumn(colNames, tableName) {
    const t = String(tableName || '').toLowerCase();
    if (t === P2P_PR_TABLE && colNames.includes('total_amount')) return 'total_amount';
    if (t === P2P_PO_TABLE && colNames.includes('grand_total')) return 'grand_total';
    const ordered = [
      /^grand_total$/,
      /^(grand_)?total_amount$/,
      /^subtotal$/,
      /^net_amount$/,
      /^amount$/,
      /po_value/,
      /pr_value/,
      /total_value/,
      /order_value/,
      /(amount|value|cost|price)/,
    ];
    for (const re of ordered) {
      const hit = colNames.find((c) => re.test(c) && !/tax|unit|qty|quantity|count|percent|ratio|gst/.test(c));
      if (hit) return hit;
    }
    return null;
  }

  async function loadTableColumns(tableName) {
    const known = knownP2pColumns(tableName);
    if (known) return known;
    const cols = await p2pQuery(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY ordinal_position`,
      [tableName],
    );
    const colNames = (cols || []).map((c) => String(c.column_name || '').toLowerCase());
    return {
      statusCol: pickStatusColumn(colNames),
      amountCol: pickAmountColumn(colNames, tableName),
    };
  }

  async function discoverDocTables() {
    const tableSet = new Set((tables || []).map((t) => String(t.name || '').toLowerCase()));
    const envPr = String(process.env.P2P_PR_TABLE || P2P_PR_TABLE).toLowerCase();
    const envPo = String(process.env.P2P_PO_TABLE || P2P_PO_TABLE).toLowerCase();

    async function pickPreferred(kind, preferredName) {
      if (!tableSet.has(preferredName)) return null;
      const cols = knownP2pColumns(preferredName) || await loadTableColumns(preferredName);
      return { kind, name: preferredName, ...cols, score: 100 };
    }

    let prPick = await pickPreferred('PR', envPr);
    let poPick = await pickPreferred('PO', envPo);
    if (prPick && poPick) return { prPick, poPick };

    const ranked = [];
    for (const t of tables || []) {
      const name = String(t.name || '');
      if (!name) continue;
      const { statusCol, amountCol } = await loadTableColumns(name);
      const prScore = scoreDocTable(name, 'PR') + (statusCol ? 6 : 0) + (amountCol ? 2 : 0);
      const poScore = scoreDocTable(name, 'PO') + (statusCol ? 6 : 0) + (amountCol ? 2 : 0);
      if (prScore >= 8) ranked.push({ kind: 'PR', name, statusCol, amountCol, score: prScore });
      if (poScore >= 8) ranked.push({ kind: 'PO', name, statusCol, amountCol, score: poScore });
    }
    ranked.sort((a, b) => b.score - a.score);
    if (!prPick) prPick = ranked.find((r) => r.kind === 'PR') || null;
    if (!poPick) poPick = ranked.find((r) => r.kind === 'PO' && r.name !== prPick?.name) || null;
    return { prPick, poPick };
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
    if (['fy', 'financial_year', 'fiscal', 'this_fy'].includes(p)) return 'fy';
    if (['prev_fy', 'previous_fy', 'last_fy'].includes(p)) return 'prev_fy';
    if (['year', 'calendar_year'].includes(p)) return 'year';
    if (['custom'].includes(p)) return 'custom';
    return 'all';
  }

  const entityFilter = String(opts.entity || 'all').trim() || 'all';
  const period = normalizePeriod(opts.period);
  const dateFrom = opts.dateFrom ? String(opts.dateFrom).slice(0, 10) : '';
  const dateTo = opts.dateTo ? String(opts.dateTo).slice(0, 10) : '';
  const effectivePeriod = period === 'custom' || dateFrom || dateTo
    ? (period === 'all' && (dateFrom || dateTo) ? 'custom' : period)
    : period;

  function periodWhereSql(dateExpr) {
    const day = `DATE(${dateExpr})`;
    const today = 'CURDATE()';
    switch (effectivePeriod) {
      case 'daily':
        return `${dateExpr} IS NOT NULL AND ${day} = ${today}`;
      case 'weekly':
        return `${dateExpr} IS NOT NULL AND ${day} >= (${today} - INTERVAL 6 DAY)`;
      case 'last_30':
        return `${dateExpr} IS NOT NULL AND ${day} >= (${today} - INTERVAL 29 DAY) AND ${day} <= ${today}`;
      case 'monthly':
        return `${dateExpr} IS NOT NULL AND YEAR(${dateExpr}) = YEAR(${today}) AND MONTH(${dateExpr}) = MONTH(${today})`;
      case 'quarterly':
        return `${dateExpr} IS NOT NULL AND YEAR(${dateExpr}) = YEAR(${today}) AND QUARTER(${dateExpr}) = QUARTER(${today})`;
      case 'ytd':
        return `${dateExpr} IS NOT NULL AND ${day} >= MAKEDATE(YEAR(${today}), 1) AND ${day} <= ${today}`;
      case 'last_year':
        return `${dateExpr} IS NOT NULL AND YEAR(${dateExpr}) = YEAR(${today}) - 1`;
      case 'fy': {
        // Indian FY Apr → today
        return `${dateExpr} IS NOT NULL AND ${day} >= (
          CASE WHEN MONTH(${today}) >= 4
            THEN MAKEDATE(YEAR(${today}), 1) + INTERVAL 3 MONTH
            ELSE MAKEDATE(YEAR(${today}) - 1, 1) + INTERVAL 3 MONTH
          END
        ) AND ${day} <= ${today}`;
      }
      case 'prev_fy':
        return `${dateExpr} IS NOT NULL AND ${day} >= (
          CASE WHEN MONTH(${today}) >= 4
            THEN MAKEDATE(YEAR(${today}) - 1, 1) + INTERVAL 3 MONTH
            ELSE MAKEDATE(YEAR(${today}) - 2, 1) + INTERVAL 3 MONTH
          END
        ) AND ${day} <= (
          CASE WHEN MONTH(${today}) >= 4
            THEN MAKEDATE(YEAR(${today}), 1) + INTERVAL 2 MONTH + INTERVAL 30 DAY
            ELSE MAKEDATE(YEAR(${today}) - 1, 1) + INTERVAL 2 MONTH + INTERVAL 30 DAY
          END
        )`;
      case 'year':
      case 'custom': {
        if (dateFrom && dateTo) {
          return `${dateExpr} IS NOT NULL AND ${day} BETWEEN '${dateFrom.replace(/'/g, '')}' AND '${dateTo.replace(/'/g, '')}'`;
        }
        if (dateFrom) return `${dateExpr} IS NOT NULL AND ${day} >= '${dateFrom.replace(/'/g, '')}'`;
        if (dateTo) return `${dateExpr} IS NOT NULL AND ${day} <= '${dateTo.replace(/'/g, '')}'`;
        return 'TRUE';
      }
      default:
        return 'TRUE';
    }
  }

  function entityWhereSql(alias = 'd') {
    if (!entityFilter || entityFilter === 'all') return 'TRUE';
    const id = Number(entityFilter);
    if (Number.isFinite(id) && id > 0) return `${alias}.entity_id = ${id}`;
    const esc = entityFilter.replace(/'/g, "''").toLowerCase();
    return `LOWER(COALESCE(em.name, em.entity_name, '')) LIKE '%${esc}%'`;
  }

  async function loadDocMetrics(tableName, statusCol, amountCol, { dateColPrefer = [] } = {}) {
    if (!tableName) return null;
    const known = knownP2pColumns(tableName);
    let status = statusCol || known?.statusCol;
    let amount = amountCol || known?.amountCol;
    if (!status || !amount) {
      const cols = await loadTableColumns(tableName);
      status = status || cols.statusCol;
      amount = amount || cols.amountCol;
    }

    const cols = await p2pQuery(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName],
    );
    const colSet = new Set((cols || []).map((c) => String(c.column_name || '').toLowerCase()));
    const dateCol = [...dateColPrefer, 'submitted_at', 'created_at', 'po_date', 'updated_at']
      .find((c) => colSet.has(c)) || null;
    const hasEntityId = colSet.has('entity_id');

    const whereParts = [];
    if (dateCol && effectivePeriod !== 'all') whereParts.push(periodWhereSql(`d.\`${dateCol}\``));
    if (hasEntityId && entityFilter !== 'all') whereParts.push(entityWhereSql('d'));
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const joinEntity = hasEntityId && entityFilter !== 'all' && !Number(entityFilter)
      ? 'LEFT JOIN `entity_masters` em ON em.id = d.entity_id'
      : '';

    if (!status) {
      const countRow = await p2pQuery(
        `SELECT COUNT(*) AS total FROM \`${tableName}\` d ${joinEntity} ${whereSql}`,
      );
      return {
        table: tableName,
        total: Number(countRow?.[0]?.total || 0),
        open: 0,
        closed: 0,
        rejected: 0,
        amount_total: 0,
        amount_open: 0,
        status_unknown: true,
      };
    }

    const p2pStatusSql = buildP2pStatusSql(tableName, status, amount, 'd');
    let rows;
    if (p2pStatusSql) {
      const amountTotalExpr = p2pStatusSql.amountTotalExpr === '0'
        ? '0'
        : `COALESCE(SUM(${p2pStatusSql.amountTotalExpr}), 0)`;
      rows = await p2pQuery(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(${p2pStatusSql.rejectedExpr}), 0) AS rejected,
           COALESCE(SUM(${p2pStatusSql.closedExpr}), 0) AS closed,
           COALESCE(SUM(${p2pStatusSql.openExpr}), 0) AS open,
           ${amountTotalExpr} AS amount_total,
           COALESCE(SUM(${p2pStatusSql.amountOpenExpr}), 0) AS amount_open
         FROM \`${tableName}\` d
         ${joinEntity}
         ${whereSql}`,
      );
    } else {
      const amountExpr = amount
        ? `COALESCE(SUM(CASE WHEN LOWER(CAST(d.\`${status}\` AS CHAR)) NOT REGEXP '${CLOSED_STATUS_RE}|${REJECTED_STATUS_RE}' THEN d.\`${amount}\` ELSE 0 END), 0)`
        : '0';
      const amountTotalExpr = amount ? `COALESCE(SUM(d.\`${amount}\`), 0)` : '0';
      rows = await p2pQuery(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN LOWER(CAST(d.\`${status}\` AS CHAR)) REGEXP '${REJECTED_STATUS_RE}' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN LOWER(CAST(d.\`${status}\` AS CHAR)) REGEXP '${CLOSED_STATUS_RE}'
             AND LOWER(CAST(d.\`${status}\` AS CHAR)) NOT REGEXP '${REJECTED_STATUS_RE}' THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN LOWER(CAST(d.\`${status}\` AS CHAR)) REGEXP '${OPEN_STATUS_RE}'
             OR (
               LOWER(CAST(d.\`${status}\` AS CHAR)) NOT REGEXP '${REJECTED_STATUS_RE}|${CLOSED_STATUS_RE}'
               AND NULLIF(TRIM(CAST(d.\`${status}\` AS CHAR)), '') IS NOT NULL
             ) THEN 1 ELSE 0 END) AS open,
           ${amountTotalExpr} AS amount_total,
           ${amountExpr} AS amount_open
         FROM \`${tableName}\` d
         ${joinEntity}
         ${whereSql}`,
      );
    }
    const r = rows?.[0] || {};
    return {
      table: tableName,
      total: Number(r.total || 0),
      open: Number(r.open || 0),
      closed: Number(r.closed || 0),
      rejected: Number(r.rejected || 0),
      amount_total: Number(r.amount_total || 0),
      amount_open: Number(r.amount_open || 0),
      status_col: status,
      amount_col: amount || null,
    };
  }

  const { prPick, poPick } = await discoverDocTables();
  const prMetrics = await loadDocMetrics(prPick?.name, prPick?.statusCol, prPick?.amountCol, {
    dateColPrefer: ['submitted_at', 'created_at'],
  });
  const poMetrics = await loadDocMetrics(poPick?.name, poPick?.statusCol, poPick?.amountCol, {
    dateColPrefer: ['created_at', 'po_date', 'submitted_at'],
  });

  // Entity picker from entity_masters (+ PR/PO counts).
  let entities = [{ id: 'all', label: 'All entities', count: 0 }];
  let by_entity = [];
  try {
    const emCols = await p2pQuery(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'entity_masters'`,
    );
    const emSet = new Set((emCols || []).map((c) => String(c.column_name || '').toLowerCase()));
    const emNameCol = ['name', 'entity_name', 'entity', 'label', 'company_name'].find((c) => emSet.has(c));
    if (emSet.has('id') && emNameCol) {
      const entityRows = await p2pQuery(
        `SELECT
           em.id AS entity_id,
           COALESCE(NULLIF(TRIM(em.\`${emNameCol}\`), ''), CONCAT('Entity ', em.id)) AS entity_label,
           (
             (SELECT COUNT(*) FROM \`${P2P_PR_TABLE}\` pr WHERE pr.entity_id = em.id)
             + (SELECT COUNT(*) FROM \`${P2P_PO_TABLE}\` po WHERE po.entity_id = em.id)
           ) AS total
         FROM \`entity_masters\` em
         ORDER BY total DESC, entity_label ASC
         LIMIT 40`,
      );
      entities = [
        { id: 'all', label: 'All entities', count: 0 },
        ...(entityRows || []).map((r) => ({
          id: String(r.entity_id),
          label: String(r.entity_label || r.entity_id),
          count: Number(r.total || 0),
        })),
      ];
      by_entity = (entityRows || [])
        .filter((r) => Number(r.total || 0) > 0)
        .slice(0, 20)
        .map((r) => ({
          entity_id: String(r.entity_id),
          entity_label: String(r.entity_label || r.entity_id),
          total: Number(r.total || 0),
          open: 0,
          closed: 0,
          rejected: 0,
        }));
    }
  } catch {
    entities = [{ id: 'all', label: 'All entities', count: 0 }];
  }

  // Users MIS — P2P app users with optional last_login.
  let users = [];
  let totalUsers = 0;
  let signedInToday = 0;
  try {
    const userCols = await p2pQuery(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'users'`,
    );
    const uc = new Set((userCols || []).map((c) => String(c.column_name || '').toLowerCase()));
    const nameCol = ['name', 'full_name', 'display_name', 'username', 'email'].find((c) => uc.has(c)) || 'id';
    const loginCol = ['last_login', 'last_sign_in', 'last_login_at', 'updated_at'].find((c) => uc.has(c)) || null;
    const idCol = uc.has('id') ? 'id' : nameCol;
    const loginSelect = loginCol ? `u.\`${loginCol}\`` : 'NULL';
    const rows = await p2pQuery(
      `SELECT * FROM (
         SELECT
           u.\`${idCol}\` AS user_id,
           COALESCE(NULLIF(TRIM(u.\`${nameCol}\`), ''), CONCAT('User ', u.\`${idCol}\`)) AS user_name,
           ${loginSelect} AS last_sign_in,
           (
             (SELECT COUNT(*) FROM \`${P2P_PR_TABLE}\` pr
               WHERE pr.requester_id = u.\`${idCol}\`
                 AND UPPER(pr.status) NOT IN ('APPROVED', 'REJECTED'))
             + (SELECT COUNT(*) FROM \`${P2P_PO_TABLE}\` po
               WHERE po.created_by = u.\`${idCol}\`
                 AND LOWER(po.status) IN (${sqlInList(P2P_PO_OPEN_STATUSES)}))
           ) AS open_count,
           (
             (SELECT COUNT(*) FROM \`${P2P_PR_TABLE}\` pr
               WHERE pr.requester_id = u.\`${idCol}\` AND UPPER(pr.status) = 'APPROVED')
             + (SELECT COUNT(*) FROM \`${P2P_PO_TABLE}\` po
               WHERE po.created_by = u.\`${idCol}\`
                 AND LOWER(po.status) IN (${sqlInList(P2P_PO_CLOSED_STATUSES)}))
           ) AS closed_count,
           (
             (SELECT COUNT(*) FROM \`${P2P_PR_TABLE}\` pr
               WHERE pr.requester_id = u.\`${idCol}\` AND UPPER(pr.status) = 'REJECTED')
             + (SELECT COUNT(*) FROM \`${P2P_PO_TABLE}\` po
               WHERE po.created_by = u.\`${idCol}\`
                 AND LOWER(po.status) IN (${sqlInList(P2P_PO_REJECTED_STATUSES)}))
           ) AS rejected_count
         FROM \`users\` u
       ) scored
       WHERE (open_count + closed_count + rejected_count) > 0
       ORDER BY (open_count + closed_count + rejected_count) DESC, user_name ASC
       LIMIT 80`,
    );
    users = (rows || []).map((u) => {
      const open = Number(u.open_count || 0);
      const closed = Number(u.closed_count || 0);
      const rejected = Number(u.rejected_count || 0);
      return {
        user_id: String(u.user_id),
        user_name: String(u.user_name || u.user_id),
        last_sign_in: u.last_sign_in || null,
        open,
        pending: open,
        closed,
        completed: closed,
        rejected,
        total: open + closed + rejected,
      };
    });
    const userCountRow = await p2pQuery('SELECT COUNT(*) AS total FROM `users`');
    totalUsers = Number(userCountRow?.[0]?.total || users.length);
    if (loginCol) {
      const todayRow = await p2pQuery(
        `SELECT COUNT(*) AS total FROM \`users\`
         WHERE \`${loginCol}\` IS NOT NULL AND DATE(\`${loginCol}\`) = CURDATE()`,
      );
      signedInToday = Number(todayRow?.[0]?.total || 0);
    }
  } catch {
    users = [];
  }

  const docRows = [
    prMetrics ? { kind: 'PR', label: 'Purchase Requisition', ...prMetrics } : null,
    poMetrics ? { kind: 'PO', label: 'Purchase Order', ...poMetrics } : null,
  ].filter(Boolean);

  const by_process = docRows.length
    ? docRows.map((d) => ({
        process_id: d.table,
        process_label: d.label,
        process_name: d.label,
        total: d.total,
        open_count: d.open,
        pending: d.open,
        closed: d.closed,
        completed: d.closed,
        rejected: d.rejected,
        amount_total: d.amount_total,
        amount_open: d.amount_open,
      }))
    : (tables || []).slice(0, 12).map((t) => ({
        process_id: t.name,
        process_label: String(t.name || '').replace(/_/g, ' '),
        process_name: String(t.name || '').replace(/_/g, ' '),
        total: Number(t.approx_rows || 0),
        open_count: 0,
        pending: 0,
        closed: 0,
        completed: 0,
        rejected: 0,
        status_unknown: true,
      }));

  const open = by_process.reduce((s, p) => s + Number(p.open_count || 0), 0);
  const closed = by_process.reduce((s, p) => s + Number(p.closed || 0), 0);
  const rejected = by_process.reduce((s, p) => s + Number(p.rejected || 0), 0);
  const total = by_process.reduce((s, p) => s + Number(p.total || 0), 0);
  const amountTotal = by_process.reduce((s, p) => s + Number(p.amount_total || 0), 0);
  const amountOpen = by_process.reduce((s, p) => s + Number(p.amount_open || 0), 0);
  entities[0].count = total;

  if (!by_entity.length) {
    by_entity = [{
      entity_id: 'p2p',
      entity_label: 'Procurement to Pay',
      open,
      closed,
      rejected,
      total,
      closure_ratio: open + closed > 0 ? closed / (open + closed) : 0,
    }];
  } else {
    // Fill status for selected entity view from aggregate when single-entity filter.
    by_entity = by_entity.map((e) => ({
      ...e,
      open: entityFilter === e.entity_id ? open : e.open,
      closed: entityFilter === e.entity_id ? closed : e.closed,
      rejected: entityFilter === e.entity_id ? rejected : e.rejected,
      total: entityFilter === e.entity_id ? total : e.total,
      closure_ratio: (entityFilter === e.entity_id ? open + closed : e.open + e.closed) > 0
        ? (entityFilter === e.entity_id ? closed : e.closed)
          / (entityFilter === e.entity_id ? open + closed : e.open + e.closed || 1)
        : 0,
    }));
  }

  const signInRateToday = totalUsers ? Math.round((signedInToday / totalUsers) * 100) : 0;

  return {
    environment,
    application_id: P2P_APPLICATION_ID,
    application_name: P2P_APPLICATION_NAME,
    data_source: 'p2p_mysql_readonly',
    filter_engine: 'p2p-ro',
    snapshot_at: new Date().toISOString(),
    metrics: {
      total,
      open,
      closed,
      rejected,
      pending: open,
      completed: closed,
      total_users: totalUsers,
      signed_in_today: signedInToday,
      sign_in_rate_overall: totalUsers ? Math.round((users.filter((u) => u.last_sign_in).length / Math.max(totalUsers, 1)) * 100) : 0,
      sign_in_rate_today: signInRateToday,
      amount_total: amountTotal,
      amount_open: amountOpen,
      status_model: 'open_closed',
    },
    by_entity,
    by_process,
    users,
    entities,
    processes: by_process.map((p) => ({
      process_id: p.process_id,
      process_name: p.process_name,
      resource_type: 'process',
    })),
    resource_options: by_process.map((p) => ({
      resource_type: 'process',
      resource_id: p.process_id,
      resource_name: p.process_name,
    })),
    report_layout: {
      kind: 'p2p',
      kpi_labels: {
        total: 'Total PR + PO',
        open: 'Open',
        closed: 'Closed',
        rejected: 'Rejected',
      },
      note: docRows.length
        ? `Direct MySQL RO · PR/PO mapped${amountTotal ? ` · ₹${Math.round(amountTotal).toLocaleString('en-IN')} total value` : ''}${docRows.some((d) => d.status_unknown) ? ' · status column not found on one or more tables' : ''}`
        : 'Direct read-only MySQL — PR/PO tables not auto-detected; row counts only (open/closed unavailable).',
    },
    filters: {
      entity: entityFilter,
      period: effectivePeriod,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      supports_entity_filter: true,
      supports_period_filter: true,
      supports_resource_filter: false,
    },
    amounts: {
      total: amountTotal,
      open: amountOpen,
    },
  };
}

module.exports = {
  P2P_APPLICATION_ID,
  P2P_APPLICATION_NAME,
  P2P_PROCESS_ID,
  isP2pApplication,
  ensureP2pApplication,
  loadP2pDashboard,
};
