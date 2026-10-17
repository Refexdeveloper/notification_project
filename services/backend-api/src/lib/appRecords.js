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
  hasUsableEngagementRecords,
  shouldPreferEngagementCache,
} = require('./engagementCache');
const { latestApplicationSnapshotAt } = require('./snapshotRuns');
const {
  normalizeProcessStatus,
  pickCurrentStep,
  isProcessStatusLabel,
  pickString,
  pickDateTime,
  coerceKissflowDate,
  isItsmBusinessClosed,
  isItsmBusinessOpen,
  resolveKissflowCredentials,
  kissflowGetUrl,
  extractArray,
} = require('./kissflowClient');
const { classifyTicketSource, normalizeItsmPersonLabel, pickSolarStep } = require('./dashboardDisplay');
const { projectKeyFromRaw, buildPmPortfolioFromRecords, projectKeySql } = require('./pmPortfolio');

const ITSM_APP_ID = 'IT_Service_Management_A00';
const ITSM_REFEX_PROCESS_ID = 'Live_IT_Service_Request_A00';
const ITSM_REFEX_REPORT_ID = 'Service_Items_Refex_A00';
const ITSM_EXTROVIS_PROCESS_ID = 'Live_IT_Service_Request_Extrovis_A00';
const ITSM_EXTROVIS_REPORT_ID = 'All_tickets_A00';
const ITSM_REPORT_CLOSER_TTL_MS = 5 * 60 * 1000;
const TRAVEL_APP_ID = 'Expense_and_Travel_Management_A00';
const SOLAR_APP_ID = 'Solar_Site_Expense_Governance_Syst_A00';

function sqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function cleanItsmDescription(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '—') return '';
  const text = /<[a-z][\s\S]*>/i.test(raw)
    ? raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
    : raw;
  return text;
}

/** Text or {Name} / {v} from a Kissflow source_payload field. */
function payloadFieldSql(keys) {
  const parts = [];
  for (const key of keys) {
    const safe = sqlLiteral(key);
    parts.push(`NULLIF(trim(i.source_payload->>'${safe}'), '')`);
    parts.push(`NULLIF(trim(i.source_payload->'${safe}'->>'Name'), '')`);
    parts.push(`NULLIF(trim(i.source_payload->'${safe}'->>'v'), '')`);
    parts.push(`NULLIF(trim(i.source_payload->'${safe}'->>'text'), '')`);
    parts.push(`NULLIF(trim(i.source_payload->'${safe}'->>'Text'), '')`);
  }
  return `COALESCE(${parts.join(', ')})`;
}

/** Native names + Refex/Extrovis/report Column ids (process ingest often stores Column_* only). */
const ITSM_TICKET_TYPE_KEYS = [
  'Request_Type', 'Ticket_Type', 'Ticket_Type_Detail',
  'Column_EM6o5_acb3', 'Column_MnD5TeiOke', 'Column_ngHfbXhmqj', 'Column_vW-7Jwyvqb',
];
const ITSM_CATEGORY_KEYS = [
  'Category', 'Column_pFbqS2Q9gD', 'Column_53Z2oyBbZk', 'Column_9oE6HPRxGd',
];
const ITSM_SUB_CATEGORY_KEYS = [
  'SubCategory', 'Sub_Category', 'Sub Category',
  'Column_wgwPyyrhqe', 'Column_AC0_BCY9hP', 'Column_OHkPEsIs52',
];
const ITSM_CRITICALITY_KEYS = [
  'Criticality', 'Column_SjoEGM7XlG', 'Column_nps6UwRtUp', 'Column_AZfxrxgc1d',
];
/** Service-queue Subject: Refex Column_iiZk0Xon6N, Extrovis Column_HEiwMtIBBO. */
const ITSM_SUMMARY_KEYS = [
  'Column_iiZk0Xon6N',
  'Column_HEiwMtIBBO',
  'Summary',
];
/** Service-queue Description: Refex Column_E-ofBZkcFS, Extrovis Column_AS7UbLz7Mg. */
const ITSM_DESCRIPTION_KEYS = [
  'Column_E-ofBZkcFS',
  'Column_AS7UbLz7Mg',
  'Description',
];
const ITSM_EXPECTED_AT_KEYS = ['ExpectedAt', 'Expected_At', 'SLA_ExpectedAt', '_expected_at'];
const ITSM_SLA_BREACHED_KEYS = ['SLA_Breached', 'Sla_Breached', 'Column_qG4mgtZVzY'];
const ITSM_SLA_MINUTES_KEYS = ['SLA_Timing_Min', 'SLA_Minutes', 'Column_EezOqIO3Qm', 'Column_6FEEbVGpOh'];
const ITSM_CLOSURE_MINUTES_KEYS = [
  'Closure_Time', 'Closure_Minutes', 'Column_EJ_2bDMtnD', 'Column_mEZwE_B6CW',
];
const ITSM_TAT_MINUTES_KEYS = [
  'TAT_Minutes', 'TurnAround_Time_TAT', 'Column_uzB76CIUdv', 'Column_VO-1shRU1Q',
];
const ITSM_FORM_STATUS_KEYS = [
  'Statu_1',
  'Column_ps84EEKkEI',
  'Column_WRiZDgVSqj',
  'Column_0GDnNoEuA7',
  'Column_69zTtmtO92',
  'Stages',
  'Column_JUGHj6d2Xj',
  'Column_GooYV3HuY1',
  'Status',
];
const ITSM_REOPENED_DATE_KEYS = ['Reopened_On', 'Reopened_Date', 'ReopenedOn', 'Reopened_Date_Time'];
const ITSM_REOPENED_FLAG_KEYS = ['Reopened_Ticket', 'Reopened', 'Column_C7s_oevsgX', 'Column_U0QcqEXR63'];
const ITSM_MODIFIED_DATE_KEYS = ['_modified_at', 'Modified_At', 'Column_JOmYm9Frwx', 'Column_QpPzei51U2'];
const ITSM_CLOSED_DATE_KEYS = [
  '_completed_at', '_closed_at', 'Closed_On', 'Completed_On', 'Closed_Date', 'Completed_Date',
];
/** IT Agent Solution / activity DateTime — same columns Head Refex + Extrovis use for Closed Date. */
const ITSM_AGENT_CLOSED_DATE_KEYS = [
  'Column__LGAMX8kf0',
  'Column_R_u4Nyl5q_',
  'ITAgentDate_Time',
  'Date_Time',
  'ActedAt',
  'actedAt',
];

function isItsmNonHumanActor(value) {
  const token = String(value || '').toLowerCase().replace(/[\s._-]+/g, '');
  if (!token) return true;
  return token === 'itsm'
    || token === 'itsmsa'
    || token.startsWith('itsmbot')
    || token === 'itsmserviceaccount'
    || token === 'bot'
    || token.endsWith('bot')
    || token.includes('automation')
    || token.includes('autoclose')
    || token === 'itagents'
    || token === 'itagentsextrovis'
    || token === 'firstapprover'
    || token === 'firstapproverextrovis'
    || token === 'itmanager'
    || token === 'ithead'
    || token === 'itadmin';
}

function blankMis(value) {
  const text = String(value == null ? '' : value).trim();
  return !text || text === '—' || text === '-';
}

function blankNumericMis(value) {
  if (blankMis(value)) return true;
  const text = String(value).trim();
  return !/^[0-9]+([.][0-9]+)?$/.test(text) && !/^\d+\s*:\s*\d+$/.test(text);
}

function applyItsmMisExtras(records, extrasById) {
  if (!extrasById || !extrasById.size) return records || [];
  return (records || []).map((row) => {
    const extra = extrasById.get(String(row.id || ''))
      || extrasById.get(String(row.instance_id || ''))
      || extrasById.get(String(row.request_id || ''));
    if (!extra) return row;
    const status = String(row.status || '').toLowerCase();
    const closed = status === 'closed' || status === 'rejected';
    const closedBy = (blankMis(row.closed_by) || isItsmNonHumanActor(row.closed_by))
      ? extra.closed_by
      : row.closed_by;
    const assigned = usableAssignedName(row.assigned_to);
    const assignedHuman = assigned && !isItsmNonHumanActor(assigned) ? assigned : '';
    const description = cleanItsmDescription(blankMis(row.description) ? extra.description : row.description)
      || cleanItsmDescription(extra.description)
      || undefined;
    const summary = String(extra.summary || '').trim();
    const existingSubject = String(row.subject || '').trim();
    const subject = summary
      || (description && existingSubject === description ? '' : existingSubject)
      || existingSubject;
    return {
      ...row,
      ticket_type: blankMis(row.ticket_type) ? extra.ticket_type : row.ticket_type,
      subject: subject && subject !== '—' ? subject : row.subject,
      description,
      expected_at: row.expected_at || extra.expected_at || null,
      category: blankMis(row.category) ? extra.category : row.category,
      sub_category: blankMis(row.sub_category) ? extra.sub_category : row.sub_category,
      criticality: blankMis(row.criticality) ? extra.criticality : row.criticality,
      sla_breached: blankMis(row.sla_breached) ? extra.sla_breached : row.sla_breached,
      sla_minutes: blankNumericMis(row.sla_minutes) ? extra.sla_minutes : row.sla_minutes,
      closure_minutes: blankNumericMis(row.closure_minutes) ? extra.closure_minutes : row.closure_minutes,
      tat_minutes: blankNumericMis(row.tat_minutes) ? extra.tat_minutes : row.tat_minutes,
      form_status: blankMis(row.form_status) ? extra.form_status : row.form_status,
      reopened_at: row.reopened_at || extra.reopened_at || null,
      // KPI Closed Today uses reopen_entered_at (step move), not _modified_at.
      closed_at: row.closed_at || extra.closed_at || extra.completed_at || null,
      agent_closed_at: row.agent_closed_at || extra.agent_closed_at || null,
      reopen_entered_at: row.reopen_entered_at || extra.reopen_entered_at || null,
      modified_at: row.modified_at || extra.modified_at || null,
      closed_by: closedBy,
      assigned_to: (closed && !assignedHuman && closedBy && !isItsmNonHumanActor(closedBy))
        ? closedBy
        : row.assigned_to,
    };
  });
}

