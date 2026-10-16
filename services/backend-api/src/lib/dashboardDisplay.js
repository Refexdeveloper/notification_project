'use strict';

/**
 * Shared display helpers for dashboards (ITSM Source, Solar category, MIS name cleanup).
 */

const SOURCE_FIELD_KEYS = [
  'Source',
  'Ticket_Source',
  'Channel',
  // Report Column ids (Refex / Extrovis) — do NOT use Raised_By (person name).
  'Column_BDSZ_sAHys',
  'Column_hFjGV8lRrn',
  'Column_1XTRxinP7c',
  'Column_uSnNcJOfiS',
  'Column_nEM1x9oVe4',
  'Column_zugAS-mL2N',
  'Entity_Source',
];

function stringifyKfValue(val) {
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).trim();
  }
  if (Array.isArray(val)) {
    return val.map(stringifyKfValue).filter(Boolean).join(', ');
  }
  if (typeof val === 'object') {
    if (val.Name != null) return String(val.Name).trim();
    if (val.name != null) return String(val.name).trim();
    if (val.Value != null) return stringifyKfValue(val.Value);
    if (val.value != null) return stringifyKfValue(val.value);
    if (val.v != null) return stringifyKfValue(val.v);
    if (val.label != null) return String(val.label).trim();
    if (val.dv != null) return String(val.dv).trim();
  }
  return '';
}

function pickSourceRaw(payload) {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of SOURCE_FIELD_KEYS) {
    const text = stringifyKfValue(payload[key]);
    if (text) return text;
  }
  return '';
}

function classifyTicketSource(rawOrText) {
  const sourceRaw = typeof rawOrText === 'string' ? rawOrText : pickSourceRaw(rawOrText);
  const s = String(sourceRaw || '').toLowerCase().trim();
  if (!s) return 'Other';
  if (s.includes('whats')) return 'WhatsApp';
  if (s.includes('email') || s.includes('e-mail') || s.includes('e mail') || s === 'mail') return 'Email';
  if (s.includes('mobile') || s.includes('android') || s.includes('ios') || s.includes('phone') || s.includes('sms') || /\bapp\b/.test(s)) {
    return 'Mobile';
  }
  if (s.includes('web') || s.includes('portal') || s.includes('browser') || s.includes('desktop') || s.includes('kissflow')) {
    return 'Web';
  }
  return 'Other';
}

function normalizeSolarStep(step) {
  return String(step || '')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSolarStatusLabel(step) {
  const s = normalizeSolarStep(step);
  return (
    s === 'inprogress'
    || s === 'in progress'
    || s === 'completed'
    || s === 'rejected'
    || s === 'withdrawn'
    || s === 'closed'
    || s === 'open'
    || s === 'pending'
    || s === 'draft'
    || s === 'done'
  );
}

function looksLikeKissflowInstanceId(text) {
  const s = String(text || '').trim();
  return /^[A-Za-z]{2}[\w-]{6,}$/.test(s) && !/\s/.test(s);
}

function pickSolarContextStep(payload) {
  const ctx = payload?._current_context;
  const list = Array.isArray(ctx)
    ? ctx
    : ctx && typeof ctx === 'object'
      ? [ctx]
      : [];
  const usable = (entry) => {
    if (!entry || typeof entry !== 'object') return '';
    const step = stringifyKfValue(entry._context_current_step);
    if (!step || isSolarStatusLabel(step) || looksLikeKissflowInstanceId(step)) return '';
    return step;
  };
  const rejected = list.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const status = stringifyKfValue(entry._status).toLowerCase();
    return (status.includes('reject') || status.includes('withdraw')) && Boolean(usable(entry));
  });
  if (rejected) return usable(rejected);
  for (const entry of list) {
    const step = usable(entry);
    if (step) return step;
  }
  return '';
}

function pickSolarStep(payload, currentStep) {
  const candidates = [
    payload?._current_step,
    payload?.Current_Step,
    payload?._activity_name,
    pickSolarContextStep(payload),
    payload?.Step,
    currentStep,
    payload?.current_step,
  ];
  for (const candidate of candidates) {
    const text = stringifyKfValue(candidate);
    if (text && !isSolarStatusLabel(text) && !looksLikeKissflowInstanceId(text)) return text;
  }
  return '';
}

function isSolarOperationStep(step) {
  const s = normalizeSolarStep(step);
  if (!s || isSolarStatusLabel(s)) return false;
  return s === 'start' || s === 'ho review' || s === 'vp approval';
}

/**
 * BU Approval onward (Finance Processing → Completed).
 * Must stay in sync with apps/admin-ui/src/lib/solarCategory.ts
 * and engagement-pipeline count-solar-pack-kpis.js.
 */
