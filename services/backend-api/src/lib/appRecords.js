'use strict';

/**
 * CEO / CTO work-item records list for application detail "Records" tab.
 * Kissflow apps → live engagement_cache.records when fresh, else latest snapshot.
 * P2P → purchase_requests + purchase_orders via MySQL RO.
 *
 * Status buckets match appDashboard / ITSM Admin All (not raw step names as Open).
 */

const { isP2pApplication, loadP2pDashboard } = require('./p2pDashboard');
const { resolveCompanyIdFromText, REFEX_DEFAULT_COMPANY_NAME } = require('./refexCompanies');
const { isP2pConfigured, p2pQuery } = require('./p2pReadonly');
const { latestRunsCte } = require('./snapshotRuns');
const {
  loadApplicationEngagementCache,
  isEngagementCacheFresh,
  shouldPreferEngagementCache,
} = require('./engagementCache');
const { latestApplicationSnapshotAt } = require('./snapshotRuns');
const {
  normalizeProcessStatus,
  pickCurrentStep,
  pickString,
  pickDateTime,
  isItsmBusinessClosed,
  isItsmBusinessOpen,
} = require('./kissflowClient');
const { normalizeItsmPersonLabel } = require('./dashboardDisplay');
const { projectKeyFromRaw, buildPmPortfolioFromRecords, projectKeySql } = require('./pmPortfolio');

const ITSM_APP_ID = 'IT_Service_Management_A00';
const TRAVEL_APP_ID = 'Expense_and_Travel_Management_A00';
const SOLAR_APP_ID = 'Solar_Site_Expense_Governance_Syst_A00';

function sqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function isItsmApp(applicationId) {
  const id = String(applicationId || '').toLowerCase();
  return id === ITSM_APP_ID.toLowerCase() || id.includes('itsm') || id.includes('service_management');
}

function isTravelApp(applicationId) {
  const id = String(applicationId || '');
  return id === TRAVEL_APP_ID || id.toLowerCase().includes('travel');
}

function isSolarApp(applicationId) {
  const hay = String(applicationId || '').toLowerCase();
  return hay.includes('solar') || hay.includes('reinvestment') || hay.includes('site_expense');
}

function isPmApp(applicationId) {
  const hay = String(applicationId || '').toLowerCase();
  return hay.includes('project_management') || hay.includes('project_tracker');
}

function isLeadApp(applicationId) {
  return String(applicationId || '').toLowerCase().includes('lead');
}

function isEmsApp(applicationId) {
  const hay = String(applicationId || '').toLowerCase();
  return hay.includes('ems');
}

function travelProcessTitle(processId) {
  const pid = String(processId || '').toLowerCase();
  if (pid.includes('travel_management')) return 'Travel request';
  if (pid.includes('advance')) return 'Travel advance';
  if (pid.includes('expense')) return 'Travel expense';
  return processId.replace(/_/g, ' ');
}

/** Person Name from jsonb user object — never dump raw JSON text. */
function pickPersonNameSql(expr) {
  return `CASE
    WHEN jsonb_typeof(${expr}) = 'string' THEN NULLIF(trim((${expr}) #>> '{}'), '')
    WHEN jsonb_typeof(${expr}) = 'array' THEN COALESCE(
      NULLIF(trim((${expr})->0->>'Name'), ''),
      NULLIF(trim((${expr})->0->>'name'), ''),
      NULLIF(trim((${expr})->0->>'DisplayName'), ''),
      NULLIF(trim((${expr})->0->>'Email'), '')
    )
    WHEN jsonb_typeof(${expr}) = 'object' THEN COALESCE(
      NULLIF(trim((${expr})->>'Name'), ''),
      NULLIF(trim((${expr})->>'name'), ''),
      NULLIF(trim((${expr})->>'DisplayName'), ''),
      NULLIF(trim((${expr})->>'Email'), '')
    )
    ELSE NULL
  END`;
}