async function loadItsmMisExtrasById(pool, environment, applicationId) {
  const latestCte = latestRunsCte({
    environmentParam: '$2',
    applicationIdParam: '$1',
    alias: 'latest',
  });
  const closedBySql = `COALESCE(
    ${pickPersonNameSql("i.source_payload->'Closed_By'")},
    ${pickPersonNameSql("i.source_payload->'ClosedBy'")},
    ${pickPersonNameSql("i.source_payload->'Resolved_By'")},
    ${pickPersonNameSql("i.source_payload->'_modified_by'")},
    ${pickPersonNameSql("i.source_payload->'_current_assigned_to'")}
  )`;
  const sql = `
  WITH ${latestCte}
  SELECT
    i.instance_id,
    COALESCE(
      NULLIF(trim(i.source_payload->>'_request_number'), ''),
      NULLIF(trim(i.source_payload->>'Request_ID'), ''),
      NULLIF(trim(i.source_payload->>'Request_Id'), ''),
      NULLIF(trim(i.source_payload->>'Ticket_ID'), '')
    ) AS request_id,
    (${payloadFieldSql(ITSM_TICKET_TYPE_KEYS)}) AS ticket_type,
    (${payloadFieldSql(ITSM_SUMMARY_KEYS)}) AS summary,
    (${payloadFieldSql(ITSM_DESCRIPTION_KEYS)}) AS description,
    (${payloadTsSql(ITSM_EXPECTED_AT_KEYS)}) AS expected_at,
    (${payloadFieldSql(ITSM_CATEGORY_KEYS)}) AS category,
    (${payloadFieldSql(ITSM_SUB_CATEGORY_KEYS)}) AS sub_category,
    (${payloadFieldSql(ITSM_CRITICALITY_KEYS)}) AS criticality,
    (${payloadFieldSql(ITSM_SLA_BREACHED_KEYS)}) AS sla_breached,
    (${payloadNumericSql(ITSM_SLA_MINUTES_KEYS)}) AS sla_minutes,
    (${payloadNumericSql(ITSM_CLOSURE_MINUTES_KEYS)}) AS closure_minutes,
    (${payloadNumericSql(ITSM_TAT_MINUTES_KEYS)}) AS tat_minutes,
    (${payloadFieldSql(ITSM_FORM_STATUS_KEYS)}) AS form_status,
    COALESCE(
      ${payloadTsSql(ITSM_REOPENED_DATE_KEYS)},
      CASE
        WHEN lower(coalesce(${payloadFieldSql(ITSM_REOPENED_FLAG_KEYS)}, '')) IN ('yes', 'true', '1', 'y')
          THEN ${payloadTsSql(ITSM_MODIFIED_DATE_KEYS)}
        ELSE NULL
      END
    ) AS reopened_at,
    COALESCE(
      ${payloadTsSql(ITSM_CLOSED_DATE_KEYS)}
    ) AS closed_at,
    (${payloadTsSql(ITSM_MODIFIED_DATE_KEYS)}) AS modified_at,
    (${closedBySql}) AS closed_by,
    i.source_payload
  FROM engagement_reporting.item i
  JOIN latest l
    ON i.snapshot_run_id = l.snapshot_run_id
   AND i.process_id = l.process_id
  `;
  const { rows } = await pool.query(sql, [applicationId, environment]);
  const map = new Map();
  for (const row of rows || []) {
    const fromPayload = extractItsmCloserMeta(row.source_payload);
    const closedBy = fromPayload.closed_by || (row.closed_by && !isItsmNonHumanActor(row.closed_by)
      ? normalizeItsmPersonLabel(String(row.closed_by).trim())
      : '');
    const extra = {
      ticket_type: row.ticket_type || undefined,
      summary: row.summary || undefined,
      description: cleanItsmDescription(row.description) || undefined,
      expected_at: row.expected_at || null,
      category: row.category || undefined,
      sub_category: row.sub_category || undefined,
      criticality: row.criticality || undefined,
      sla_breached: row.sla_breached || undefined,
      sla_minutes: row.sla_minutes || undefined,
      closure_minutes: row.closure_minutes || undefined,
      tat_minutes: row.tat_minutes || undefined,
      form_status: row.form_status || undefined,
      reopened_at: row.reopened_at || null,
      closed_at: row.closed_at || fromPayload.completed_at || null,
      agent_closed_at: fromPayload.agent_closed_at || null,
      reopen_entered_at: fromPayload.reopen_entered_at || null,
      modified_at: row.modified_at || fromPayload.modified_at || null,
      completed_at: fromPayload.completed_at || null,
      closed_by: closedBy || undefined,
    };
    for (const key of [row.instance_id, row.request_id]) {
      if (key) map.set(String(key), extra);
    }
  }
  return map;
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

/** Kissflow site lookup: Side_ID.site_name_fqiW (not lookup Name "Budget Master…"). */
function solarSiteNameFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const side = raw.Side_ID;
  if (side && typeof side === 'object') {
    const name = String(side.site_name_fqiW || side.site_name || side.Site_Name || '').trim();
    if (name) return name;
  }
  return pickString(raw, ['Selected_Site_ID', 'Site_Name', 'Site', 'Location', 'Site_Location']);
}

function solarWorkflowStepSql(alias = 'i') {
  const payload = `${alias}.source_payload`;
  return `NULLIF(trim(COALESCE(
    CASE
      WHEN lower(trim(COALESCE(
        CASE WHEN jsonb_typeof(${payload}->'_current_step') = 'object'
          THEN ${payload}->'_current_step'->>'Name'
          ELSE ${payload}->>'_current_step'
        END, '')
      )) IN ('rejected','inprogress','in progress','completed','withdrawn','closed','open','pending','draft','done')
        THEN NULL
      WHEN jsonb_typeof(${payload}->'_current_step') = 'object'
        THEN NULLIF(trim(${payload}->'_current_step'->>'Name'), '')
      ELSE NULLIF(trim(${payload}->>'_current_step'), '')
    END,
    (
      SELECT NULLIF(trim(c->>'_context_current_step'), '')
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(${payload}->'_current_context') = 'array'
          THEN ${payload}->'_current_context'
          ELSE '[]'::jsonb
        END
      ) c
      WHERE NULLIF(trim(c->>'_context_current_step'), '') IS NOT NULL
        AND lower(trim(c->>'_context_current_step'))
          NOT IN ('rejected','inprogress','in progress','completed','withdrawn','closed','open','pending','draft','done')
      ORDER BY CASE WHEN lower(trim(c->>'_status')) IN ('rejected','withdrawn') THEN 0 ELSE 1 END
      LIMIT 1
    ),
    NULLIF(trim(${payload}->>'_activity_name'), ''),
    NULLIF(trim(${payload}->>'Current_Step'), '')
  )), '')`;
}

function solarSiteNameSql(alias = 'i') {
  const payload = `${alias}.source_payload`;
  return `NULLIF(trim(COALESCE(
    NULLIF(trim(${payload}->'Side_ID'->>'site_name_fqiW'), ''),
    NULLIF(trim(${payload}->>'Selected_Site_ID'), ''),
    NULLIF(trim(${payload}->>'Site_Name'), ''),
    NULLIF(trim(${payload}->>'Site'), '')
  )), '')`;
}

function isPmApp(applicationId) {
  const hay = String(applicationId || '').toLowerCase();
  return hay.includes('project_management') || hay.includes('project_tracker');
}

function isLeadApp(applicationId) {
  return String(applicationId || '').toLowerCase().includes('lead');
}

/** Kissflow field `Website_and_form` (label: Website And Form). */
function websiteFromRaw(raw) {
  return pickString(raw, ['Website_and_form', 'Website']) || '';
}

function isLeadBusinessClosed(raw) {
  const lead = String(raw?.Lead_Status || '').toLowerCase().trim();
  if (lead === 'close' || lead === 'closed' || lead === 'completed' || lead === 'done') return true;
  if (lead === 'open') return false;
  const st = normalizeProcessStatus(raw);
  return st === 'Completed' || st === 'Closed';
}

