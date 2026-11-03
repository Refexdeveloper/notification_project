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

/**
 * Project Management tasks carry RMC on the project, not the entity code:
 * project code PRJ-RIL_RMC-… or a project name such as "Kalyan RMC Plant".
 * Sub-tasks carry it on their Task_ID link (Project / Subtaxk_id).
 * Underscore counts as a separator so RIL_RMC matches; free-text task
 * names and details are not read.
 * Keep aligned with report_pm_rmc_scope_predicate in report-template-lib.sh.
 */
const RMC_TOKEN = /(^|[^a-z0-9])rmc([^a-z0-9]|$)/i;

function projectTextCandidates(raw) {
  const out = [];
  if (!raw || typeof raw !== 'object') return out;
  const push = (value) => {
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) out.push(text);
    }
  };
  push(raw.Project_ID_Hidden);
  push(raw.Project_ID_Details);
  push(raw.Project_Name);
  push(raw.Project);
  if (raw.Project_ID && typeof raw.Project_ID === 'object') {
    push(raw.Project_ID.Project_ID);
    push(raw.Project_ID.Project_Name);
    push(raw.Project_ID.Name);
  } else {
    push(raw.Project_ID);
  }
  if (raw.Task_ID && typeof raw.Task_ID === 'object') {
    push(raw.Task_ID.Project);
    push(raw.Task_ID.Subtaxk_id);
  }
  return out;
}

function isRmcProjectRecord(raw) {
  return projectTextCandidates(raw).some((value) => RMC_TOKEN.test(value));
}

/**
 * Project Management scope. ril_rmc = entity code RIL_RMC or an RMC project.
 * common keeps the entity-code-only rule so the common report is unchanged.
 */
function recordInPmRmcScope(raw, scope) {
  if (scope === 'ril_rmc') return isRilRmcRecord(raw) || isRmcProjectRecord(raw);
  return recordInEntityCodeScope(raw, scope);
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
  isRmcProjectRecord,
  recordInEntityCodeScope,
  recordInPmRmcScope,
  entityCodeScopeFromFilter,
};
