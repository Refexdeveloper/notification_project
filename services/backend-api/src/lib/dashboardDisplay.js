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

/** Solar / expense category → Operation | Finance (non-Finance → Operation). */
function classifySolarCategory(payload, currentStep) {
  const raw = [
    currentStep,
    stringifyKfValue(payload?.Service_Category),
    stringifyKfValue(payload?.Expense_Type),
    stringifyKfValue(payload?.Category),
    stringifyKfValue(payload?.Department),
    stringifyKfValue(payload?.Cost_Center),
    stringifyKfValue(payload?.Request_Type),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    raw.includes('financ')
    || raw.includes('account')
    || raw.includes('treasury')
    || raw.includes('audit')
    || raw.includes('invoice')
  ) {
    return 'Finance';
  }
  // All other teams (including blank / site / technician) roll into Operations.
  return 'Operation';
}

const NON_HUMAN_NAME_RE =
  /^(it\s*helpdesk|help\s*desk|power\s*bi|system|bot|lead\s*bot|lead\s*tracker(\s*app)?|tracker\s*app|service\s*account|noreply|no-reply|sa-[\w-]+|kf[_-]|user[_-]?\d+$)/i;
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
    const text = String(candidate || '').trim();
    if (text && isDisplayablePersonName(text, userId)) return text;
  }
  return null;
}

function cleanMisUsers(users) {
  const seen = new Set();
  const out = [];
  for (const u of users || []) {
    const id = String(u.user_id || '').trim();
    const display = resolvePersonDisplayName(u.user_name, u.email, id);
    if (!display) continue;
    const key = `${display.toLowerCase()}|${String(u.email || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...u,
      user_name: display,
      open: Number(u.open ?? u.pending ?? 0),
      closed: Number(u.closed ?? u.completed ?? 0),
      rejected: Number(u.rejected || 0),
      pending: undefined,
      completed: undefined,
    });
  }
  return out;
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

module.exports = {
  SOURCE_FIELD_KEYS,
  pickSourceRaw,
  classifyTicketSource,
  classifySolarCategory,
  looksLikeKissflowUserId,
  isDisplayablePersonName,
  resolvePersonDisplayName,
  cleanMisUsers,
  filterDisplayablePeople,
  stringifyKfValue,
};