function isEmsApp(applicationId) {
  const hay = String(applicationId || '').toLowerCase();
  return hay.includes('ems');
}

/** Kissflow currency / number — first finite value in key order. */
const AMOUNT_FIELD_KEYS = [
  'Final_amount',
  'advance_amount_in_number',
  'Advance_amount_value',
  'Advance_Amount',
  'Final_Total_Amount',
  'Total_Claimable_Amount',
  'Total_Raised_Amount',
  'Total_Reimbursable_Amount_single',
  'Final_Bill_Amount',
  'Expense_Amount',
  'Total_Amount',
  'Ticker_Fare',
  'FS_Total_Fare_1',
  'FS_Booking_Amount_1',
  'FS_Booking_Amount',
  'MC_Total_Booking_Amount',
  'Amount',
  'Grand_Total',
  'Claimed_Amount',
  'total_amount',
];

function coerceAmount(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'object') {
    return coerceAmount(val.v ?? val.Value ?? val.value ?? val.amount ?? val.Amount);
  }
  const n = Number(String(val).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pickAmountFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let fallback = null;
  for (const key of AMOUNT_FIELD_KEYS) {
    const n = coerceAmount(raw[key]);
    if (n == null) continue;
    if (n > 0) return n;
    if (fallback == null) fallback = n;
  }
  return fallback;
}

function travelProcessTitle(processId) {
  const pid = String(processId || '').toLowerCase();
  if (pid.includes('travel_management')) return 'Travel request';
  if (pid.includes('advance')) return 'Travel advance';
  if (pid.includes('expense')) return 'Travel expense';
  return processId.replace(/_/g, ' ');
}

const TRAVEL_TRIP_TYPE_KEYS = ['OnewayRound_tripNot_applicable', 'Travel_Type', 'FS_Trip_Type', 'Trip_Type'];
const TRAVEL_FROM_CITY_KEYS = ['Boarding_from', 'FS_From_City', 'common_From', 'Source', 'From_City'];
const TRAVEL_TO_CITY_KEYS = ['Destination_to_1', 'FS_To_City', 'common_To', 'Destination', 'To_City'];
const TRAVEL_DEPARTURE_KEYS = ['Departure_Date', 'FS_Departure_Date', 'From_Date', 'Common_from_date'];

function travelPlaceFieldsFromRaw(raw) {
  return {
    trip_type: pickString(raw, TRAVEL_TRIP_TYPE_KEYS) || undefined,
    from_city: pickString(raw, TRAVEL_FROM_CITY_KEYS) || undefined,
    to_city: pickString(raw, TRAVEL_TO_CITY_KEYS) || undefined,
    departure_date: pickDateTime(raw, TRAVEL_DEPARTURE_KEYS) || undefined,
  };
}

function pickTravelExpenseType(raw) {
  const text = pickString(raw, ['Expense_Type_Concatenation', 'Expense_Typefiled', 'Expense_Type_1']);
  if (text) return text;
  const arr = raw?.Expense_Type;
  if (!Array.isArray(arr)) return undefined;
  const parts = arr.map((item) => {
    if (typeof item === 'string' && item.trim()) return item.trim();
    return pickString(item || {}, ['Name', 'name', 'v', 'text']) || '';
  }).filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function yesNoFromRaw(value) {
  if (value === true || value === 'true' || value === 'Yes') return 'Yes';
  if (value === false || value === 'false' || value === 'No') return 'No';
  const text = String(value || '').trim();
  return text || undefined;
}

const EMS_RAISED_KEYS = [
  'Total_Raised_Amount', 'Final_amount', 'Final_Total_Amount', 'Total_Amount', 'Amount',
];
const EMS_CLAIMED_KEYS = [
  'Claimed_Amount', 'Total_Claimable_Amount', 'Total_Reimbursable_Amount_single', 'Final_Bill_Amount',
];

function pickFirstPositiveAmount(raw, keys) {
  if (!raw || typeof raw !== 'object') return undefined;
  for (const key of keys) {
    const n = coerceAmount(raw[key]);
    if (n != null && n > 0) return n;
  }
  return undefined;
}

function parseExpenseTypeList(raw) {
  const joined = pickTravelExpenseType(raw) || pickString(raw, ['Expense_Type', 'Expense_Category']);
  if (!joined) return [];
  return String(joined).split(/[,;/|]+/).map((part) => part.trim()).filter(Boolean);
}

function childTableLooksLikeSplits(rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
    return false;
  }
  return rows.some((row) => {
    const type = pickString(row || {}, ['Expense_Type', 'Type', 'Category', 'Name', 'Expense_Type_1']);
    const amount = coerceAmount(row?.Amount ?? row?.Expense_Amount ?? row?.Claim_Amount ?? row?.Raised_Amount);
    return Boolean(type) || amount != null;
  });
}

function emsSplitsFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const fromTables = [];
  for (const value of Object.values(raw)) {
    if (!childTableLooksLikeSplits(value)) continue;
    for (const row of value) {
      const type = pickString(row || {}, ['Expense_Type', 'Type', 'Category', 'Name', 'Expense_Type_1']);
      if (!type) continue;
      fromTables.push({
        type,
        amount: coerceAmount(row.Amount ?? row.Expense_Amount ?? row.Claim_Amount ?? row.Raised_Amount),
        vehicle: pickString(row || {}, ['Vehicle_Type', 'Vehicle', 'Travel_Mode', 'Travel_Mode_1', 'Mode']) || undefined,
      });
    }
    if (fromTables.length) return fromTables;
  }

  const types = parseExpenseTypeList(raw);
  if (!types.length) return [];
  const amountKeys = [
    { match: /daily|allowance|per.?diem/i, keys: ['Daily_Allowance_Amount', 'Daily_Allowance', 'DA_Amount', 'Per_Diem_Amount'] },
    { match: /food|meal/i, keys: ['Food_Claim_Amount', 'Food_Amount', 'Meal_Amount', 'Food_Claim'] },
    { match: /convey|local travel|transport/i, keys: ['Local_Conveyance_Amount', 'Conveyance_Amount', 'Local_Amount'] },
  ];
  return types.map((type) => {
    const hit = amountKeys.find((row) => row.match.test(type));
    return {
      type,
      amount: hit ? pickFirstPositiveAmount(raw, hit.keys) : undefined,
      vehicle: /convey|local travel|transport/i.test(type)
        ? (pickString(raw, ['Vehicle_Type', 'Vehicle_Type_1', 'Travel_Mode_1', 'Travel_Mode']) || undefined)
        : undefined,
    };
  });
}

function emsDetailFieldsFromRaw(raw) {
  const splits = emsSplitsFromRaw(raw);
  const vehicle = pickString(raw, ['Vehicle_Type', 'Vehicle_Type_1', 'Travel_Mode_1', 'Travel_Mode'])
    || splits.map((row) => row.vehicle).find(Boolean);
  return {
    expense_date: pickDateTime(raw, ['Expense_Date', 'Request_Date']) || undefined,
    designation: pickString(raw, ['Designation', 'Requester_Designation']) || undefined,
    department: pickString(raw, ['Department']) || undefined,
    expense_by: pickString(raw, ['Expense_By']) || undefined,
    restaurant: pickString(raw, ['Restaurant_Name']) || undefined,
    from_city: pickString(raw, ['From_1']) || undefined,
    to_city: pickString(raw, ['To_1']) || undefined,
    travel_mode: pickString(raw, ['Travel_Mode_1', 'Travel_Mode']) || vehicle || undefined,
    vehicle_type: vehicle || undefined,
    have_advance: yesNoFromRaw(raw?.Have_Advance),
    l1_status: pickString(raw, ['L1_Manager_Status']) || undefined,
    raised_amount: pickFirstPositiveAmount(raw, EMS_RAISED_KEYS),
    claimed_amount: pickFirstPositiveAmount(raw, EMS_CLAIMED_KEYS),
    expense_splits: splits.length ? splits : undefined,
  };
}

const EMS_DETAIL_KEYS = [
  'expense_date', 'designation', 'department', 'expense_by', 'restaurant',
  'from_city', 'to_city', 'travel_mode', 'vehicle_type', 'have_advance', 'l1_status',
  'raised_amount', 'claimed_amount', 'expense_splits',
];

