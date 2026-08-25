'use strict';

/**
 * ITSM ticket Source → Email / WhatsApp / Mobile / Web / Other.
 * Mirrors aasik_ITSM mapServiceSourceText field keys (Source + report Column_* ids).
 */

const SOURCE_FIELD_KEYS = [
  'Source',
  'Ticket_Source',
  'Channel',
  'Raised_By',
  'Entity_Source',
  // Refex All_tickets / process payload column id
  'Column_BDSZ_sAHys',
  // Extrovis All_tickets / process payload column id
  'Column_hFjGV8lRrn',
  // Related Raised_By / Entity_Source column ids (profiles)
  'Column_1XTRxinP7c',
  'Column_uSnNcJOfiS',
  'Column_nEM1x9oVe4',
  'Column_zugAS-mL2N',
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

function pickSourceRaw(raw) {
  if (!raw || typeof raw !== 'object') return '';
  for (const key of SOURCE_FIELD_KEYS) {
    const text = stringifyKfValue(raw[key]);
    if (text) return text;
  }
  return '';
}

function classifyTicketSource(rawOrText) {
  const sourceRaw =
    typeof rawOrText === 'string' ? rawOrText : pickSourceRaw(rawOrText);
  const s = String(sourceRaw || '')
    .toLowerCase()
    .trim();
  if (!s) return 'Other';
  if (s.includes('whats')) return 'WhatsApp';
  if (s.includes('email') || s.includes('e-mail') || s.includes('e mail') || s === 'mail') {
    return 'Email';
  }
  if (
    s.includes('mobile') ||
    s.includes('android') ||
    s.includes('ios') ||
    s.includes('phone') ||
    s.includes('sms') ||
    s.includes('app')
  ) {
    return 'Mobile';
  }
  if (
    s.includes('web') ||
    s.includes('portal') ||
    s.includes('browser') ||
    s.includes('desktop') ||
    s.includes('kissflow')
  ) {
    return 'Web';
  }
  return 'Other';
}

function emptySourceBuckets() {
  return { Email: 0, WhatsApp: 0, Mobile: 0, Web: 0, Other: 0 };
}

function bumpSource(buckets, channel) {
  const key = buckets[channel] != null ? channel : 'Other';
  buckets[key] += 1;
}

module.exports = {
  SOURCE_FIELD_KEYS,
  pickSourceRaw,
  classifyTicketSource,
  emptySourceBuckets,
  bumpSource,
  stringifyKfValue,
};
