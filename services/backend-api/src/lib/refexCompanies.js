'use strict';

/** Default ITSM company when user_details_lookup Company_Name is blank. */
const REFEX_DEFAULT_COMPANY_NAME = 'Refex Industries Limited';

const RAW_LABELS = [
  '3i Medical Equipment Manufacturing Private Limited',
  '3i Medical Technologies Private Limited',
  'AJ Office',
  'Adonis Medical Systems Private Limited',
  'Athenese Energy Private Limited',
  'Engender Developers Private Limited',
  'Refex Airports Retail Private Limited',
  'Refex Airports Retail Srinagar Private Limited',
  'Refex Capital Advisors LLP',
  'Refex Green Energy Limited',
  'Refex Green Mobility Limited',
  'Refex Green Power Limited',
  'Refex Holding Private Limited',
  'Refex Industries Limited',
  'Refex Life Sciences Private Limited',
  'Refex Renewables & Infrastructure Limited',
  'Refex Shared Services Private Limited',
  'Refex Sustainability Solutions Private Limited',
  'Refex EV Fleet Services Private Limited',
  'STPL Horticulture Private Limited',
  'Scorch Solar Energy Private Limited',
  'Sherisha Solar Spv Two Private Limited',
  'Singe Solar Energy Private Limited',
  'Sourashakthi Energy Private Limited',
  'Spangle Energy Private Limited',
  'Sparzana Aviation Private Limited',
  'Torrid Solar Power Private Limited',
  'Venwind Refex Power Limited',
  'Vyzag Bio-Energy Fuel Private Limited',
];

function normalizeCompanyText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function companyIdFromLabel(label) {
  return normalizeCompanyText(label).replace(/\s+/g, '-');
}

function compareCompanyFilterLabel(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  const leftDigit = /^[0-9]/.test(left);
  const rightDigit = /^[0-9]/.test(right);
  if (leftDigit !== rightDigit) return leftDigit ? 1 : -1;
  return left.localeCompare(right, 'en', { sensitivity: 'base' });
}

const REFEX_COMPANIES = RAW_LABELS.map((label) => ({
  id: companyIdFromLabel(label),
  label,
})).sort((a, b) => compareCompanyFilterLabel(a.label, b.label));

const BY_ID = new Map(REFEX_COMPANIES.map((c) => [c.id, c]));
const BY_NORM = REFEX_COMPANIES.map((c) => ({
  id: c.id,
  norm: normalizeCompanyText(c.label),
}));

function resolveCompanyIdFromText(raw) {
  const norm = normalizeCompanyText(raw);
  if (!norm) return null;

  // Extrovis is an entity bucket, not a catalog legal entity.
  if (norm === 'extrovis' || norm.includes('extrovis')) return null;

  // Bare / short "refex" is an entity bucket — do not force Industries.
  if (norm === 'refex' || norm === 'refex group') return null;

  if (norm.includes('venwind')) {
    const hit = BY_NORM.find((c) => c.norm.includes('venwind'));
    return hit?.id || 'venwind-refex-power-limited';
  }

  let best = null;
  let bestLen = 0;
  for (const row of BY_NORM) {
    if (norm === row.norm || norm.includes(row.norm) || row.norm.includes(norm)) {
      if (row.norm.length > bestLen) {
        best = row.id;
        bestLen = row.norm.length;
      }
    }
  }
  return best;
}

function companyLabel(id) {
  if (id === 'all') return 'All companies';
  if (id === 'extrovis') return 'Extrovis';
  if (id === 'refex') return 'Refex';
  return BY_ID.get(id)?.label || String(id).replace(/-/g, ' ');
}

function refexCompanyOptions(counts = {}) {
  return REFEX_COMPANIES.map((c) => ({
    id: c.id,
    label: c.label,
    count: Number(counts[c.id] || 0),
  })).sort((a, b) => compareCompanyFilterLabel(a.label, b.label));
}

/** SQL fragment: match entity_key / entity text to a company filter id. */
function companyFilterSql(entityRaw, exprSql) {
  const raw = String(entityRaw || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return 'true';

  const lower = raw.toLowerCase();
  const escaped = lower.replace(/'/g, "''");

  if (lower === 'extrovis' || lower.includes('extrovis')) {
    return `(${exprSql} LIKE '%extrovis%')`;
  }
  if (lower === 'refex') {
    return `((${exprSql} IN ('', 'refex') OR ${exprSql} LIKE '%refex%') AND ${exprSql} NOT LIKE '%extrovis%' AND ${exprSql} NOT LIKE '%venwind%')`;
  }
  if (lower === 'venwind' || lower.includes('venwind')) {
    return `(${exprSql} LIKE '%venwind%')`;
  }

  if (lower === 'operation' || lower === 'operations') {
    return `(${exprSql} IN ('operation', 'operations') OR ${exprSql} LIKE '%operation%')`;
  }

  if (lower === 'finance') {
    return `(${exprSql} IN ('finance') OR ${exprSql} LIKE '%finance%')`;
  }

  const company = BY_ID.get(lower);
  if (company) {
    const tokens = normalizeCompanyText(company.label)
      .split(' ')
      .filter((t) => t.length > 3)
      .slice(0, 4)
      .map((t) => t.replace(/'/g, "''"));
    if (!tokens.length) return `(${exprSql} LIKE '%${escaped}%')`;
    const parts = tokens.map((t) => `${exprSql} LIKE '%${t}%'`);
    return `(${parts.join(' AND ')})`;
  }

  return `(${exprSql} LIKE '%${escaped.replace(/-/g, '%')}%')`;
}

module.exports = {
  REFEX_COMPANIES,
  REFEX_DEFAULT_COMPANY_NAME,
  normalizeCompanyText,
  resolveCompanyIdFromText,
  companyLabel,
  refexCompanyOptions,
  companyFilterSql,
};