function pickTravelDays(raw) {
  for (const key of ['Number_of_Travel_days', 'No_of_Travel_days', 'Number_of_days']) {
    const n = Number(raw?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function pickLinkedTravelRequestId(raw, requestId) {
  const linked = pickString(raw, ['Travel_Request_ID']);
  if (!linked) return undefined;
  if (linked === requestId) return undefined;
  if (/^Pk[A-Za-z0-9_-]{8,}$/.test(linked)) return undefined;
  return linked;
}

function travelDetailFieldsFromRaw(raw, requestId) {
  const places = travelPlaceFieldsFromRaw(raw);
  return {
    ...places,
    purpose: pickString(raw, ['Purpose_of_Travel', 'Purpose']) || undefined,
    travel_mode: pickString(raw, ['Travel_Mode', 'Travel_Mode_1']) || undefined,
    return_date: pickDateTime(raw, ['To_Date', 'Common_to_date', 'FS_Return_Departure_Date']) || undefined,
    travel_days: pickTravelDays(raw),
    linked_request_id: pickLinkedTravelRequestId(raw, requestId),
    advance_claim_status: pickString(raw, ['Travel_Advance_Claim_Status']) || undefined,
    expense_type: pickTravelExpenseType(raw),
    expense_date: pickDateTime(raw, ['Expense_Date', 'Date_of_Travel', 'Date_of_Travel_1', 'Common_date_date']) || undefined,
    airline: pickString(raw, ['FS_Airline_Name']) || undefined,
    flight_number: pickString(raw, ['FS_Flight_Number']) || undefined,
    designation: pickString(raw, ['Designation', 'Employee_designation', 'Requester_Designation']) || undefined,
    remarks: pickString(raw, ['Remarks']) || undefined,
    payment_status: pickString(raw, ['Payment_Status_1', 'Payement_Type']) || undefined,
    raised_amount: pickFirstPositiveAmount(raw, EMS_RAISED_KEYS),
    claimed_amount: pickFirstPositiveAmount(raw, EMS_CLAIMED_KEYS),
  };
}

const TRAVEL_DETAIL_KEYS = [
  'trip_type', 'from_city', 'to_city', 'departure_date', 'purpose', 'travel_mode',
  'return_date', 'travel_days', 'linked_request_id', 'advance_claim_status',
  'expense_type', 'expense_date', 'airline', 'flight_number', 'designation',
  'remarks', 'payment_status', 'raised_amount', 'claimed_amount',
];

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

function statusBucketSql(itsm, lead = false) {
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
      WHEN ${lead ? 'true' : 'false'}
        AND lower(trim(coalesce(i.source_payload->>'Lead_Status', ''))) IN ('close', 'closed', 'completed', 'done')
        THEN 'closed'
      WHEN ${lead ? 'true' : 'false'}
        AND lower(trim(coalesce(i.source_payload->>'Lead_Status', ''))) = 'open'
        THEN 'open'
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
    website: it.website || it.website_name,
    current_step: it.current_step,
    process_id: it.process_id,
    project_id: it.project_id || it.project_key || undefined,
    project_key: it.project_key || it.project_id || undefined,
    created_at: it.created_at,
    closed_at: it.closed_at || it.completed_at || null,
    amount: it.amount,
    trip_type: it.trip_type || undefined,
    from_city: it.from_city || undefined,
    to_city: it.to_city || undefined,
    departure_date: it.departure_date || undefined,
    purpose: it.purpose || undefined,
    travel_mode: it.travel_mode || undefined,
    return_date: it.return_date || undefined,
    travel_days: it.travel_days || undefined,
    linked_request_id: it.linked_request_id || undefined,
    advance_claim_status: it.advance_claim_status || undefined,
    expense_date: it.expense_date || undefined,
    airline: it.airline || undefined,
    flight_number: it.flight_number || undefined,
    designation: it.designation || undefined,
    remarks: it.remarks || undefined,
    payment_status: it.payment_status || undefined,
    department: it.department || undefined,
    expense_by: it.expense_by || undefined,
    restaurant: it.restaurant || undefined,
    vehicle_type: it.vehicle_type || undefined,
    raised_amount: it.raised_amount,
    claimed_amount: it.claimed_amount,
    expense_splits: Array.isArray(it.expense_splits) && it.expense_splits.length ? it.expense_splits : undefined,
    have_advance: it.have_advance || undefined,
    l1_status: it.l1_status || undefined,
    source: it.source || it.source_channel || (it.source_text ? classifyTicketSource(String(it.source_text)) : undefined),
    source_channel: it.source || it.source_channel || (it.source_text ? classifyTicketSource(String(it.source_text)) : undefined),
    ticket_type: it.ticket_type || it.request_type || undefined,
    subject: itsm && it.summary ? it.summary : it.subject,
    description: cleanItsmDescription(it.description) || undefined,
    expected_at: it.expected_at || null,
    category: it.category || undefined,
    sub_category: it.sub_category || undefined,
    criticality: it.criticality || undefined,
    sla_breached: it.sla_breached,
    sla_minutes: it.sla_minutes,
    closure_minutes: it.closure_minutes,
    tat_minutes: it.tat_minutes,
    reopened_at: it.reopened_at || null,
    agent_closed_at: it.agent_closed_at || null,
    reopen_entered_at: it.reopen_entered_at || null,
    modified_at: it.modified_at || null,
    form_status: it.form_status || undefined,
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
function overlayTravelPlacesFromItems(records, items, applicationId) {
  const travel = isTravelApp(applicationId);
  const ems = isEmsApp(applicationId);
  if ((!travel && !ems) || !items?.length) return records || [];
  const byId = new Map();
  for (const raw of items) {
    const id = pickString(raw, ['_id', 'Id', 'id', 'Instance_ID']);
    if (id) byId.set(id, raw);
  }
  const keys = travel ? TRAVEL_DETAIL_KEYS : EMS_DETAIL_KEYS;
  return (records || []).map((rec) => {
    const raw = byId.get(String(rec.id || rec.instance_id || rec.request_id || ''));
    if (!raw) return rec;
    const details = travel
      ? travelDetailFieldsFromRaw(raw, rec.request_id)
      : emsDetailFieldsFromRaw(raw);
    const next = { ...rec };
    for (const key of keys) {
      if (key === 'expense_splits') {
        if (!Array.isArray(next[key]) || !next[key].length) next[key] = details[key];
        continue;
      }
      if (next[key] == null || next[key] === '') next[key] = details[key];
    }
    if (ems && (!next.expense_type || next.expense_type === '—')) {
      next.expense_type = pickTravelExpenseType(raw) || next.expense_type;
    }
    return next;
  });
}

/** Overlay workflow step + site name from snapshot details onto lean live-cache rows. */
async function overlaySolarWorkflowStepsFromDb(pool, environment, applicationId, records) {
  if (!isSolarApp(applicationId) || !records?.length) return records || [];
  const ids = [...new Set(records.map((row) => String(row.id || row.instance_id || row.request_id || '')).filter(Boolean))];
  if (!ids.length) return records;
  try {
    const latest = latestRunsCte({ environmentParam: '$1', applicationIdParam: '$2', alias: 'latest' });
    const { rows } = await pool.query(
      `WITH ${latest}
       SELECT
         i.instance_id,
         ${solarWorkflowStepSql('i')} AS workflow_step,
         ${solarSiteNameSql('i')} AS site_name
       FROM engagement_reporting.item i
       JOIN latest l
         ON i.snapshot_run_id = l.snapshot_run_id
        AND i.process_id = l.process_id
       WHERE i.instance_id = ANY($3::text[])`,
      [environment, applicationId, ids],
    );
    const byId = new Map();
    for (const row of rows || []) {
      const id = String(row.instance_id || '').trim();
      if (!id) continue;
      const step = String(row.workflow_step || '').trim();
      const site = String(row.site_name || '').trim();
      byId.set(id, {
        step: step && !isProcessStatusLabel(step) ? step : '',
        site,
      });
    }
    if (!byId.size) return records;
    return records.map((rec) => {
      const id = String(rec.id || rec.instance_id || rec.request_id || '');
      const hit = byId.get(id);
      if (!hit) {
        if (isProcessStatusLabel(rec.current_step)) return { ...rec, current_step: '' };
        return rec;
      }
      const next = { ...rec };
      if (hit.step) next.current_step = hit.step;
      else if (isProcessStatusLabel(next.current_step)) next.current_step = '';
      if (hit.site && (!next.subject || next.subject === '—' || next.subject === '-' || next.subject === next.current_step)) {
        next.subject = hit.site;
      }
      return next;
    });
  } catch {
    return records;
  }
}

async function overlayTravelDetailsFromDb(pool, environment, applicationId, records) {
  if ((!isTravelApp(applicationId) && !isEmsApp(applicationId)) || !records?.length) return records || [];
  const ids = [...new Set(records.map((row) => String(row.id || row.instance_id || '')).filter(Boolean))];
  if (!ids.length) return records;
  try {
    const latest = latestRunsCte({ environmentParam: '$1', applicationIdParam: '$2', alias: 'latest' });
    const { rows } = await pool.query(
      `WITH ${latest}
       SELECT i.instance_id, i.source_payload
       FROM engagement_reporting.item i
       JOIN latest l
         ON i.snapshot_run_id = l.snapshot_run_id
        AND i.process_id = l.process_id
       WHERE i.instance_id = ANY($3::text[])`,
      [environment, applicationId, ids],
    );
    const items = (rows || []).map((row) => ({
      _id: String(row.instance_id || ''),
      ...(row.source_payload && typeof row.source_payload === 'object' ? row.source_payload : {}),
    }));
    return overlayTravelPlacesFromItems(records, items, applicationId);
  } catch {
    return records;
  }
}

function overlayLeadWebsiteFromItems(records, items, applicationId) {
  if (!isLeadApp(applicationId) || !items?.length) return records || [];
  const byId = new Map();
  for (const raw of items) {
    const id = pickString(raw, ['_id', 'Id', 'id', 'Instance_ID']);
    if (id) byId.set(id, raw);
  }
  return (records || []).map((rec) => {
    const raw = byId.get(String(rec.id || rec.instance_id || rec.request_id || ''));
    if (!raw) return rec;
    const website = websiteFromRaw(raw);
    return {
      ...rec,
      website: website || rec.website || rec.website_name,
      website_name: website || rec.website_name || rec.website,
      status: statusBucketFromRaw(raw, applicationId) || rec.status,
    };
  });
}

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
      { id: 'request_id', label: 'Request ID' },
      { id: 'requested_by', label: 'Requester' },
      { id: 'assigned_to', label: 'Assigned To' },
      { id: 'sla', label: 'SLA' },
      { id: 'created_at', label: 'Created Date' },
      { id: 'status', label: 'Ticket Status' },
      { id: 'form_status', label: 'Stage' },
      { id: 'source', label: 'Source' },
      { id: 'ticket_type', label: 'Request Type' },
      { id: 'category', label: 'Category' },
      { id: 'sub_category', label: 'Sub Category' },
      { id: 'criticality', label: 'Criticality' },
      { id: 'closed_by', label: 'Closed By' },
      { id: 'closed_at', label: 'Closed Date' },
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
      { id: 'website', label: 'Website' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isEmsApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Exp ID' },
      { id: 'expense_type', label: 'Expense type' },
      { id: 'requested_by', label: 'Requestor' },
      { id: 'assigned_to', label: 'Assigned to' },
      { id: 'amount', label: 'Amount' },
      { id: 'current_step', label: 'Current step' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'expense_date', label: 'Expense date' },
      { id: 'created_at', label: 'Requested on' },
    ];
  }
  if (isSolarApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Req ID' },
      { id: 'expense_type', label: 'Expense type' },
      { id: 'subject', label: 'Site name' },
      { id: 'requested_by', label: 'Requester' },
      { id: 'current_step', label: 'Current step' },
      { id: 'status', label: 'Status' },
      { id: 'entity', label: 'Entity' },
      { id: 'company_name', label: 'Company name' },
      { id: 'created_at', label: 'Created' },
    ];
  }
  if (isTravelApp(applicationId)) {
    return [
      { id: 'request_id', label: 'Request ID' },
      { id: 'requested_by', label: 'Requestor' },
      { id: 'assigned_to', label: 'Assigned to' },
      { id: 'purpose', label: 'Purpose' },
      { id: 'company_name', label: 'Company name' },
      { id: 'amount', label: 'Booking amount' },
      { id: 'current_step', label: 'Current step' },
      { id: 'status', label: 'Status' },
      { id: 'process_id', label: 'Process' },
      { id: 'created_at', label: 'Created by' },
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
    raw.Statu,
    raw.Statu_1,
    raw.process_status,
    raw.Process_Status,
    raw._current_step,
    raw.current_step,
    raw.Step,
    raw.workflowStatus,
    raw.systemStatus,
    raw.Column_W1mzfPpAP3,
    normalizeProcessStatus(raw),
  ];
  return parts.some((p) => {
    const token = String(p || '').toLowerCase().trim();
    return token === 'draft' || token.includes('draft');
  });
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

function recordIdentity(row) {
  for (const key of ['instance_id', 'id', 'request_id']) {
    const value = String(row?.[key] || '').trim();
    if (!isEmptyDisplay(value)) return value;
  }
  return '';
}

function isMeaningfulRecord(row) {
  if (isDraftRow(row)) return false;
  return Boolean(recordIdentity(row));
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
  return extractItsmCloserMeta(raw).closed_by;
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
  const text = `NULLIF(trim(coalesce((${expr})->>'v', (${expr})->>'dv', (${expr}) #>> '{}')), '')`;
  return `CASE
    WHEN ${expr} IS NULL THEN NULL
    WHEN jsonb_typeof(${expr}) = 'number' AND (${expr})::text ~ '^[0-9]{12,}$' THEN to_timestamp((${expr})::numeric / 1000.0)
    WHEN jsonb_typeof(${expr}) = 'number' AND (${expr})::text ~ '^[0-9]{9,11}$' THEN to_timestamp((${expr})::numeric)
    WHEN ${text} IS NULL THEN NULL
    WHEN ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND ${text} ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN ${text}::timestamptz
    WHEN ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN ${text}::timestamp AT TIME ZONE 'Asia/Kolkata'
    WHEN ${text} ~ '^[0-9]{12,}$' THEN to_timestamp((${text})::numeric / 1000.0)
    WHEN ${text} ~ '^[0-9]{9,11}$' THEN to_timestamp((${text})::numeric)
    ELSE NULL
  END`;
}

function latestActedBySql() {
  return `(
    SELECT COALESCE(
      NULLIF(trim(obj->'ActedBy'->>'Name'), ''),
      NULLIF(trim(obj->'actedBy'->>'Name'), ''),
      NULLIF(trim(obj->'Acted_By'->>'Name'), ''),
      NULLIF(trim(obj->'AssignedTo'->>'Name'), ''),
      NULLIF(trim(obj->'assignedTo'->>'Name'), '')
    )
    FROM (
      SELECT j.value AS obj
      FROM jsonb_path_query(
        i.source_payload,
        '$.** ? ((exists(@.ActedAt) || exists(@.actedAt)) && (exists(@.ActedBy) || exists(@.actedBy) || exists(@.Acted_By) || exists(@.AssignedTo)))'
      ) AS j(value)
    ) acted
    WHERE COALESCE(
      NULLIF(trim(obj->'ActedBy'->>'Name'), ''),
      NULLIF(trim(obj->'actedBy'->>'Name'), ''),
      NULLIF(trim(obj->'Acted_By'->>'Name'), ''),
      NULLIF(trim(obj->'AssignedTo'->>'Name'), ''),
      NULLIF(trim(obj->'assignedTo'->>'Name'), '')
    ) IS NOT NULL
    ORDER BY COALESCE(
      ${kissflowTsSql("obj->'ActedAt'")},
      ${kissflowTsSql("obj->'actedAt'")}
    ) DESC NULLS LAST
    LIMIT 1
  )`;
}

function payloadNumericSql(keys) {
  const parts = [];
  for (const key of keys) {
    const safe = sqlLiteral(key);
    const candidates = [
      `i.source_payload->>'${safe}'`,
      `i.source_payload->'${safe}'->>'v'`,
      `i.source_payload->'${safe}'->>'value'`,
      `i.source_payload->'${safe}'->>'${safe}'`,
      `i.source_payload->'${safe}'->>'Minutes'`,
      `i.source_payload->'${safe}'->>'minutes'`,
    ];
    for (const expr of candidates) {
      const raw = `NULLIF(trim(${expr}), '')`;
      parts.push(`CASE WHEN ${raw} ~ '^[0-9]+([.][0-9]+)?$' THEN ${raw} ELSE NULL END`);
    }
  }
  return `COALESCE(${parts.join(', ')})`;
}

function payloadTsSql(keys) {
  return `COALESCE(${keys.map((key) => kissflowTsSql(`i.source_payload->'${sqlLiteral(key)}'`)).join(',\n      ')})`;
}

function nestedMaxTsSql(keys) {
  const unions = (keys || []).map((key) => {
    const safe = sqlLiteral(key);
    return `SELECT ${kissflowTsSql('j.value')} AS ts
      FROM jsonb_path_query(i.source_payload, '$.**."${safe}"') AS j(value)`;
  });
  if (!unions.length) return 'NULL';
  return `(SELECT max(ts) FROM (${unions.join(' UNION ALL ')}) nested_ts)`;
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

function humanCloserName(value) {
  const name = normalizeItsmPersonLabel(personNameFromRaw(value));
  if (!name || name === '—' || isItsmNonHumanActor(name)) return '';
  return name;
}

function itsmStepEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object') {
    if (value.ActedBy || value.actedBy || value.Acted_By || value.AssignedTo || value.ActedAt || value.Status) {
      return [value];
    }
    const nested = value.Items || value.items || value.Data || value.data;
    if (Array.isArray(nested)) return nested.filter(Boolean);
  }
  return [];
}

function isTerminalStepStatus(status) {
  const token = String(status || '').toLowerCase().replace(/[\s_-]+/g, '');
  return token === 'completed' || token === 'complete' || token === 'cancelled'
    || token === 'canceled' || token === 'resolved' || token === 'closed';
}

function pickSolverFromEntries(entries) {
  for (const entry of entries || []) {
    const name = humanCloserName(entry?.ActedBy ?? entry?.actedBy ?? entry?.Acted_By)
      || humanCloserName(entry?.AssignedTo ?? entry?.assignedTo ?? entry?.Assignee);
    if (!name || !isTerminalStepStatus(entry?.Status ?? entry?.status ?? entry?._status)) continue;
    return {
      name,
      actedAt: coerceKissflowDate(entry?.ActedAt ?? entry?.actedAt ?? entry?.CompletedAt)
        || coerceKissflowDate(entry?.Column__LGAMX8kf0)
        || coerceKissflowDate(entry?.Column_R_u4Nyl5q_),
    };
  }
  for (let idx = (entries || []).length - 1; idx >= 0; idx -= 1) {
    const entry = entries[idx];
    const name = humanCloserName(entry?.ActedBy ?? entry?.actedBy ?? entry?.Acted_By)
      || humanCloserName(entry?.AssignedTo ?? entry?.assignedTo ?? entry?.Assignee);
    if (!name) continue;
    return {
      name,
      actedAt: coerceKissflowDate(entry?.ActedAt ?? entry?.actedAt ?? entry?.CompletedAt)
        || coerceKissflowDate(entry?.Column__LGAMX8kf0)
        || coerceKissflowDate(entry?.Column_R_u4Nyl5q_),
    };
  }
  return { name: '', actedAt: null };
}

function pickSolverFromKeys(raw, keys) {
  for (const key of keys) {
    if (!raw || raw[key] == null) continue;
    const found = pickSolverFromEntries(itsmStepEntries(raw[key]));
    if (found.name) return found;
  }
  return { name: '', actedAt: null };
}

/** Head IT Agent / My Team solver columns — Solution / Tech Support before PickUp pool. */
const ITSM_SOLVER_STEP_KEYS = [
  'IT Tech Support',
  'IT Agent Solution',
  'IT Tech Support After Dependency',
  'IT Agent Solution After Dependency',
  'Column_M6Lo8-DcO7',
  'Column_PdcW660jHk',
  'Column_tW6JKl_LzQ',
  'Column_GalsKhjIfg',
  'Column_0XG6fyWN7c',
  'Column_JliIS4CsP9',
  'IT__Agent_Solution',
  'It_Agent_Solution',
  'Column_KaubOsozAz',
  'Column_qr_9gP_vE5',
];

const ITSM_PICKUP_STEP_KEYS = [
  'IT Tech',
  'IT Tech Pickup',
  'IT Agent Pickup',
  'Column_LVQSPzDsbD',
  'Column_9gnIPdxah5',
  'Column_7WajlrHQ7C',
];

function walkNamedSolverKeys(raw) {
  if (!raw || typeof raw !== 'object') return { name: '', actedAt: null };
  for (const [key, val] of Object.entries(raw)) {
    const token = String(key).toLowerCase();
    if (/reopen|feedback|approval|manager|head|l1|l2|pickup|pick up/.test(token)) continue;
    if (!/tech support|agent solution|after dependency|it__agent|it_agent/.test(token)) continue;
    const found = pickSolverFromEntries(itsmStepEntries(val));
    if (found.name) return found;
  }
  return { name: '', actedAt: null };
}

/**
 * Head My Team / IT Agent Closed By + Closed Date from a Kissflow item payload.
 * ActedBy may be `{Name}` or `[{Name}]` — SQL jsonb ->>'Name' misses the array form.
 */
const ITSM_REOPEN_STEP_KEYS = [
  'IT Tech Reopen',
  'Ticket Reopen',
  'ReOpen Window',
  'Employee Feedback',
  'Column_yjgVKIjsC3',
  'Column_pCWmiiKhh4',
  'Column_9edMpjzOjb',
  'Activity_Ot8GrzZvSl',
  'Activity_7rCa3_zSic',
];

function isItsmReopenHoldStepName(name) {
  const token = String(name || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (!token || token.includes('reopened')) return false;
  return (
    token.includes('it tech reopen')
    || token.includes('ticket reopen')
    || token.includes('reopen window')
    || token.includes('employee feedback')
  );
}

function pickActedAtFromEntries(entries) {
  let inProgress = null;
  let latest = null;
  let latestMs = 0;
  for (const entry of entries || []) {
    const at = coerceKissflowDate(entry?.ActedAt ?? entry?.actedAt ?? entry?.CompletedAt);
    if (!at) continue;
    const status = String(entry?.Status ?? entry?.status ?? '').toLowerCase();
    if (status === 'inprogress' || status === 'pending' || status === 'assigned') inProgress = at;
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && ms >= latestMs) {
      latestMs = ms;
      latest = at;
    }
  }
  return inProgress || latest;
}

/** When the ticket moved onto Ticket Reopen / IT Tech Reopen / ReOpen Window. */
function extractItsmReopenEnteredAt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of ITSM_REOPEN_STEP_KEYS) {
    if (raw[key] == null) continue;
    const at = pickActedAtFromEntries(itsmStepEntries(raw[key]));
    if (at) return at;
  }
  for (const [key, val] of Object.entries(raw)) {
    if (!isItsmReopenHoldStepName(key)) continue;
    const at = pickActedAtFromEntries(itsmStepEntries(val));
    if (at) return at;
  }
  return null;
}