function isSolarFinanceStep(step) {
  const s = normalizeSolarStep(step);
  if (!s || isSolarStatusLabel(s)) return false;
  return (
    s === 'bu approval'
    || s === 'bu approver'
    || /finance\s*process/.test(s)
    || s === 'completed'
    || s === 'complete'
    || /\bpayment\b/.test(s)
    || /disburs/.test(s)
    || /\bsettlement\b/.test(s)
    || /\bsettled\b/.test(s)
  );
}

function processLooksClosed(payload, statusHint) {
  const status = normalizeSolarStep(
    stringifyKfValue(statusHint)
    || stringifyKfValue(payload?._status)
    || stringifyKfValue(payload?.Status)
    || stringifyKfValue(payload?.process_status),
  );
  return status === 'completed' || status === 'complete' || status === 'closed' || status === 'done';
}

/**
 * Solar Operation vs Finance by workflow step (not department / cost center).
 * Start → HO Review → VP Approval = Operation.
 * BU Approval onward (Finance Processing → Completed) = Finance.
 */
function classifySolarCategory(payload, currentStep, statusHint) {
  const step = pickSolarStep(payload, currentStep);
  if (isSolarFinanceStep(step)) return 'Finance';
  if (isSolarOperationStep(step)) return 'Operation';
  if (processLooksClosed(payload, statusHint) && !isSolarOperationStep(step)) return 'Finance';
  return 'Operation';
}

function solarStatusBucket(row) {
  const status = String(row?.status || row?.status_bucket || '').toLowerCase();
  const raw = String(row?.status_raw || '').toLowerCase();
  if (status === 'rejected' || raw.includes('reject') || raw.includes('withdraw')) return 'rejected';
  if (status === 'closed' || status === 'completed' || raw === 'completed' || raw === 'closed') return 'closed';
  return 'open';
}

/** Operation Closed = reached BU Approval / Finance. Rejected uses last real step. */
function solarPackCountsFromRecords(records) {
  const operation = { open: 0, closed: 0, rejected: 0 };
  const finance = { open: 0, closed: 0, rejected: 0 };
  for (const row of records || []) {
    const cat = classifySolarCategory(row.source_payload || {}, row.current_step, row.status_raw || row.status || row.status_bucket);
    const bucket = solarStatusBucket(row);
    if (cat === 'Finance') finance[bucket] += 1;
    else if (bucket === 'rejected') operation.rejected += 1;
    else operation.open += 1;
  }
  operation.closed = finance.open + finance.closed + finance.rejected;
  return { operation, finance };
}

const NON_HUMAN_NAME_RE =
  /^(it\s*helpdesk|help\s*desk|power\s*bi|system|bot|lead\s*bot|lead\s*tracker(\s*app)?|tracker\s*app|service\s*account|noreply|no-reply|sa-[\w-]+|kf[_-]|user[_-]?\d+$)/i;

/** ITSM role labels from Kissflow → executive MIS names (Refex ITSM). */
const ITSM_PERSON_ALIASES = new Map([
  ['it manager', 'Sakthivel'],
  ['it manager refex', 'Sakthivel'],
  ['it manager approval', 'Sakthivel'],
  ['first approver - it manager', 'Sakthivel'],
  ['first approver it manager', 'Sakthivel'],
  ['it head', 'Mugesh'],
  ['it head refex', 'Mugesh'],
  ['it head approval', 'Mugesh'],
  ['final approver - it head', 'Mugesh'],
  ['final approver it head', 'Mugesh'],
  ['inactive', 'Deepan Duraisamy'],
]);

function normalizeItsmPersonLabel(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  const key = text.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return ITSM_PERSON_ALIASES.get(key) || text;
}
/** Kissflow internal ids: SA-DwZd_N8hF5, Us-xxxx, etc. */
const KISSFLOW_ID_RE = /^[A-Za-z]{2}-[\w-]{6,}$/;

function looksLikeKissflowUserId(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^sa-/i.test(s)) return true;
  if (/^kf[_-]/i.test(s)) return true;
  // Two-letter prefix + hyphen + opaque token (SA-DwZd_N8hF5, Us-AbCdEfGh)
  if (/^[A-Za-z]{2}-[\w-]{6,}$/.test(s)) return true;
  return false;
}

function isDisplayablePersonName(name, userId) {
  const n = String(name || '').trim();
  const id = String(userId || '').trim();
  if (!n) return false;
  if (/^(unknown|n\/a|na|none|null|undefined|inactive)$/i.test(n)) return false;
  if (looksLikeKissflowUserId(n)) return false;
  if (n === id && looksLikeKissflowUserId(id)) return false;
  if (NON_HUMAN_NAME_RE.test(n)) return false;
  if (!/[A-Za-z]{2,}/.test(n)) return false;
  return true;
}

