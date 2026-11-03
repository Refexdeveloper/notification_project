'use strict';

/**
 * Entity code RIL_RMC is exclusive. Other entities stay on the common report.
 * Run: node tests/entity-code.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  isRilRmcRecord,
  isRmcProjectRecord,
  recordInEntityCodeScope,
  recordInPmRmcScope,
  entityCodeScopeFromFilter,
} = require(path.join(
  __dirname,
  '..',
  'services/engagement-pipeline/scripts/entity-code.js',
));

assert.strictEqual(isRilRmcRecord({ Entity_Code: 'RIL_RMC', Entity: 'Refex' }), true);
assert.strictEqual(isRilRmcRecord({ entity_code: 'ril_rmc' }), true);
assert.strictEqual(
  isRilRmcRecord({ Entity: { Name: 'Refex Industries Limited', Code: 'RIL_RMC' } }),
  true,
);
assert.strictEqual(isRilRmcRecord({ Company_Code: { Value: 'RIL_RMC' } }), true);
assert.strictEqual(isRilRmcRecord({ employee_entity: 'RIL_RMC', Entity_1: 'Refex' }), true);
assert.strictEqual(isRilRmcRecord({ Entity: 'Venwind' }), false);
assert.strictEqual(isRilRmcRecord({ Entity: 'Refex', Entity_Code: 'RIL_REF' }), false);
assert.strictEqual(isRilRmcRecord({}), false);
assert.strictEqual(isRilRmcRecord(null), false);

assert.strictEqual(recordInEntityCodeScope({ Entity_Code: 'RIL_RMC' }, 'ril_rmc'), true);
assert.strictEqual(recordInEntityCodeScope({ Entity: 'Venwind' }, 'ril_rmc'), false);
assert.strictEqual(recordInEntityCodeScope({ Entity_Code: 'RIL_RMC' }, 'common'), false);
assert.strictEqual(recordInEntityCodeScope({ Entity: 'Refex' }, 'common'), true);
assert.strictEqual(recordInEntityCodeScope({ Entity_Code: 'RIL_RMC' }, 'passthrough'), true);

// Project Management: RMC lives on the project code or name.
const rmcCodeTask = {
  Entity: 'Refex Industries Limited',
  Project_ID_Hidden: 'PRJ-RIL_RMC-FY026-0147',
  Project_Name: 'IDS ERP',
};
const rmcNameTask = {
  Entity: 'Refex Industries Limited',
  Project_ID: { Project_ID: 'PRJ--FY026-0119', Project_Name: 'Chahurli RMC Plant – IT Infrastructure Project' },
};
const rmcSubTask = { Task_ID: { Project: 'Kalyan RMC Plant – IT Infra Project-3', Subtaxk_id: 'Task-PRJ-RIL_RMC-FY026-0127-001' } };
const otherTask = {
  Entity: 'Refex Industries Limited',
  Project: 'Individual Task',
  Name: 'RMC user permission not working from RMC',
  Task_Detail: 'corrected MIS records, RMC report tables',
};
const ceoSubTask = { Task_ID: { Project: 'CEO - MOM points', Name: 'Solar, CNG & RMC- Identify manual', Subtaxk_id: 'Task-PRJ--FY026-0140-008' } };
const lookalike = { Project_Name: 'Pharmacy Rollout', Project_ID_Hidden: 'PRJ-RMCX-01' };

assert.strictEqual(isRmcProjectRecord(rmcCodeTask), true);
assert.strictEqual(isRmcProjectRecord(rmcNameTask), true);
assert.strictEqual(isRmcProjectRecord({ Project_Name: 'RMC-p2p' }), true);
assert.strictEqual(isRmcProjectRecord({ Project: 'RMC' }), true);
assert.strictEqual(isRmcProjectRecord(rmcSubTask), true);
assert.strictEqual(isRmcProjectRecord(otherTask), false);
assert.strictEqual(isRmcProjectRecord(ceoSubTask), false);
assert.strictEqual(isRmcProjectRecord(lookalike), false);
assert.strictEqual(isRmcProjectRecord(null), false);

assert.strictEqual(recordInPmRmcScope(rmcCodeTask, 'ril_rmc'), true);
assert.strictEqual(recordInPmRmcScope({ Entity_Code: 'RIL_RMC' }, 'ril_rmc'), true);
assert.strictEqual(recordInPmRmcScope(otherTask, 'ril_rmc'), false);
// Common report rule is unchanged (entity code only).
assert.strictEqual(recordInPmRmcScope(rmcCodeTask, 'common'), true);
assert.strictEqual(recordInPmRmcScope({ Entity_Code: 'RIL_RMC' }, 'common'), false);
// Expense / Travel entity-code scope is unchanged.
assert.strictEqual(recordInEntityCodeScope(rmcCodeTask, 'ril_rmc'), false);

assert.strictEqual(entityCodeScopeFromFilter('RIL_RMC', { split: true }), 'ril_rmc');
assert.strictEqual(entityCodeScopeFromFilter('', { split: true }), 'common');
assert.strictEqual(entityCodeScopeFromFilter('Venwind', { split: true }), 'common');
assert.strictEqual(entityCodeScopeFromFilter('Refex'), 'passthrough');
assert.strictEqual(entityCodeScopeFromFilter('RIL_RMC'), 'ril_rmc');

console.log('entity-code.test.js ok');
