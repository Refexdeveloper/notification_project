'use strict';

/**
 * Non-Refex Tech Helpdesk entities share Live_IT_Service_Request_Extrovis_A00.
 * Match Entity the same way aasik_ITSM normalizeEntityKey does (token includes).
 */

function entityToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function canonicalItsmEntityFilter(filter) {
  const token = entityToken(filter);
  if (!token || token === 'all' || token === '*') return '';
  if (token === 'refex') return 'refex';
  if (token.includes('extrovis')) return 'extrovis';
  if (token.includes('kavis')) return 'kavis';
  if (token.includes('modepro')) return 'modepro';
  if (token.includes('pharmapack') || (token.includes('pharma') && token.includes('pack'))) {
    return 'pharmapack';
  }
  return token;
}

/**
 * @param {string} entityRaw — Kissflow Entity column / payload value
 * @param {string} filter — schedule entity_filter (Extrovis | KavisPharma | ModePro | …)
 */
function itsmEntityMatchesFilter(entityRaw, filter) {
  const want = canonicalItsmEntityFilter(filter);
  if (!want) return true;
  const have = entityToken(entityRaw);
  if (want === 'refex') {
    return !have || have.includes('refex');
  }
  if (want === 'extrovis') return have.includes('extrovis');
  if (want === 'kavis') return have.includes('kavis');
  if (want === 'modepro') return have.includes('modepro');
  if (want === 'pharmapack') {
    return have.includes('pharmapack') || (have.includes('pharma') && have.includes('pack'));
  }
  return have === want || have.includes(want) || want.includes(have);
}

/** Canonical Entity labels for schedules / footers (Kissflow values). */
function canonicalItsmEntityLabel(filter) {
  const want = canonicalItsmEntityFilter(filter);
  if (want === 'extrovis') return 'Extrovis';
  if (want === 'kavis') return 'KavisPharma';
  if (want === 'modepro') return 'ModePro';
  if (want === 'pharmapack') return 'PharmaPack';
  if (want === 'refex') return 'Refex';
  return String(filter || '').trim();
}

/**
 * Email domain for Extrovis-family entity schedules.
 * Extrovis → @extrovis.com, ModePro → @modepro.com, KavisPharma → @kavispharma.com
 */
function itsmEntityEmailDomain(filter) {
  const want = canonicalItsmEntityFilter(filter);
  if (want === 'extrovis') return 'extrovis.com';
  if (want === 'kavis') return 'kavispharma.com';
  if (want === 'modepro') return 'modepro.com';
  return '';
}

function itsmUserEmailMatchesEntity(email, filter) {
  const domain = itsmEntityEmailDomain(filter);
  if (!domain) return true;
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return false;
  return e.slice(at + 1) === domain;
}

/**
 * All_tickets_A00 returns Extrovis values on Column_* ids, not FieldIds.
 * Same ids as aasik_ITSM EXTROVIS_SERVICE_COL / count-itsm-sla-kpis.js.
 * Native FieldIds win when the row already has them (admin item payload).
 */
const EXTROVIS_REPORT_FIELDS = {
  Entity: 'Column_KOIeT2FK23',
  _status: 'Column_ApNmcvK7J8',
  _current_step: 'Column_Yf9r2UCRuu',
  _created_at: 'Column_OuyTOsNWaK',
  _modified_at: 'Column_QpPzei51U2',
  Statu_1: 'Column_ps84EEKkEI',
  Status: 'Column_69zTtmtO92',
  Source: 'Column_hFjGV8lRrn',
};

function overlayExtrovisReportFields(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...raw };
  for (const [field, column] of Object.entries(EXTROVIS_REPORT_FIELDS)) {
    const current = out[field];
    const blank = current == null || (typeof current === 'string' && !current.trim());
    if (!blank) continue;
    const fromColumn = out[column];
    if (fromColumn == null || fromColumn === '') continue;
    out[field] = fromColumn;
  }
  return out;
}

module.exports = {
  entityToken,
  canonicalItsmEntityFilter,
  itsmEntityMatchesFilter,
  canonicalItsmEntityLabel,
  itsmEntityEmailDomain,
  itsmUserEmailMatchesEntity,
  overlayExtrovisReportFields,
};