/**
 * Prefer real name, then email; never fall back to Kissflow SA-/Us- ids.
 * Returns null when nothing displayable exists (caller should drop the row).
 */
function resolvePersonDisplayName(name, email, userId) {
  for (const candidate of [name, email]) {
    const text = normalizeItsmPersonLabel(String(candidate || '').trim());
    if (text && isDisplayablePersonName(text, userId)) return text;
  }
  return null;
}

function compactMisName(name) {
  const parts = String(name || '').trim().toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (parts.length > 1 && parts[parts.length - 1].length === 1) parts.pop();
  return parts.join('');
}

/** Collapse porchezhiyan / porchezhiyan.m M / porchezhiyan M into one row. */
function normalizeMisPersonKey(name, email, userId) {
  const mail = String(email || '').trim().toLowerCase();
  if (mail.includes('@')) return `email:${mail}`;
  const compact = compactMisName(name);
  if (compact.length >= 3) return `name:${compact}`;
  const id = String(userId || '').trim().toLowerCase();
  if (id && !looksLikeKissflowUserId(id)) return `id:${id}`;
  return `raw:${String(name || id).toLowerCase()}`;
}

function cleanMisUsers(users) {
  const map = new Map();
  for (const u of users || []) {
    const id = String(u.user_id || '').trim();
    const display = resolvePersonDisplayName(u.user_name, u.email, id);
    if (!display) continue;
    const key = normalizeMisPersonKey(display, u.email, id);
    const open = Number(u.open ?? u.pending ?? 0);
    const closed = Number(u.closed ?? u.completed ?? 0);
    const rejected = Number(u.rejected || 0);
    const hit = map.get(key);
    if (!hit) {
      map.set(key, {
        ...u,
        user_name: display,
        open,
        closed,
        rejected,
        total: open + closed + rejected,
        pending: undefined,
        completed: undefined,
      });
      continue;
    }
    hit.open += open;
    hit.closed += closed;
    hit.rejected += rejected;
    hit.total = hit.open + hit.closed + hit.rejected;
    if (display.length > String(hit.user_name || '').length) hit.user_name = display;
    if (u.email && !hit.email) hit.email = u.email;
    if (id && !looksLikeKissflowUserId(id) && looksLikeKissflowUserId(String(hit.user_id || ''))) {
      hit.user_id = id;
    }
    if (u.last_sign_in && (!hit.last_sign_in || new Date(u.last_sign_in) > new Date(hit.last_sign_in))) {
      hit.last_sign_in = u.last_sign_in;
    }
    if (hit.open + hit.closed > 0) {
      hit.closure_ratio = Math.round((hit.closed / (hit.open + hit.closed)) * 1000) / 10;
    }
  }
  return [...map.values()];
}

/** Drop / rename rows that only have Kissflow id display names (any user list shape). */
function filterDisplayablePeople(rows, nameKeys = ['user_name', 'name']) {
  const out = [];
  for (const row of rows || []) {
    const id = String(row.user_id || row.userId || '').trim();
    let rawName = '';
    for (const k of nameKeys) {
      if (row[k]) {
        rawName = row[k];
        break;
      }
    }
    const display = resolvePersonDisplayName(rawName, row.email, id);
    if (!display) continue;
    out.push({ ...row, user_name: display, name: display });
  }
  return out;
}

const ITSM_APP_ID = 'IT_Service_Management_A00';
const ITSM_DISPLAY_NAME = 'Tech Helpdesk';

/** Kissflow app id stays IT_Service_Management_A00; UI/email label is Tech Helpdesk. */
function friendlyApplicationName(applicationId, applicationName) {
  const id = String(applicationId || '').trim();
  const name = String(applicationName || '').trim();
  if (
    id === ITSM_APP_ID
    || /it[_-]?service[_-]?management/i.test(id)
    || /^it\s*service\s*management$/i.test(name)
  ) {
    return ITSM_DISPLAY_NAME;
  }
  return name || id;
}

module.exports = {
  SOURCE_FIELD_KEYS,
  pickSourceRaw,
  classifyTicketSource,
  classifySolarCategory,
  isSolarFinanceStep,
  isSolarOperationStep,
  isSolarStatusLabel,
  pickSolarStep,
  solarPackCountsFromRecords,
  looksLikeKissflowUserId,
  isDisplayablePersonName,
  resolvePersonDisplayName,
  normalizeItsmPersonLabel,
  cleanMisUsers,
  filterDisplayablePeople,
  stringifyKfValue,
  ITSM_APP_ID,
  ITSM_DISPLAY_NAME,
  friendlyApplicationName,
};
