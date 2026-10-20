'use strict';

/**
 * Entity-code gate for Expense, Project Management, and Travel notifications.
 *
 * RIL_RMC is an exact code (case-insensitive). A record matches when any
 * entity/company code field equals RIL_RMC, even if the display name is
 * Refex, Venwind, or blank.
 *
 * Keep the field list aligned with report_entity_code_predicate in
 * ops/runbooks/report-template-lib.sh.
 */

const RIL_RMC_ENTITY_CODE = 'RIL_RMC';

const CODE_KEYS = [
  'Entity_Code',
  'EntityCode',
  'entity_code',
  'Company_Code',
  'Legal_Entity_Code',
  'Org_Code',
  'Organisation_Code',
  'Organization_Code',
  'Employee_Entity_Code',
  'Entity',
  'Employee_entity',
  'employee_entity',
  'Company',
  'Legal_Entity',
  'entity',
];

function pushScalar(out, value) {
  if (value == null) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    if (text) out.push(text);
    return;
  }
  if (typeof value === 'object') {
    pushScalar(out, value.Code);
    pushScalar(out, value.code);
    pushScalar(out, value.Id);
    pushScalar(out, value.id);
    pushScalar(out, value.Name);
    pushScalar(out, value.name);
    pushScalar(out, value.Value);
    pushScalar(out, value.value);
    pushScalar(out, value.v);
  }
}

function entityCodeCandidates(raw) {
  const out = [];
  if (!raw || typeof raw !== 'object') return out;
  for (const key of CODE_KEYS) pushScalar(out, raw[key]);
  return out;
}

function isRilRmcRecord(raw) {
  return entityCodeCandidates(raw).some(
    (value) => value.toLowerCase() === RIL_RMC_ENTITY_CODE.toLowerCase(),
  );
}

/**
 * @param {'ril_rmc'|'common'|'passthrough'} scope
 * ril_rmc — this notification only
 * common — every entity except RIL_RMC
 * passthrough — no entity-code split (ITSM and other apps)
 */
function recordInEntityCodeScope(raw, scope) {
  const match = isRilRmcRecord(raw);
  if (scope === 'ril_rmc') return match;
  if (scope === 'common') return !match;
  return true;
}

function entityCodeScopeFromFilter(filter, { split = false } = {}) {
  const value = String(filter || '').trim().toLowerCase();
  if (value === 'ril_rmc') return 'ril_rmc';
  if (split) return 'common';
  return 'passthrough';
}

module.exports = {
  RIL_RMC_ENTITY_CODE,
  CODE_KEYS,
  entityCodeCandidates,
  isRilRmcRecord,
  recordInEntityCodeScope,
  entityCodeScopeFromFilter,
};