function extractItsmCloserMeta(raw) {
  if (!raw || typeof raw !== 'object') {
    return { closed_by: '', modified_at: null, agent_closed_at: null, completed_at: null, reopen_entered_at: null };
  }
  const fromSolver = pickSolverFromKeys(raw, ITSM_SOLVER_STEP_KEYS);
  const fromNamed = fromSolver.name ? fromSolver : walkNamedSolverKeys(raw);
  const fromPickup = fromNamed.name ? fromNamed : pickSolverFromKeys(raw, ITSM_PICKUP_STEP_KEYS);
  const solver = fromNamed.name ? fromNamed : fromPickup;
  const closedBy = solver.name
    || humanCloserName(raw.Closed_By || raw.ClosedBy || raw.Resolved_By || raw.Completed_By || raw.Closed_by)
    || humanCloserName(raw._modified_by || raw.Modified_By)
    || (isItsmBusinessClosed(raw)
      ? humanCloserName(raw._current_assigned_to || raw.Assigned_To || raw.Assignee)
      : '');
  return {
    closed_by: closedBy,
    modified_at: pickDateTime(raw, ITSM_MODIFIED_DATE_KEYS),
    agent_closed_at: solver.actedAt || pickDateTime(raw, ITSM_AGENT_CLOSED_DATE_KEYS),
    completed_at: pickDateTime(raw, ITSM_CLOSED_DATE_KEYS),
    reopen_entered_at: extractItsmReopenEnteredAt(raw),
  };
}

