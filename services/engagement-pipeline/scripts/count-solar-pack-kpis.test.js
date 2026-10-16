'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solarPackCountsFromRecords } = require('../../backend-api/src/lib/dashboardDisplay');
const { recordsFromSnapshotItems, isSolarDraftItem } = require('./count-solar-pack-kpis');

test('drops drafts and uses the dashboard pack classifier', () => {
  const records = recordsFromSnapshotItems([
    { process_status: 'Draft', current_step: 'Start', source_payload: { _status: 'Draft' } },
    { process_status: 'InProgress', current_step: 'HO Review', source_payload: { _status: 'InProgress', _current_step: 'HO Review' } },
    {
      process_status: 'Rejected',
      current_step: 'Rejected',
      source_payload: {
        _status: 'Rejected',
        _current_context: [{ _context_current_step: 'HO Review', _status: 'Rejected' }],
      },
    },
    { process_status: 'InProgress', current_step: 'BU Approval', source_payload: { _status: 'InProgress', _current_step: 'BU Approval' } },
    { process_status: 'Completed', current_step: 'Finance Processing', source_payload: { _status: 'Completed', _current_step: 'Finance Processing' } },
  ]);
  assert.equal(records.length, 4);
  const packs = solarPackCountsFromRecords(records);
  assert.deepEqual(packs.operation, { open: 1, closed: 2, rejected: 1 });
  assert.deepEqual(packs.finance, { open: 1, closed: 1, rejected: 0 });
});

test('isSolarDraftItem matches dashboard draft skip', () => {
  assert.equal(isSolarDraftItem({ process_status: 'Draft' }), true);
  assert.equal(isSolarDraftItem({ source_payload: { _status: 'InProgress' } }), false);
});