function statusBucketSql(itsm) {
  return `CASE
      WHEN i.process_status IN ('Withdrawn')
        OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
        OR lower(coalesce(
          i.source_payload->>'_status',
          i.source_payload->>'Status',
          i.source_payload->'Status'->>'Name',
          ''
        )) ~ '(reject|cancel|withdraw)'
        THEN 'rejected'
      WHEN i.process_status IN ('Completed', 'Closed')
        OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled')
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
}

function entityKeySql(applicationId) {
  if (isItsmApp(applicationId)) {
    return `CASE
      WHEN i.process_id ILIKE '%extrovis%' THEN 'extrovis'
      WHEN lower(trim(coalesce(
        nullif(trim(i.source_payload->>'Entity'), ''),
        nullif(trim(i.source_payload->'Entity'->>'Name'), ''),
        ''
      ))) LIKE '%extrovis%' THEN 'extrovis'
      ELSE 'refex'
    END`;
  }
  if (isTravelApp(applicationId)) {
    return `CASE
      WHEN lower(trim(coalesce(
        nullif(trim(i.source_payload->>'Entity'), ''),
        nullif(trim(i.source_payload->'Entity'->>'Name'), ''),
        ''
      ))) LIKE '%venwind%' THEN 'venwind'
      ELSE 'refex'
    END`;
  }
  return `lower(trim(coalesce(
    nullif(trim(i.source_payload->>'Entity'), ''),
    nullif(trim(i.source_payload->'Entity'->>'Name'), ''),
    nullif(trim(i.source_payload->>'Company'), ''),
    'refex'
  )))`;
}

function entityLabel(key) {
  const k = String(key || '').toLowerCase();
  if (k === 'extrovis') return 'Extrovis';
  if (k === 'venwind') return 'Venwind';
  if (k === 'operation' || k === 'operations') return 'Operation';
  if (k === 'finance') return 'Finance';
  if (k === 'refex' || k === '') return 'Refex';
  return String(key || '—').replace(/_/g, ' ');
}

function entityBucketOptions(counts = {}, mode = 'refex_extrovis') {
  const buckets =
    mode === 'refex_venwind'
      ? [
          { id: 'refex', label: 'Refex' },
          { id: 'venwind', label: 'Venwind' },
        ]
      : mode === 'all_buckets'
        ? [
            { id: 'refex', label: 'Refex' },
            { id: 'extrovis', label: 'Extrovis' },
            { id: 'venwind', label: 'Venwind' },
          ]
        : [
            { id: 'refex', label: 'Refex' },
            { id: 'extrovis', label: 'Extrovis' },
          ];
  return [
    { id: 'all', label: 'All entities', count: 0 },
    ...buckets.map((b) => ({
      id: b.id,
      label: b.label,
      count: Number(counts[b.id] || 0),
    })),
  ];
}

function entityOptionsForApp(applicationId, counts = {}) {
  if (isItsmApp(applicationId)) {
    return entityBucketOptions(counts, 'refex_extrovis');
  }
  if (isTravelApp(applicationId)) {
    return entityBucketOptions(counts, 'refex_venwind');
  }
  // Project Tracker / Lead / EMS / others: Entity buckets + company list available on FE.
  return entityBucketOptions(counts, 'all_buckets');
}

function usableAssignedName(value) {
  const n = String(value || '').trim();
  if (!n || n === '—' || n === '-' || /^(unknown|n\/a|none)$/i.test(n)) return '';
  return n;
}

/** Kissflow workflow Assigned To columns (Refex + Extrovis). Never Assigned To User / Owner. */
const ITSM_WORKFLOW_ASSIGNED_KEYS = [
  '_current_assigned_to',
  'Column_Q7Ygw5jzjd',
  'Column_Vz3Y600Rds',
  'Column_OyGDeJd2lb',
  'Column_7Fn1867jLF',
  'Column_OomWJzBZKn',
  'Assigned_To',
  'Assignee',
  'assigned_to',
  'AssignedTo',
];

function serializeRecordItem(it, opts = {}) {
  const itsm = Boolean(opts.itsm);
  const assigned = usableAssignedName(it.assigned_to);
  return {
    id: String(it.id || it.instance_id || it.request_id),
    request_id: it.request_id,
    subject: it.subject,
    expense_type: it.expense_type,
    assignee_id: it.assignee_id,
    assignee_email: it.assignee_email,
    assigned_to: itsm
      ? (assigned || '—')
      : (assigned || usableAssignedName(it.closed_by) || usableAssignedName(it.requested_by) || '—'),
    closed_by: it.closed_by,
    requested_by: it.requested_by,
    status: it.status,
    status_raw: it.status_raw,
    entity: it.entity,
    entity_key: it.entity_key,
    company: it.company,
    company_key: it.company_key,
    company_name: it.company_name || it.assignee_company || it.company,
    assignee_company: it.assignee_company || it.company_name,
    assignee_company_key: it.assignee_company_key,
    current_step: it.current_step,
    process_id: it.process_id,
    project_id: it.project_id || it.project_key || undefined,
    project_key: it.project_key || it.project_id || undefined,
    created_at: it.created_at,
    closed_at: it.closed_at || it.completed_at || null,
    amount: it.amount,
  };
}

function recordHasProcessCompany(rec) {
  if (rec.company_name || rec.assignee_company) return true;
  const companyText = String(rec.company || rec.entity || '').trim();
  if (companyText && companyText !== '—') {
    if (resolveCompanyIdFromText(companyText)) return true;
    if (companyText.length > 3 && !/^(refex|extrovis|venwind)$/i.test(companyText)) return true;
  }
  if (rec.company_key && resolveCompanyIdFromText(rec.company_key)) return true;
  return false;
}

/**
 * Stamp assignee legal company from users (id/email/name). In-memory only — no extra I/O.
 * Keeps assignee_company_key as Entity bucket (refex/extrovis/venwind).
 * Skips user lookup when the process record already carries company / entity.
 * ITSM: never overlay assignee company — requester lookup is the source of truth.
 */
function enrichRecordsWithAssigneeCompany(records, users, { skipAssigneeStamp = false } = {}) {
  if (skipAssigneeStamp) return records || [];
  const byKey = new Map();
  for (const u of users || []) {
    const sp = u && typeof u.source_payload === 'object' ? u.source_payload : {};
    const company = String(u.company || sp.company || '').trim();
    if (!company) continue;
    const bucketRaw = String(u.company_key || sp.company_key || '').toLowerCase();
    let bucket = 'refex';
    if (bucketRaw.includes('extrovis') || company.toLowerCase().includes('extrovis')) bucket = 'extrovis';
    else if (bucketRaw.includes('venwind') || company.toLowerCase().includes('venwind')) bucket = 'venwind';
    else if (bucketRaw === 'refex' || company.toLowerCase().includes('refex')) bucket = 'refex';
    const catalogKey = resolveCompanyIdFromText(company) || null;
    const profile = { company, bucket, catalogKey };
    const nameCompact = String(u.user_name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    for (const key of [u.user_id, u.email, u.user_name, sp.email, nameCompact]) {
      const k = String(key || '').trim().toLowerCase();
      if (k) byKey.set(k, profile);
    }
  }
  if (!byKey.size) return records || [];

  return (records || []).map((rec) => {
    if (recordHasProcessCompany(rec)) {
      return {
        ...rec,
        company_name: rec.company_name || rec.assignee_company || rec.company,
        assignee_company: rec.assignee_company || rec.company_name || rec.company,
      };
    }
    const keys = [
      rec.assignee_id,
      rec.assignee_email,
      rec.assigned_to,
      String(rec.assigned_to || '').toLowerCase().replace(/[^a-z0-9]+/g, ''),
    ].filter(Boolean).map((k) => String(k).toLowerCase().trim());
    let hit = null;
    for (const key of keys) {
      hit = byKey.get(key);
      if (hit) break;
    }
    if (!hit) return rec;
    return {
      ...rec,
      assignee_company: hit.company,
      company_name: hit.company,
      company: hit.company,
      company_key: hit.catalogKey || rec.company_key,
      assignee_company_key: rec.assignee_company_key || hit.bucket,
    };
  });
}

function columnsForApp(applicationId) {
  if (isP2pApplication(applicationId)) {
    return [
      { id: 'request_id', label: 'Doc ID' },
      { id: 'subject', label: 'Type' },
      { id: 'requested_by', label: 'Requester' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'amount', label: 'Amount' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isItsmApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Ticket ID' },
      { id: 'subject', label: 'Subject' },
      { id: 'requested_by', label: 'Requested by' },
      { id: 'assigned_to', label: 'Assigned to' },
      { id: 'closed_by', label: 'Closed by' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'current_step', label: 'Step' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isPmApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Project / Task ID' },
      { id: 'subject', label: 'Project / Task name' },
      { id: 'assigned_to', label: 'Owner' },
      { id: 'requested_by', label: 'Requester' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isLeadApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Lead ID' },
      { id: 'subject', label: 'Lead name' },
      { id: 'requested_by', label: 'Owner' },
      { id: 'assigned_to', label: 'Assigned to' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isEmsApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Exp ID' },
      { id: 'subject', label: 'Title' },
      { id: 'expense_type', label: 'Category' },
      { id: 'requested_by', label: 'Requester' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isSolarApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Req ID' },
      { id: 'expense_type', label: 'Expense type' },
      { id: 'subject', label: 'Site name' },
      { id: 'requested_by', label: 'Requester' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isTravelApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Request ID' },
      { id: 'subject', label: 'Title' },
      { id: 'requested_by', label: 'Requester' },
      { id: 'assigned_to', label: 'Assigned to' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'process_id', label: 'Process' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  return [
    { id: 'request_id', label: 'Request ID' },
    { id: 'subject', label: 'Subject' },
    { id: 'assigned_to', label: 'Assigned to' },
    { id: 'requested_by', label: 'Requested by' },
    { id: 'status', label: 'Status' },
    { id: 'entity', label: 'Entity' },
    { id: 'company_name', label: 'Company name' },
    { id: 'created_at', label: 'Created' },
  ];
}

function isDraftRaw(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const parts = [
    raw._status,
    raw.Status,
    raw.process_status,
    raw.Process_Status,
    raw._current_step,
    raw.current_step,
    raw.Step,
    normalizeProcessStatus(raw),
  ];
  return parts.some((p) => String(p || '').toLowerCase().includes('draft'));
}

function isDraftStatusText(...parts) {
  return parts.some((p) => String(p || '').toLowerCase().includes('draft'));
}

function isDraftRow(row) {
  return isDraftStatusText(row?.status_raw, row?.current_step, row?.status, row?.process_id);
}

function isEmptyDisplay(value) {
  const s = String(value ?? '').trim();
  return !s || s === '—' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined';
}

function isMeaningfulRecord(row) {
  if (isDraftRow(row)) return false;
  const id = String(row?.request_id || row?.id || row?.instance_id || '').trim();
  if (isEmptyDisplay(id)) return false;
  return true;
}

function dedupeRecords(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    if (!isMeaningfulRecord(row)) continue;
    const key = String(row.instance_id || row.id || row.request_id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function closedByFromRaw(raw) {
  const fields = [
    raw?.Closed_By,
    raw?.ClosedBy,
    raw?.Resolved_By,
    raw?.Completed_By,
    raw?.Closed_by,
    raw?.ResolvedBy,
    raw?._completed_by,
    raw?.Modified_By,
    raw?._modified_by,
    raw?.Last_Action_By,
    raw?._last_action_performed_by,
    raw?.Completer,
  ];
  for (const field of fields) {
    const name = normalizeItsmPersonLabel(personNameFromRaw(field));
    if (name) return name;
  }
  if (isItsmBusinessClosed(raw)) {
    const fromModified = normalizeItsmPersonLabel(personNameFromRaw(raw?._modified_by || raw?.Modified_By));
    if (fromModified) return fromModified;
    const fromStep = normalizeItsmPersonLabel(
      personNameFromRaw(raw?._current_assigned_to || raw?.Assigned_To || raw?.Assignee),
    );
    if (fromStep && !/^(it manager|it head)$/i.test(fromStep.replace(/\s+/g, ' ').trim())) {
      return fromStep;
    }
  }
  return '';
}

function isDraftSql(alias = 'i') {
  return `(
    lower(coalesce(${alias}.process_status, '')) LIKE '%draft%'
    OR lower(coalesce(${alias}.current_step, '')) LIKE '%draft%'
    OR lower(coalesce(${alias}.source_payload->>'_status', '')) LIKE '%draft%'
    OR lower(coalesce(${alias}.source_payload->>'Status', '')) LIKE '%draft%'
    OR lower(coalesce(${alias}.source_payload->>'_current_step', '')) LIKE '%draft%'
  )`;
}

function personIdFromRaw(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) {
    for (const el of val) {
      const id = personIdFromRaw(el);
      if (id) return id;
    }
    return '';
  }
  if (val && typeof val === 'object') {
    return pickString(val, ['_id', 'Id', 'id', 'UserId']) || '';
  }
  return '';
}

function kissflowTsSql(expr) {
  return `CASE
    WHEN jsonb_typeof(${expr}) = 'object' THEN NULLIF(trim((${expr})->>'v'), '')::timestamptz
    ELSE NULLIF(trim((${expr}) #>> '{}'), '')::timestamptz
  END`;
}

function assigneeMetaFromRaw(raw, { itsm = false } = {}) {
  const fields = itsm
    ? ITSM_WORKFLOW_ASSIGNED_KEYS.map((key) => raw?.[key])
    : [
      raw?._current_assigned_to,
      raw?.Column_Q7Ygw5jzjd,
      raw?.Assigned_To,
      raw?.Assignee,
      raw?.assigned_to,
      raw?.AssignedTo,
      raw?.Owner,
    ];
  for (const field of fields) {
    if (field == null) continue;
    const assignee_id = personIdFromRaw(field);
    const emailSource = Array.isArray(field) ? field[0] : field;
    const assignee_email = emailSource && typeof emailSource === 'object'
      ? String(pickString(emailSource, ['Email', 'email']) || '').trim().toLowerCase()
      : '';
    const assigned_name = personNameFromRaw(field);
    if (assignee_id || assignee_email || assigned_name) {
      return { assignee_id, assignee_email, assigned_name };
    }
  }
  return { assignee_id: '', assignee_email: '', assigned_name: '' };
}

function personNameFromRaw(val) {
  if (val == null) return '';
  if (typeof val === 'string') return normalizeItsmPersonLabel(val.trim());
  if (Array.isArray(val)) {
    for (const el of val) {
      const n = personNameFromRaw(el);
      if (n) return n;
    }
    return '';
  }
  if (val && typeof val === 'object') {
    return normalizeItsmPersonLabel(
      pickString(val, ['Name', 'name', 'DisplayName', 'Email', 'email']) || '',
    );
  }
  return '';
}

function statusBucketFromRaw(raw, applicationId) {
  if (isDraftRaw(raw)) return 'draft';
  const itsm = isItsmApp(applicationId);
  const statusText = String(
    raw?._status || raw?.Status || raw?.process_status || raw?.Process_Status || '',
  ).toLowerCase();
  if (
    statusText.includes('reject')
    || statusText.includes('cancel')
    || statusText.includes('withdraw')
    || normalizeProcessStatus(raw) === 'Withdrawn'
  ) {
    return 'rejected';
  }
  if (itsm) {
    if (isItsmBusinessClosed(raw)) return 'closed';
    if (isItsmBusinessOpen(raw)) return 'open';
    const st = normalizeProcessStatus(raw);
    if (st === 'Completed' || st === 'Closed') return 'closed';
    return 'open';
  }
  const st = normalizeProcessStatus(raw);
  if (st === 'Completed' || st === 'Closed') return 'closed';
  if (['completed', 'closed', 'done', 'approved', 'paid', 'settled'].includes(statusText)) return 'closed';
  return 'open';
}

function entityTextFromRaw(raw) {
  return (
    personNameFromRaw(raw?.Entity)
    || personNameFromRaw(raw?.entity)
    || personNameFromRaw(raw?.Company)
    || personNameFromRaw(raw?.Employee_entity)
    || personNameFromRaw(raw?.Employee_Entity)
    || ''
  );
}

function isEntityBucketLabel(value) {
  return /^(refex|extrovis|venwind|refex group)$/i.test(String(value || '').trim());
}

/** Company_Name / REFEX_COMPANY_NAME_1 from Kissflow user_details_lookup. */
function pickCompanyNameFromLookup(lookup) {
  if (lookup == null || lookup === '') return '';
  if (Array.isArray(lookup)) {
    for (const entry of lookup) {
      const found = pickCompanyNameFromLookup(entry);
      if (found) return found;
    }
    return '';
  }
  if (typeof lookup === 'string') {
    const t = lookup.trim();
    if (!t || isEntityBucketLabel(t)) return '';
    return t;
  }
  if (typeof lookup === 'object') {
    if (lookup.v != null && lookup.v !== lookup) {
      const fromV = pickCompanyNameFromLookup(lookup.v);
      if (fromV) return fromV;
    }
    const keys = [
      'Company_Name',
      'REFEX_COMPANY_NAME_1',
      'Company Name',
      'companyName',
      'Company',
      'company',
    ];
    for (const key of keys) {
      if (lookup[key] == null || lookup[key] === '') continue;
      if (typeof lookup[key] === 'object') {
        const nested = pickCompanyNameFromLookup(lookup[key]);
        if (nested) return nested;
        continue;
      }
      const t = String(lookup[key]).trim();
      if (t && !isEntityBucketLabel(t)) return t;
    }
    const name = String(lookup.Name || lookup.name || '').trim();
    if (name && !isEntityBucketLabel(name) && resolveCompanyIdFromText(name)) return name;
  }
  return '';
}

function extractItsmCompanyNameFromRaw(raw) {
  if (!raw) return '';
  return pickCompanyNameFromLookup(
    raw.user_details_lookup
    || raw.Column_bRn4sBWeeF
    || raw.User_Details_Lookup
    || raw.userDetailsLookup,
  );
}

function companyTextFromRaw(raw, applicationId) {
  if (isItsmApp(applicationId)) {
    const fromLookup = extractItsmCompanyNameFromRaw(raw);
    if (fromLookup && !isEntityBucketLabel(fromLookup)) return fromLookup;
    return REFEX_DEFAULT_COMPANY_NAME;
  }
  return (
    personNameFromRaw(raw?.Company)
    || personNameFromRaw(raw?.Legal_Entity)
    || personNameFromRaw(raw?.Legal_Entity_Name)
    || personNameFromRaw(raw?.Organisation)
    || personNameFromRaw(raw?.Organization)
    || personNameFromRaw(raw?.Created_by_Company)
    || personNameFromRaw(raw?.Creator_Company)
    || entityTextFromRaw(raw)
    || ''
  );
}

/** Snapshot SQL: requester legal company from user_details_lookup (ITSM). */
function itsmLookupCompanySql() {
  const paths = [
    "i.source_payload->'user_details_lookup'",
    "i.source_payload->'Column_bRn4sBWeeF'",
    "i.source_payload->'User_Details_Lookup'",
  ];
  const attrs = ['Company_Name', 'REFEX_COMPANY_NAME_1', 'Company Name', 'companyName', 'Company', 'company'];
  const parts = [];
  for (const p of paths) {
    for (const a of attrs) {
      const escaped = String(a).replace(/'/g, "''");
      parts.push(`NULLIF(trim(${p}->>'${escaped}'), '')`);
      parts.push(`NULLIF(trim(${p}->'v'->>'${escaped}'), '')`);
      parts.push(`NULLIF(trim(${p}->0->>'${escaped}'), '')`);
    }
  }
  return `COALESCE(${parts.join(',\n      ')})`;
}

function entityKeyFromRaw(raw, applicationId, processId) {
  if (isItsmApp(applicationId)) {
    const pid = String(processId || raw?._process_id || '').toLowerCase();
    const ent = entityTextFromRaw(raw).toLowerCase();
    if (pid.includes('extrovis') || ent.includes('extrovis')) return 'extrovis';
    return 'refex';
  }
  if (isTravelApp(applicationId)) {
    const ent = entityTextFromRaw(raw).toLowerCase();
    return ent.includes('venwind') ? 'venwind' : 'refex';
  }
  const text = companyTextFromRaw(raw, applicationId) || entityTextFromRaw(raw);
  const resolved = resolveCompanyIdFromText(text);
  if (resolved) return resolved;
  // Keep free-text Entity for Project Tracker / Solar company matching.
  return text.toLowerCase() || 'refex';
}

/** Build lean Records rows from live Kissflow list payloads (used by live metrics cache). */
function buildLiveRecordRows(allItems, applicationId) {
  const itsm = isItsmApp(applicationId);
  const pm = isPmApp(applicationId);
  const lead = isLeadApp(applicationId);
  const solar = isSolarApp(applicationId);
  const travel = isTravelApp(applicationId);
  const ems = isEmsApp(applicationId);
  return (allItems || []).filter((raw) => !isDraftRaw(raw)).map((raw) => {
    const processId = String(raw?._process_id || raw?.process_id || '');
    const pidLower = processId.toLowerCase();
    const isTask = pm && (pidLower.includes('sub_task') || pidLower.includes('task_process') || pidLower.includes('_task'));
    const entityKey = entityKeyFromRaw(raw, applicationId, processId);
    const assigneeMeta = assigneeMetaFromRaw(raw, { itsm });
    const leadOwner = lead
      ? (
        personNameFromRaw(raw?.Lead_Owner)
        || personNameFromRaw(raw?.Owner)
        || personNameFromRaw(raw?.Sales_Person)
        || personNameFromRaw(raw?.Lead_Manager)
        || ''
      )
      : '';
    const closedAt = pickDateTime(raw, [
      '_completed_at',
      '_closed_at',
      'Completed_On',
      'Closed_On',
      'Completed_Date',
      'Closed_Date',
    ]) || (statusBucketFromRaw(raw, applicationId) === 'closed'
      ? pickDateTime(raw, ['_modified_at'])
      : null);
    const assigned = itsm
      ? (assigneeMeta.assigned_name || '—')
      : lead
        ? (assigneeMeta.assigned_name || leadOwner || '—')
        : (assigneeMeta.assigned_name || personNameFromRaw(raw?._created_by) || '—');
    const requested = itsm
      ? (personNameFromRaw(raw?.Requester) || personNameFromRaw(raw?.Requester_Name) || '—')
      : lead
        ? (leadOwner || personNameFromRaw(raw?.Requester) || '—')
        : (
          personNameFromRaw(raw?.Requester)
          || personNameFromRaw(raw?.Requested_By)
          || personNameFromRaw(raw?.Employee)
          || personNameFromRaw(raw?._created_by)
          || '—'
        );
    const requestId = pm
      ? (isTask
        ? pickString(raw, ['Task_ID_Formulated', 'Task_ID', 'Sub_Task_ID', 'Task_Id', '_request_number', 'Request_ID', '_id'])
        : pickString(raw, ['Project_ID_Formulated', 'Project_ID', 'Project_Id', '_request_number', 'Request_ID', '_id']))
      : travel
        ? pickString(raw, ['Request_ID', 'Request_Id', 'Request_Number', 'Travel_Request_ID', 'Request_No', '_request_number'])
        : lead
          ? pickString(raw, ['Lead_ID', 'Lead_Id', 'Lead_Number', '_request_number'])
          : ems
            ? pickString(raw, ['Expense_ID', 'Exp_ID', 'Expense_Id', '_request_number', 'Request_ID'])
            : pickString(raw, ['_request_number', 'Request_Number', 'Request_ID', 'Request_Id', 'Ticket_ID', 'Ticket_Number'])
      || '—';
    const created =
      (typeof raw?._created_at === 'string' && raw._created_at)
      || (raw?._created_at?.v)
      || null;
    const expenseType = solar || ems
      ? (pickString(raw, ['Expense_Type', 'Category', 'Service_Category', 'Expense_Category']) || '—')
      : undefined;
    const subject = solar
      ? (pickString(raw, ['Site_Name', 'Site', 'Location', 'Site_Location', 'Subject', 'Title']) || pickCurrentStep(raw) || '—')
      : travel
        ? (pickString(raw, ['Title', 'Travel_Title', 'Request_Title', 'Subject', 'Summary']) || travelProcessTitle(processId))
        : pm
          ? (isTask
            ? pickString(raw, ['Task_Name', 'Task_Title', 'Sub_Task_Name', 'Subject', 'Title'])
            : pickString(raw, ['Project_Name', 'Project_Title', 'Subject', 'Title']))
          : lead
            ? (pickString(raw, ['Lead_Name', 'Name', 'Contact_Name', 'Company_Name', 'Subject']) || '—')
            : ems
              ? (pickString(raw, ['Title', 'Subject', 'Description', 'Expense_Title']) || '—')
              : (pickString(raw, ['Subject', 'Title', 'Summary', 'Description']) || pickCurrentStep(raw) || processId || '—');
    const closedBy = itsm ? (closedByFromRaw(raw) || undefined) : undefined;
    const entityText = entityTextFromRaw(raw);
    const companyText = companyTextFromRaw(raw, applicationId);
    const companyKey = itsm
      ? (resolveCompanyIdFromText(companyText) || null)
      : (
        resolveCompanyIdFromText(companyText)
        || resolveCompanyIdFromText(entityText)
        || resolveCompanyIdFromText(entityKey)
        || null
      );
    const entityDisplay =
      entityText
      || (itsm ? '' : (companyKey ? companyKey.replace(/-/g, ' ') : ''))
      || entityLabel(entityKey);
    const projectKey = pm ? (projectKeyFromRaw(raw) || undefined) : undefined;
    return {
      id: String(raw?._id || requestId),
      instance_id: String(raw?._id || requestId),
      process_id: travel ? travelProcessTitle(processId) : processId,
      request_id: requestId,
      subject: subject || '—',
      expense_type: expenseType,
      assignee_id: assigneeMeta.assignee_id || undefined,
      assignee_email: assigneeMeta.assignee_email || undefined,
      assigned_to: assigned,
      closed_by: closedBy,
      requested_by: requested,
      status: statusBucketFromRaw(raw, applicationId),
      status_raw: String(raw?._status || raw?.Status || normalizeProcessStatus(raw) || ''),
      entity: entityDisplay,
      entity_key: entityKey,
      company: itsm ? companyText : (companyText || entityDisplay),
      company_key: companyKey || undefined,
      company_name: itsm ? companyText : (companyText || entityDisplay || undefined),
      current_step: pickCurrentStep(raw) || String(raw?._status || ''),
      created_at: created,
      closed_at: closedAt,
      project_id: projectKey,
      project_key: projectKey,
    };
  });
}

function toIstYmd(value) {
  if (!value) return '';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return String(value).slice(0, 10);
  }
}

function filterRecordRows(items, {
  status = 'all',
  entity = 'all',
  search = '',
  assigned = '',
  requester = '',
  dateFrom = '',
  dateTo = '',
  itsmCompanyMode = false,
} = {}) {
  const statusFilter = String(status || 'all').toLowerCase();
  const entityFilter = String(entity || 'all').trim().toLowerCase();
  const q = String(search || '').trim().toLowerCase();
  const assignedFilter = String(assigned || '').trim().toLowerCase();
  const requesterFilter = String(requester || '').trim().toLowerCase();
  const from = String(dateFrom || '').slice(0, 10);
  const to = String(dateTo || '').slice(0, 10);

  return (items || []).filter((row) => {
    if (isDraftRow(row)) return false;
    if (statusFilter !== 'all' && String(row.status || '').toLowerCase() !== statusFilter) return false;
    if (entityFilter !== 'all') {
      if (itsmCompanyMode) {
        // Process entity_key is authoritative (Refex vs Extrovis). Do not prefer
        // assignee_company_key / legal company — that misclassifies Extrovis tickets.
        const ek = String(row.entity_key || row.entity || '').toLowerCase();
        const bucket = ek.includes('extrovis')
          ? 'extrovis'
          : ek.includes('venwind')
            ? 'venwind'
            : (ek === 'refex' || ek.includes('refex') || !ek ? 'refex' : ek);
        if (entityFilter === 'refex') {
          if (bucket !== 'refex') return false;
        } else if (entityFilter === 'extrovis' || entityFilter.includes('extrovis')) {
          if (bucket !== 'extrovis') return false;
        } else if (entityFilter === 'venwind' || entityFilter.includes('venwind')) {
          if (bucket !== 'venwind') return false;
        } else if (bucket !== entityFilter && !ek.includes(entityFilter)) {
          return false;
        }
      } else {
        const ek = String(row.entity_key || row.entity || '').toLowerCase();
        if (entityFilter === 'refex') {
          if (!(ek === 'refex' || ek === '' || (ek.includes('refex') && !ek.includes('extrovis') && !ek.includes('venwind')))) {
            return false;
          }
        } else if (!ek.includes(entityFilter)) {
          return false;
        }
      }
    }
    if (assignedFilter && !String(row.assigned_to || '').toLowerCase().includes(assignedFilter)) return false;
    if (requesterFilter && !String(row.requested_by || '').toLowerCase().includes(requesterFilter)) return false;
    if (from || to) {
      const ymd = toIstYmd(row.created_at);
      if (!ymd) return false;
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
    }
    if (q) {
      const hay = [
        row.request_id,
        row.assigned_to,
        row.requested_by,
        row.subject,
        row.current_step,
        row.entity,
        row.status,
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).filter(isMeaningfulRecord);
}

function summarizeRows(rows) {
  let open = 0;
  let closed = 0;
  let rejected = 0;
  for (const r of rows) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'closed') closed += 1;
    else if (s === 'rejected') rejected += 1;
    else open += 1;
  }
  return { total: rows.length, open, closed, rejected };
}

function uniqueNames(rows, key) {
  const set = new Set();
  for (const r of rows) {
    const v = String(r[key] || '').trim();
    if (v && v !== '—') set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function entityCountsFromRows(rows) {
  const counts = {};
  for (const r of rows) {
    const raw = String(r.entity_key || r.entity || r.assignee_company_key || '').toLowerCase();
    let k = 'refex';
    if (raw.includes('extrovis')) k = 'extrovis';
    else if (raw.includes('venwind')) k = 'venwind';
    else if (raw === 'finance' || raw.includes('finance')) k = 'finance';
    else if (raw === 'operation' || raw.includes('operation')) k = 'operation';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function paginateRows(rows, limit, offset) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 2000);
  const off = Math.max(Number(offset) || 0, 0);
  return { lim, off, page: rows.slice(off, off + lim), total: rows.length };
}

async function loadKissflowRecords(pool, {
  environment,
  applicationId,
  entity = 'all',
  status = 'all',
  search = '',
  assigned = '',
  requester = '',
  dateFrom = '',
  dateTo = '',
  limit = 100,
  offset = 0,
  forceLive = false,
  inventory = false,
} = {}) {
  const itsm = isItsmApp(applicationId);

  // Prefer GCP engagement_cache when fresh and newer than snapshot. Never full Kissflow on filter reads.
  try {
    let cache = await loadApplicationEngagementCache(pool, environment, applicationId);
    const snapshotAt = await latestApplicationSnapshotAt(pool, environment, applicationId);

    if (forceLive || !shouldPreferEngagementCache(cache, { snapshotAt, applicationId })) {
      try {
        // Lazy require avoids circular init with kissflowLiveMetrics → buildLiveRecordRows.
        const { fetchLiveAppMetrics } = require('./kissflowLiveMetrics');
        await fetchLiveAppMetrics(environment, applicationId, { persistCache: true });
        cache = await loadApplicationEngagementCache(pool, environment, applicationId);
      } catch {
        /* keep existing cache / fall through to snapshot */
      }
    }

    if (shouldPreferEngagementCache(cache, { snapshotAt, applicationId })) {
      const all = enrichRecordsWithAssigneeCompany(
        dedupeRecords(cache.records.filter((row) => !isDraftRow(row))),
        cache.items || [],
        { skipAssigneeStamp: itsm },
      );
      const filtered = dedupeRecords(filterRecordRows(all, {
        status,
        entity,
        search,
        assigned,
        requester,
        dateFrom,
        dateTo,
        itsmCompanyMode: itsm,
      }));
      filtered.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      const summaryAll = summarizeRows(all);
      const summary = summarizeRows(filtered);
      if (inventory) {
        return {
          application_id: applicationId,
          environment,
          data_source: 'live_cache',
          generated_at: cache.fetched_at || null,
          total: filtered.length,
          limit: filtered.length,
          offset: 0,
          summary,
          inventory_summary: summaryAll,
          filter_options: {
            entities: entityOptionsForApp(applicationId, entityCountsFromRows(all)),
            assignees: uniqueNames(all, 'assigned_to'),
            requesters: uniqueNames(all, 'requested_by'),
            show_assigned: !isSolarApp(applicationId),
            show_requester: true,
            show_entity: !isSolarApp(applicationId),
          },
          columns: columnsForApp(applicationId),
          items: filtered.map((row) => serializeRecordItem(row, { itsm })),
        };
      }
      const { lim, off, page, total } = paginateRows(filtered, limit, offset);
      const counts = entityCountsFromRows(all);
      return {
        application_id: applicationId,
        environment,
        data_source: 'live_cache',
        generated_at: cache.fetched_at || null,
        total,
        limit: lim,
        offset: off,
        summary,
        inventory_summary: summaryAll,
        filter_options: {
          entities: entityOptionsForApp(applicationId, counts),
          assignees: uniqueNames(all, 'assigned_to'),
          requesters: uniqueNames(all, 'requested_by'),
          show_assigned: !isSolarApp(applicationId),
          show_requester: true,
          show_entity: !isSolarApp(applicationId),
        },
        columns: columnsForApp(applicationId),
        items: page.map((row) => serializeRecordItem(row, { itsm })),
      };
    }
  } catch {
    /* fall through to snapshot */
  }

  const INVENTORY_MAX = 8000;
  const lim = inventory
    ? INVENTORY_MAX
    : Math.min(Math.max(Number(limit) || 100, 1), 2000);
  const off = inventory ? 0 : Math.max(Number(offset) || 0, 0);
  const q = String(search || '').trim().toLowerCase();
  const statusFilter = String(status || 'all').toLowerCase();
  const entityFilter = String(entity || 'all').trim().toLowerCase();
  const assignedFilter = String(assigned || '').trim().toLowerCase();
  const requesterFilter = String(requester || '').trim().toLowerCase();

  const latestCte = latestRunsCte({
    environmentParam: '$2',
    applicationIdParam: '$1',
    alias: 'latest',
  });

  const statusSql = statusBucketSql(itsm);
  const entitySql = entityKeySql(applicationId);
  const lead = isLeadApp(applicationId);

  // ITSM Requested by = Requester.Name only (never Created By).
  const requestedBySql = itsm
    ? `COALESCE(
        ${pickPersonNameSql("i.source_payload->'Requester'")},
        NULLIF(trim(i.source_payload->>'Requester_Name'), ''),
        '—'
      )`
    : lead
      ? `COALESCE(
          ${pickPersonNameSql("i.source_payload->'Lead_Owner'")},
          ${pickPersonNameSql("i.source_payload->'Owner'")},
          ${pickPersonNameSql("i.source_payload->'Sales_Person'")},
          ${pickPersonNameSql("i.source_payload->'Lead_Manager'")},
          ${pickPersonNameSql("i.source_payload->'Requester'")},
          '—'
        )`
      : `COALESCE(
        ${pickPersonNameSql("i.source_payload->'Requester'")},
        ${pickPersonNameSql("i.source_payload->'Requested_By'")},
        ${pickPersonNameSql("i.source_payload->'Employee'")},
        ${pickPersonNameSql("i.source_payload->'_created_by'")},
        NULLIF(trim(i.requester_email), ''),
        '—'
      )`;

  const assignedToSql = itsm
    ? `COALESCE(
        ${pickPersonNameSql("i.source_payload->'_current_assigned_to'")},
        ${pickPersonNameSql("i.source_payload->'Column_Q7Ygw5jzjd'")},
        ${pickPersonNameSql("i.source_payload->'Column_Vz3Y600Rds'")},
        ${pickPersonNameSql("i.source_payload->'Column_OyGDeJd2lb'")},
        ${pickPersonNameSql("i.source_payload->'Column_7Fn1867jLF'")},
        ${pickPersonNameSql("i.source_payload->'Column_OomWJzBZKn'")},
        ${pickPersonNameSql("i.source_payload->'Assigned_To'")},
        ${pickPersonNameSql("i.source_payload->'Assignee'")},
        ${pickPersonNameSql("i.source_payload->'AssignedTo'")},
        '—'
      )`
    : `COALESCE(
      ${pickPersonNameSql("i.source_payload->'_current_assigned_to'")},
      ${pickPersonNameSql("i.source_payload->'Column_Q7Ygw5jzjd'")},
      ${pickPersonNameSql("i.source_payload->'Assigned_To'")},
      ${pickPersonNameSql("i.source_payload->'Assignee'")},
      ${pickPersonNameSql("i.source_payload->'AssignedTo'")},
      ${pickPersonNameSql("i.source_payload->'Owner'")},
      '—'
    )`;

  const closedAtSql = `COALESCE(
      ${kissflowTsSql("i.source_payload->'_completed_at'")},
      ${kissflowTsSql("i.source_payload->'_closed_at'")},
      ${kissflowTsSql("i.source_payload->'Closed_On'")},
      ${kissflowTsSql("i.source_payload->'Completed_On'")},
      ${kissflowTsSql("i.source_payload->'_modified_at'")}
    )`;

  const closedBySql = itsm
    ? `COALESCE(
        ${pickPersonNameSql("i.source_payload->'Closed_By'")},
        ${pickPersonNameSql("i.source_payload->'ClosedBy'")},
        ${pickPersonNameSql("i.source_payload->'Resolved_By'")},
        ${pickPersonNameSql("i.source_payload->'Completed_By'")},
        ${pickPersonNameSql("i.source_payload->'_modified_by'")},
        ${pickPersonNameSql("i.source_payload->'_current_assigned_to'")},
        '—'
      )`
    : `'—'`;

  const entityMatchSql = `($4::text = 'all'
    OR (
      $4::text = 'refex'
      AND (c.entity_key IN ('', 'refex') OR (c.entity_key LIKE '%refex%' AND c.entity_key NOT LIKE '%extrovis%' AND c.entity_key NOT LIKE '%venwind%'))
    )
    OR (
      $4::text <> 'refex'
      AND c.entity_key LIKE '%' || $4::text || '%'
    )
  )`;

  const sql = `
WITH ${latestCte},
classified AS (
  SELECT
    i.instance_id,
    i.process_id,
    i.process_status,
    i.snapshot_at,
    (${statusSql}) AS status_bucket,
    (${entitySql}) AS entity_key,
    COALESCE(
      NULLIF(trim(i.source_payload->>'Entity'), ''),
      NULLIF(trim(i.source_payload->'Entity'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Company'), ''),
      NULLIF(trim(i.source_payload->'Company'->>'Name'), ''),
      NULLIF(trim(i.entity), '')
    ) AS entity_raw,
    (${itsmLookupCompanySql()}) AS company_raw,
    COALESCE(
      NULLIF(trim(i.source_payload->>'Task_ID_Formulated'), ''),
      NULLIF(trim(i.source_payload->>'Project_ID_Formulated'), ''),
      NULLIF(trim(i.source_payload->>'Task_ID'), ''),
      NULLIF(trim(i.source_payload->>'Sub_Task_ID'), ''),
      NULLIF(trim(i.source_payload->>'Project_ID'), ''),
      NULLIF(trim(i.source_payload->>'Project_Id'), ''),
      NULLIF(trim(i.source_payload->>'Lead_ID'), ''),
      NULLIF(trim(i.source_payload->>'_request_number'), ''),
      NULLIF(trim(i.source_payload->>'Request_Number'), ''),
      NULLIF(trim(i.source_payload->>'Request_ID'), ''),
      NULLIF(trim(i.source_payload->>'Request_Id'), ''),
      NULLIF(trim(i.source_payload->>'Ticket_ID'), ''),
      NULLIF(trim(i.source_payload->>'Ticket_Number'), ''),
      NULLIF(trim(i.source_payload->>'Req_ID'), ''),
      NULLIF(trim(i.source_payload->>'_id'), ''),
      i.instance_id
    ) AS request_id,
    (${assignedToSql}) AS assigned_to,
    (${closedBySql}) AS closed_by,
    (${requestedBySql}) AS requested_by,
    COALESCE(
      NULLIF(trim(i.source_payload->>'Subject'), ''),
      NULLIF(trim(i.source_payload->>'Title'), ''),
      NULLIF(trim(i.source_payload->>'Summary'), ''),
      NULLIF(trim(i.source_payload->>'Description'), ''),
      NULLIF(trim(i.current_step), ''),
      i.process_id
    ) AS subject,
    COALESCE(
      NULLIF(trim(i.current_step), ''),
      NULLIF(trim(i.source_payload->>'_current_step'), ''),
      i.process_status
    ) AS current_step,
    COALESCE(
      CASE
        WHEN jsonb_typeof(i.source_payload->'_created_at') = 'object'
          THEN NULLIF(trim(i.source_payload->'_created_at'->>'v'), '')::timestamptz
        ELSE NULLIF(trim(i.source_payload->>'_created_at'), '')::timestamptz
      END,
      i.snapshot_at
    ) AS created_at,
    (${closedAtSql}) AS closed_at,
    (${projectKeySql('i')}) AS project_key
  FROM engagement_reporting.item i
  JOIN latest l
    ON i.snapshot_run_id = l.snapshot_run_id
   AND i.process_id = l.process_id
  WHERE NOT (${isDraftSql('i')})
),
filtered AS (
  SELECT * FROM classified c
  WHERE ($3::text = 'all' OR c.status_bucket = $3)
    AND (${entityMatchSql})
    AND (
      $5::text = ''
      OR lower(c.request_id) LIKE '%' || $5 || '%'
      OR lower(c.assigned_to) LIKE '%' || $5 || '%'
      OR lower(c.requested_by) LIKE '%' || $5 || '%'
      OR lower(c.subject) LIKE '%' || $5 || '%'
      OR lower(c.current_step) LIKE '%' || $5 || '%'
    )
    AND ($8::text = '' OR lower(c.assigned_to) LIKE '%' || $8 || '%')
    AND ($9::text = '' OR lower(c.requested_by) LIKE '%' || $9 || '%')
)
SELECT
  (SELECT count(*)::int FROM filtered) AS total_count,
  (SELECT count(*)::int FROM classified) AS inventory_total,
  (SELECT count(*)::int FROM classified WHERE status_bucket = 'open') AS inventory_open,
  (SELECT count(*)::int FROM classified WHERE status_bucket = 'closed') AS inventory_closed,
  (SELECT count(*)::int FROM classified WHERE status_bucket = 'rejected') AS inventory_rejected,
  (SELECT count(*)::int FROM filtered WHERE status_bucket = 'open') AS filtered_open,
  (SELECT count(*)::int FROM filtered WHERE status_bucket = 'closed') AS filtered_closed,
  (SELECT count(*)::int FROM filtered WHERE status_bucket = 'rejected') AS filtered_rejected,
  COALESCE((
    SELECT json_object_agg(entity_key, cnt)
    FROM (
      SELECT entity_key, count(*)::int AS cnt FROM classified GROUP BY entity_key
    ) e
  ), '{}'::json) AS entity_counts,
  COALESCE((
    SELECT json_agg(DISTINCT assigned_to ORDER BY assigned_to)
    FROM classified WHERE assigned_to IS NOT NULL AND assigned_to <> '—'
  ), '[]'::json) AS assignee_options,
  COALESCE((
    SELECT json_agg(DISTINCT requested_by ORDER BY requested_by)
    FROM classified WHERE requested_by IS NOT NULL AND requested_by <> '—'
  ), '[]'::json) AS requester_options,
  COALESCE((
    SELECT json_agg(row_to_json(r) ORDER BY r.created_at DESC NULLS LAST)
    FROM (
      SELECT
        c.instance_id,
        c.process_id,
        c.request_id,
        c.assigned_to,
        c.closed_by,
        c.requested_by,
        c.subject,
        c.current_step,
        c.process_status AS status_raw,
        c.status_bucket AS status,
        c.entity_key,
        c.entity_raw,
        c.company_raw,
        c.created_at,
        c.closed_at,
        c.snapshot_at,
        c.project_key
      FROM filtered c
      ORDER BY c.created_at DESC NULLS LAST
      LIMIT $6 OFFSET $7
    ) r
  ), '[]'::json) AS items
  `;

  const { rows } = await pool.query(sql, [
    applicationId,
    environment,
    statusFilter === 'all' ? 'all' : statusFilter,
    entityFilter === 'all' ? 'all' : entityFilter,
    q,
    lim,
    off,
    assignedFilter,
    requesterFilter,
  ]);
  const row = rows[0] || {};
  const items = Array.isArray(row.items) ? row.items : [];
  const entityCounts = row.entity_counts && typeof row.entity_counts === 'object' ? row.entity_counts : {};
  const assigneeOptions = Array.isArray(row.assignee_options) ? row.assignee_options.filter(Boolean) : [];
  const requesterOptions = Array.isArray(row.requester_options) ? row.requester_options.filter(Boolean) : [];

  return {
    application_id: applicationId,
    environment,
    data_source: 'snapshot_items',
    total: Number(row.total_count || 0),
    limit: inventory ? items.length : lim,
    offset: inventory ? 0 : off,
    summary: {
      total: Number(row.total_count || 0),
      open: Number(row.filtered_open || 0),
      closed: Number(row.filtered_closed || 0),
      rejected: Number(row.filtered_rejected || 0),
    },
    inventory_summary: {
      total: Number(row.inventory_total || 0),
      open: Number(row.inventory_open || 0),
      closed: Number(row.inventory_closed || 0),
      rejected: Number(row.inventory_rejected || 0),
    },
    filter_options: {
      entities: entityOptionsForApp(applicationId, entityCounts),
      assignees: assigneeOptions,
      requesters: requesterOptions,
      show_assigned: !isSolarApp(applicationId),
      show_requester: true,
      show_entity: !isSolarApp(applicationId),
    },
    columns: columnsForApp(applicationId),
    items: items
      .filter(isMeaningfulRecord)
      .map((it) => {
        const entityKey = String(it.entity_key || '');
        const entityRaw = String(it.entity_raw || '').trim();
        const entityDisplay = entityRaw || entityLabel(entityKey);
        if (itsm) {
          const lookupCompany = String(it.company_raw || '').trim();
          const companyText = lookupCompany && !isEntityBucketLabel(lookupCompany)
            ? lookupCompany
            : REFEX_DEFAULT_COMPANY_NAME;
          return serializeRecordItem({
            ...it,
            id: String(it.instance_id || it.request_id),
            entity: entityDisplay,
            entity_key: entityKey,
            company: companyText,
            company_name: companyText,
            company_key: resolveCompanyIdFromText(companyText) || undefined,
            project_id: it.project_key || undefined,
            project_key: it.project_key || undefined,
          }, { itsm: true });
        }
        const companyKey = resolveCompanyIdFromText(entityRaw) || resolveCompanyIdFromText(entityKey) || undefined;
        return serializeRecordItem({
          ...it,
          id: String(it.instance_id || it.request_id),
          entity: entityDisplay,
          entity_key: entityKey,
          company: entityDisplay,
          company_key: companyKey,
          project_id: it.project_key || undefined,
          project_key: it.project_key || undefined,
        });
      }),
  };
}

async function loadP2pRecords({
  entity = 'all',
  status = 'all',
  search = '',
  limit = 50,
  offset = 0,
  assigned = '',
  requester = '',
} = {}) {
  if (!isP2pConfigured()) {
    const err = new Error('P2P MySQL is not configured');
    err.code = 'P2P_NOT_CONFIGURED';
    throw err;
  }
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const q = String(search || '').trim().toLowerCase();
  const statusFilter = String(status || 'all').toLowerCase();
  const entityFilter = String(entity || 'all').trim();
  const requesterFilter = String(requester || '').trim().toLowerCase();

  const userCols = await p2pQuery(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users'`,
  );
  const uc = new Set((userCols || []).map((c) => String(c.column_name || c.COLUMN_NAME || '').toLowerCase()).filter(Boolean));
  const nameCol = ['full_name', 'display_name', 'user_name', 'username', 'name', 'employee_name']
    .find((c) => uc.has(c));
  const firstCol = ['first_name', 'firstname', 'fname'].find((c) => uc.has(c));
  const lastCol = ['last_name', 'lastname', 'lname'].find((c) => uc.has(c));
  let userNameExpr = 'NULL';
  if (firstCol || lastCol) {
    userNameExpr = `NULLIF(TRIM(CONCAT_WS(' ', ${firstCol ? `u.\`${firstCol}\`` : 'NULL'}, ${lastCol ? `u.\`${lastCol}\`` : 'NULL'})), '')`;
  } else if (nameCol) {
    userNameExpr = `NULLIF(TRIM(CAST(u.\`${nameCol}\` AS CHAR)), '')`;
  }
  const emailExpr = uc.has('email') ? `NULLIF(TRIM(u.email), '')` : 'NULL';

  const entitySqlPr = entityFilter && entityFilter !== 'all'
    ? `AND pr.entity_id = ${Number(entityFilter) || 0}`
    : '';
  const entitySqlPo = entityFilter && entityFilter !== 'all'
    ? `AND po.entity_id = ${Number(entityFilter) || 0}`
    : '';

  const prRows = await p2pQuery(
    `SELECT
       pr.id,
       pr.status,
       pr.entity_id,
       pr.total_amount AS amount,
       COALESCE(pr.submitted_at, pr.created_at) AS created_at,
       COALESCE(${userNameExpr}, ${emailExpr}, CONCAT('User ', pr.requester_id)) AS requester_name
     FROM purchase_requests pr
     LEFT JOIN users u ON u.id = pr.requester_id
     WHERE 1=1 ${entitySqlPr}`,
  );
  const poRows = await p2pQuery(
    `SELECT
       po.id,
       po.status,
       po.entity_id,
       po.grand_total AS amount,
       COALESCE(po.created_at, po.po_date) AS created_at,
       COALESCE(${userNameExpr}, ${emailExpr}, CONCAT('User ', po.created_by)) AS requester_name
     FROM purchase_orders po
     LEFT JOIN users u ON u.id = po.created_by
     WHERE 1=1 ${entitySqlPo}`,
  );

  function prStatus(raw) {
    const st = String(raw || '').toUpperCase();
    if (st === 'REJECTED') return 'rejected';
    if (st === 'APPROVED') return 'closed';
    return 'open';
  }
  function poStatus(raw) {
    const st = String(raw || '').toLowerCase();
    if (['rejected', 'cancelled'].includes(st)) return 'rejected';
    if (['approved', 'awaiting_grn', 'grn_completed', 'invoice_entry', 'pending_accounts_approval', 'approved_for_payment', 'paid'].includes(st)) {
      return 'closed';
    }
    return 'open';
  }

  function isP2pDraftStatus(status) {
    return String(status || '').toLowerCase() === 'draft';
  }

  let merged = [
    ...(prRows || []).map((r) => ({
      id: `PR-${r.id}`,
      request_id: String(r.id),
      subject: 'Purchase Requisition',
      assigned_to: '—',
      requested_by: String(r.requester_name || `User ${r.id}`),
      status: prStatus(r.status),
      status_raw: String(r.status || ''),
      entity_id: r.entity_id,
      entity_key: String(r.entity_id || ''),
      current_step: String(r.status || ''),
      process_id: 'purchase_requests',
      created_at: r.created_at,
      amount: r.amount != null ? Number(r.amount) : null,
    })),
    ...(poRows || []).map((r) => ({
      id: `PO-${r.id}`,
      request_id: String(r.id),
      subject: 'Purchase Order',
      assigned_to: '—',
      requested_by: String(r.requester_name || `User ${r.id}`),
      status: poStatus(r.status),
      status_raw: String(r.status || ''),
      entity_id: r.entity_id,
      entity_key: String(r.entity_id || ''),
      current_step: String(r.status || ''),
      process_id: 'purchase_orders',
      created_at: r.created_at,
      amount: r.amount != null ? Number(r.amount) : null,
    })),
  ].filter((r) => !isP2pDraftStatus(r.status_raw));

  const inventory = [...merged];
  if (statusFilter !== 'all') {
    merged = merged.filter((r) => r.status === statusFilter);
  }
  if (requesterFilter) {
    merged = merged.filter((r) => String(r.requested_by || '').toLowerCase().includes(requesterFilter));
  }
  if (q) {
    merged = merged.filter((r) => {
      const hay = `${r.request_id} ${r.requested_by} ${r.status_raw} ${r.subject}`.toLowerCase();
      return hay.includes(q);
    });
  }
  merged.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });

  let entityMap = new Map();
  const entityCounts = {};
  try {
    const dash = await loadP2pDashboard({ environment: 'production', period: 'all' });
    for (const e of dash.entities || []) {
      if (e.id !== 'all') {
        entityMap.set(String(e.id), e.label);
        entityCounts[String(e.id)] = Number(e.count || 0);
      }
    }
  } catch {
    /* ignore */
  }

  const total = merged.length;
  const page = merged.slice(off, off + lim);
  const summary = summarizeRows(merged);
  const inventorySummary = summarizeRows(inventory);

  const p2pEntities = [...entityMap.entries()].map(([id, label]) => ({
    id,
    label,
    count: Number(entityCounts[id] || 0),
  }));

  return {
    application_id: 'Procurement_to_Pay_A00',
    environment: 'production',
    data_source: 'p2p_mysql',
    total,
    limit: lim,
    offset: off,
    summary,
    inventory_summary: inventorySummary,
    filter_options: {
      entities: p2pEntities,
      assignees: [],
      requesters: uniqueNames(inventory, 'requested_by'),
      show_assigned: false,
      show_requester: true,
      show_entity: p2pEntities.length > 0,
    },
    columns: columnsForApp('Procurement_to_Pay_A00'),
    items: page.map((it) => ({
      ...it,
      entity: entityMap.get(String(it.entity_id)) || (it.entity_id != null ? `Entity ${it.entity_id}` : '—'),
    })),
  };
}

async function loadApplicationRecords(pool, opts = {}) {
  const applicationId = String(opts.applicationId || '').trim();
  if (isP2pApplication(applicationId)) {
    return loadP2pRecords(opts);
  }
  return loadKissflowRecords(pool, opts);
}

module.exports = {
  loadApplicationRecords,
  loadKissflowRecords,
  loadP2pRecords,
  buildLiveRecordRows,
  enrichRecordsWithAssigneeCompany,
  extractItsmCompanyNameFromRaw,
  companyTextFromRaw,
  isItsmApp,
  isDraftRaw,
  isDraftSql,
  assigneeMetaFromRaw,
  isPmApp,
  buildPmPortfolioFromRecords,
};