let itsmReportCloserCache = { at: 0, environment: '', map: null };

async function fetchKissflowReportItems(environment, processId, reportId, credentials) {
  const account = credentials.accountId;
  const all = [];
  for (let page = 1; page <= 30; page += 1) {
    const urlPath = `/process-report/2/${encodeURIComponent(account)}/${encodeURIComponent(processId)}/${encodeURIComponent(reportId)}?page_number=${page}&page_size=200&_application_id=${encodeURIComponent(ITSM_APP_ID)}`;
    const { data } = await kissflowGetUrl({ environment, urlPath, credentials });
    const batch = extractArray(data);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all;
}

function extractItsmStageFromPayload(raw) {
  if (!raw || typeof raw !== 'object') return '';
  for (const key of ITSM_FORM_STATUS_KEYS) {
    const value = pickString(raw, [key]);
    if (!value || /^(yes|no)$/i.test(value)) continue;
    return value;
  }
  return '';
}

function closerExtraFromRaw(raw) {
  const meta = extractItsmCloserMeta(raw);
  return {
    closed_by: meta.closed_by || undefined,
    modified_at: meta.modified_at || null,
    agent_closed_at: meta.agent_closed_at || null,
    reopen_entered_at: meta.reopen_entered_at || null,
    completed_at: meta.completed_at || null,
    closed_at: meta.completed_at || null,
    form_status: extractItsmStageFromPayload(raw) || undefined,
  };
}

function indexItsmCloserExtra(map, raw, extra) {
  const keys = [
    raw?._id,
    raw?.instance_id,
    raw?._request_number,
    raw?.Request_ID,
    raw?.Request_Id,
    raw?.Ticket_ID,
    pickString(raw || {}, ['Column_0jda6rzCc3', 'Column_rPLlKkQoX4']),
  ];
  for (const key of keys) {
    if (key) map.set(String(key), extra);
  }
}

/** Head My Team source: Refex + Extrovis process reports (ActedBy / _modified_at). */
async function loadItsmReportCloserById(environment) {
  const env = String(environment || 'production');
  if (
    itsmReportCloserCache.map
    && itsmReportCloserCache.environment === env
    && (Date.now() - itsmReportCloserCache.at) < ITSM_REPORT_CLOSER_TTL_MS
  ) {
    return itsmReportCloserCache.map;
  }
  const credentials = await resolveKissflowCredentials(env);
  const [refex, extrovis] = await Promise.all([
    fetchKissflowReportItems(env, ITSM_REFEX_PROCESS_ID, ITSM_REFEX_REPORT_ID, credentials),
    fetchKissflowReportItems(env, ITSM_EXTROVIS_PROCESS_ID, ITSM_EXTROVIS_REPORT_ID, credentials),
  ]);
  const map = new Map();
  for (const raw of [...refex, ...extrovis]) {
    indexItsmCloserExtra(map, raw, closerExtraFromRaw(raw));
  }
  itsmReportCloserCache = { at: Date.now(), environment: env, map };
  return map;
}

function statusBucketFromRaw(raw, applicationId) {
  if (isDraftRaw(raw)) return 'draft';
  const itsm = isItsmApp(applicationId);
  const lead = isLeadApp(applicationId);
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
  if (lead) {
    return isLeadBusinessClosed(raw) ? 'closed' : 'open';
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
    const closer = itsm ? extractItsmCloserMeta(raw) : {};
    const closedAt = pickDateTime(raw, [
      '_completed_at',
      '_closed_at',
      'Completed_On',
      'Closed_On',
      'Completed_Date',
      'Closed_Date',
    ]) || closer.completed_at || null;
    const assignedName = assigneeMeta.assigned_name || '';
    const assignedHuman = assignedName && !isItsmNonHumanActor(assignedName) ? assignedName : '';
    const assigned = itsm
      ? (assignedHuman || closer.closed_by || assignedName || '—')
      : lead
        ? (assignedName || leadOwner || '—')
        : (assignedName || personNameFromRaw(raw?._created_by) || '—');
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
    const requestId = (
      pm
        ? (isTask
          ? pickString(raw, ['Task_ID_Formulated', 'Task_ID', 'Sub_Task_ID', 'Task_Id', '_request_number', 'Request_ID', '_id'])
          : pickString(raw, ['Project_ID_Formulated', 'Project_ID', 'Project_Id', '_request_number', 'Request_ID', '_id']))
        : travel
          ? pickString(raw, ['Request_ID', 'Request_Id', 'Request_Number', 'Travel_Request_ID', 'Travel_Request_ID_1', 'Advance_Request_ID', 'Request_No', '_request_number'])
          : lead
            ? pickString(raw, ['Lead_ID', 'Lead_Id', 'Lead_Number', '_request_number', '_id'])
            : solar
              ? pickString(raw, [
                'Request_ID',
                'Req_ID',
                'Reimbursement_ID',
                'Claim_ID',
                'Expense_ID',
                '_request_number',
                'Request_Number',
                'Request_Id',
                '_id',
              ])
              : ems
                ? pickString(raw, ['Expense_ID', 'Exp_ID', 'Expense_Id', '_request_number', 'Request_ID'])
                : pickString(raw, ['_request_number', 'Request_Number', 'Request_ID', 'Request_Id', 'Ticket_ID', 'Ticket_Number'])
    ) || String(raw?._id || '') || '—';
    const created =
      (typeof raw?._created_at === 'string' && raw._created_at)
      || (raw?._created_at?.v)
      || null;
    const travelDetails = travel ? travelDetailFieldsFromRaw(raw, requestId) : {};
    const emsDetails = ems ? emsDetailFieldsFromRaw(raw) : {};
    const expenseType = solar
      ? (pickString(raw, ['Expense_Type', 'Expense_Type_1', 'Expense_Category', 'Category', 'Service_Category']) || '—')
      : ems
        ? (pickTravelExpenseType(raw) || pickString(raw, ['Expense_Type', 'Expense_Category', 'Category']) || '—')
      : travel
        ? travelDetails.expense_type
        : undefined;
    const tripType = travelDetails.trip_type;
    const fromCity = travelDetails.from_city || emsDetails.from_city;
    const toCity = travelDetails.to_city || emsDetails.to_city;
    const departureDate = travelDetails.departure_date || null;
    const subject = solar
      ? (solarSiteNameFromRaw(raw) || pickString(raw, ['Selected_Site_ID', 'Site_Name', 'Site', 'Location', 'Site_Location']) || '—')
      : travel
        ? (pickString(raw, ['Purpose_of_Travel', 'Purpose', 'Title', 'Travel_Title', 'Request_Title', 'Subject', 'Summary', 'Name']) || travelProcessTitle(processId))
        : pm
          ? (isTask
            ? pickString(raw, ['Task_Name', 'Task_Title', 'Sub_Task_Name', 'Subject', 'Title'])
            : pickString(raw, ['Project_Name', 'Project_Title', 'Subject', 'Title']))
          : lead
            ? (pickString(raw, ['Lead_Name', 'Name', 'Contact_Name', 'Company_Name', 'Subject']) || '—')
            : ems
              ? (pickString(raw, ['Title', 'Subject', 'Expense_Title', 'Name', 'Description']) || '—')
              : itsm
                ? (pickString(raw, ITSM_SUMMARY_KEYS) || pickCurrentStep(raw) || processId || '—')
                : (pickString(raw, ['Subject', 'Title', 'Summary', 'Description']) || pickCurrentStep(raw) || processId || '—');
    const closedBy = itsm ? (closer.closed_by || undefined) : undefined;
    const entityText = entityTextFromRaw(raw);
    const companyText = companyTextFromRaw(raw, applicationId);
    const solarEntityDisplay = solar
      ? (
        entityText
        || companyText
        || pickString(raw, ['Legal_Entity', 'Legal_Entity_Name', 'Organisation', 'Organization', 'Plant', 'Plant_Name', 'Business_Unit'])
        || ''
      )
      : '';
    const website = lead
      ? (websiteFromRaw(raw) || (pidLower.includes('vindview') ? 'Venwind' : ''))
      : '';
    const companyKey = itsm
      ? (resolveCompanyIdFromText(companyText) || null)
      : (
        resolveCompanyIdFromText(companyText)
        || resolveCompanyIdFromText(entityText)
        || resolveCompanyIdFromText(entityKey)
        || null
      );
    const entityDisplay =
      (solar ? solarEntityDisplay : entityText)
      || (itsm ? '' : (companyText && !isEntityBucketLabel(companyText) ? companyText : ''))
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
      website: website || undefined,
      website_name: website || undefined,
      current_step: (solar ? pickSolarStep(raw, pickCurrentStep(raw)) : pickCurrentStep(raw))
        || (solar ? '' : String(raw?._status || '')),
      created_at: created,
      amount: (travel || ems) ? pickAmountFromRaw(raw) : undefined,
      trip_type: tripType,
      from_city: fromCity,
      to_city: toCity,
      departure_date: departureDate || undefined,
      purpose: travelDetails.purpose,
      return_date: travelDetails.return_date,
      travel_days: travelDetails.travel_days,
      linked_request_id: travelDetails.linked_request_id,
      advance_claim_status: travelDetails.advance_claim_status,
      expense_date: travelDetails.expense_date || emsDetails.expense_date,
      airline: travelDetails.airline,
      flight_number: travelDetails.flight_number,
      designation: travelDetails.designation || emsDetails.designation,
      department: emsDetails.department,
      expense_by: emsDetails.expense_by,
      restaurant: emsDetails.restaurant,
      vehicle_type: emsDetails.vehicle_type,
      raised_amount: travelDetails.raised_amount || emsDetails.raised_amount,
      claimed_amount: travelDetails.claimed_amount || emsDetails.claimed_amount,
      expense_splits: emsDetails.expense_splits,
      have_advance: emsDetails.have_advance,
      l1_status: emsDetails.l1_status,
      remarks: travelDetails.remarks,
      payment_status: travelDetails.payment_status,
      travel_mode: travelDetails.travel_mode || emsDetails.travel_mode,
      closed_at: closedAt,
      modified_at: pickDateTime(raw, ['_modified_at', 'Modified_At']) || closer.modified_at || null,
      agent_closed_at: closer.agent_closed_at || null,
      reopen_entered_at: closer.reopen_entered_at || null,
      project_id: projectKey,
      project_key: projectKey,
      source: itsm ? classifyTicketSource(raw) : undefined,
      ticket_type: itsm ? (pickString(raw, ITSM_TICKET_TYPE_KEYS) || undefined) : undefined,
      description: itsm ? (cleanItsmDescription(pickString(raw, ITSM_DESCRIPTION_KEYS)) || undefined) : undefined,
      expected_at: itsm ? (pickDateTime(raw, ITSM_EXPECTED_AT_KEYS) || null) : null,
      category: itsm ? (pickString(raw, ITSM_CATEGORY_KEYS) || undefined) : undefined,
      sub_category: itsm ? (pickString(raw, ITSM_SUB_CATEGORY_KEYS) || undefined) : undefined,
      criticality: itsm ? (pickString(raw, ITSM_CRITICALITY_KEYS) || undefined) : undefined,
      sla_breached: itsm ? (pickString(raw, ITSM_SLA_BREACHED_KEYS) || undefined) : undefined,
      sla_minutes: itsm ? (pickString(raw, ITSM_SLA_MINUTES_KEYS) || undefined) : undefined,
      closure_minutes: itsm ? (pickString(raw, ITSM_CLOSURE_MINUTES_KEYS) || undefined) : undefined,
      tat_minutes: itsm ? (pickString(raw, ITSM_TAT_MINUTES_KEYS) || undefined) : undefined,
      form_status: itsm ? (extractItsmStageFromPayload(raw) || undefined) : undefined,
      reopened_at: itsm ? (pickDateTime(raw, ['Reopened_On', 'Reopened_Date', 'ReopenedOn']) || null) : null,
      source_channel: itsm ? classifyTicketSource(raw) : undefined,
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

    // Landing / filter reads stay on incremental cache (or snapshot). Kissflow
    // Get-all-items only when the client explicitly asks force_live.
    if (forceLive) {
      try {
        const { fetchLiveAppMetrics } = require('./kissflowLiveMetrics');
        await fetchLiveAppMetrics(environment, applicationId, { persistCache: true });
        cache = await loadApplicationEngagementCache(pool, environment, applicationId);
      } catch {
        /* keep existing cache / fall through to snapshot */
      }
    }

    const cacheUsable =
      shouldPreferEngagementCache(cache, { snapshotAt, applicationId })
      || (!forceLive && hasUsableEngagementRecords(cache));
    const leadWebsiteReady = !isLeadApp(applicationId)
      || (cache.records || []).some((row) => String(row.website || row.website_name || '').trim());

    if (cacheUsable && leadWebsiteReady) {
      let all = enrichRecordsWithAssigneeCompany(
        overlayTravelPlacesFromItems(
          overlayLeadWebsiteFromItems(
            dedupeRecords(cache.records.filter((row) => !isDraftRow(row))),
            cache.items || [],
            applicationId,
          ),
          cache.items || [],
          applicationId,
        ),
        cache.items || [],
        { skipAssigneeStamp: itsm },
      );
      all = await overlayTravelDetailsFromDb(pool, environment, applicationId, all);
      all = await overlaySolarWorkflowStepsFromDb(pool, environment, applicationId, all);
      if (inventory && itsm) {
        try {
          const extras = await loadItsmMisExtrasById(pool, environment, applicationId);
          all = applyItsmMisExtras(all, extras);
        } catch {
          /* keep cache rows — extras overlay is display-only */
        }
        // Kissflow process-report closer is dozens of HTTP pages. Never block landing /
        // filter inventory on it — only Refresh (force_live) may overlay it.
        if (forceLive) {
          try {
            const reportExtras = await loadItsmReportCloserById(environment);
            all = applyItsmMisExtras(all, reportExtras);
          } catch {
            /* report overlay is display-only — keep snapshot/cache rows */
          }
        }
      }
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
            show_entity: true,
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
          show_entity: true,
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

  const lead = isLeadApp(applicationId);
  const travel = isTravelApp(applicationId);
  const ems = isEmsApp(applicationId);
  const solar = isSolarApp(applicationId);
  const payloadColSql = (travel || ems) ? 'i.source_payload AS source_payload,' : '';
  const payloadSelectSql = (travel || ems) ? 'c.source_payload,' : '';
  const statusSql = statusBucketSql(itsm, lead);
  const entitySql = entityKeySql(applicationId);

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
    ${payloadColSql}
    (${statusSql}) AS status_bucket,
    (${entitySql}) AS entity_key,
    COALESCE(
      NULLIF(trim(i.source_payload->>'Entity'), ''),
      NULLIF(trim(i.source_payload->'Entity'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Company'), ''),
      NULLIF(trim(i.source_payload->'Company'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Legal_Entity'), ''),
      NULLIF(trim(i.source_payload->'Legal_Entity'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Organisation'), ''),
      NULLIF(trim(i.source_payload->>'Organization'), ''),
      NULLIF(trim(i.entity), '')
    ) AS entity_raw,
    (${itsmLookupCompanySql()}) AS company_raw,
    NULLIF(trim(i.source_payload->>'Website_and_form'), '') AS website_raw,
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
    ${itsm
    ? `COALESCE(
      (${payloadFieldSql(ITSM_SUMMARY_KEYS)}),
      NULLIF(trim(i.current_step), ''),
      i.process_id
    )`
    : solar
      ? `COALESCE(${solarSiteNameSql('i')}, NULLIF(trim(i.source_payload->>'Selected_Site_ID'), ''))`
    : `COALESCE(
      NULLIF(trim(i.source_payload->>'Subject'), ''),
      NULLIF(trim(i.source_payload->>'Title'), ''),
      NULLIF(trim(i.source_payload->>'Summary'), ''),
      NULLIF(trim(i.source_payload->>'Description'), ''),
      NULLIF(trim(i.current_step), ''),
      i.process_id
    )`} AS subject,
    ${solar
      ? solarWorkflowStepSql('i')
      : `COALESCE(
      CASE
        WHEN jsonb_typeof(i.source_payload->'_current_step') = 'object'
          THEN NULLIF(trim(i.source_payload->'_current_step'->>'Name'), '')
        ELSE NULLIF(trim(i.source_payload->>'_current_step'), '')
      END,
      NULLIF(trim(i.source_payload->>'_activity_name'), ''),
      NULLIF(trim(i.current_step), ''),
      i.process_status
    )`} AS current_step,
    COALESCE(
      CASE
        WHEN jsonb_typeof(i.source_payload->'_created_at') = 'object'
          THEN NULLIF(trim(i.source_payload->'_created_at'->>'v'), '')::timestamptz
        ELSE NULLIF(trim(i.source_payload->>'_created_at'), '')::timestamptz
      END,
      i.snapshot_at
    ) AS created_at,
    (${closedAtSql}) AS closed_at,
    (${projectKeySql('i')}) AS project_key,
    COALESCE(
      NULLIF(trim(i.source_payload->>'Source'), ''),
      NULLIF(trim(i.source_payload->'Source'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Ticket_Source'), ''),
      NULLIF(trim(i.source_payload->'Ticket_Source'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Column_BDSZ_sAHys'), ''),
      NULLIF(trim(i.source_payload->'Column_BDSZ_sAHys'->>'Name'), ''),
      NULLIF(trim(i.source_payload->>'Column_hFjGV8lRrn'), ''),
      NULLIF(trim(i.source_payload->'Column_hFjGV8lRrn'->>'Name'), '')
    ) AS source_text,
    (${payloadFieldSql(ITSM_TICKET_TYPE_KEYS)}) AS ticket_type,
    (${payloadFieldSql(ITSM_SUMMARY_KEYS)}) AS summary,
    (${payloadFieldSql(ITSM_DESCRIPTION_KEYS)}) AS description,
    (${kissflowTsSql("i.source_payload->'ExpectedAt'")}) AS expected_at,
    (${payloadFieldSql(ITSM_CATEGORY_KEYS)}) AS category,
    (${payloadFieldSql(ITSM_SUB_CATEGORY_KEYS)}) AS sub_category,
    (${payloadFieldSql(ITSM_CRITICALITY_KEYS)}) AS criticality,
    (${payloadFieldSql(ITSM_SLA_BREACHED_KEYS)}) AS sla_breached,
    (${payloadFieldSql(ITSM_SLA_MINUTES_KEYS)}) AS sla_minutes,
    (${payloadFieldSql(ITSM_CLOSURE_MINUTES_KEYS)}) AS closure_minutes,
    (${payloadFieldSql(ITSM_TAT_MINUTES_KEYS)}) AS tat_minutes,
    (${payloadFieldSql(ITSM_FORM_STATUS_KEYS)}) AS form_status,
    COALESCE(
      ${kissflowTsSql("i.source_payload->'Reopened_On'")},
      ${kissflowTsSql("i.source_payload->'Reopened_Date'")},
      ${kissflowTsSql("i.source_payload->'ReopenedOn'")}
    ) AS reopened_at
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
        c.website_raw,
        c.created_at,
        c.closed_at,
        c.snapshot_at,
        c.project_key,
        c.source_text,
        c.ticket_type,
        c.summary,
        c.description,
        c.expected_at,
        c.category,
        c.sub_category,
        c.criticality,
        c.sla_breached,
        c.sla_minutes,
        c.closure_minutes,
        c.tat_minutes,
        ${payloadSelectSql}
        c.form_status,
        c.reopened_at
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
      show_entity: true,
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
        const website = String(it.website_raw || '').trim();
        const details = travel
          ? travelDetailFieldsFromRaw(it.source_payload || {}, it.request_id)
          : ems
            ? emsDetailFieldsFromRaw(it.source_payload || {})
            : {};
        const { source_payload: _payload, ...rest } = it;
        return serializeRecordItem({
          ...rest,
          ...details,
          id: String(it.instance_id || it.request_id),
          entity: entityDisplay,
          entity_key: entityKey,
          company: entityDisplay,
          company_key: companyKey,
          website: website || undefined,
          website_name: website || undefined,
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
  serializeRecordItem,
  travelPlaceFieldsFromRaw,
  travelDetailFieldsFromRaw,
  overlayTravelPlacesFromItems,
  emsDetailFieldsFromRaw,
  emsSplitsFromRaw,
  enrichRecordsWithAssigneeCompany,
  extractItsmCompanyNameFromRaw,
  extractItsmCloserMeta,
  applyItsmMisExtras,
  loadItsmReportCloserById,
  companyTextFromRaw,
  isItsmApp,
  isDraftRaw,
  isDraftSql,
  assigneeMetaFromRaw,
  isPmApp,
  buildPmPortfolioFromRecords,
  pickAmountFromRaw,
};
