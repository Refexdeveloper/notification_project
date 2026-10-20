'use strict';

/**
 * Entity code RIL_RMC is exclusive. Other entities stay on the common report.
 * Run: node tests/entity-code.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  isRilRmcRecord,
  recordInEntityCodeScope,
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

assert.strictEqual(entityCodeScopeFromFilter('RIL_RMC', { split: true }), 'ril_rmc');
assert.strictEqual(entityCodeScopeFromFilter('', { split: true }), 'common');
assert.strictEqual(entityCodeScopeFromFilter('Venwind', { split: true }), 'common');
assert.strictEqual(entityCodeScopeFromFilter('Refex'), 'passthrough');
assert.strictEqual(entityCodeScopeFromFilter('RIL_RMC'), 'ril_rmc');

console.log('entity-code.test.js ok');
