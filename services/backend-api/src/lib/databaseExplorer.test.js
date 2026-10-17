'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  clampPage,
  clampPageSize,
  normalizeApplicationId,
  normalizeEnvironment,
  normalizeSearch,
  mergeSnapshotAndCache,
  collectAvailableFields,
  defaultVisibleFields,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('./databaseExplorer');

test('pagination clamps so Database never loads an inventory-sized page', () => {
  assert.equal(clampPageSize(undefined), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(0), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(8000), MAX_PAGE_SIZE);
  assert.equal(clampPageSize(25), 25);
  assert.equal(clampPage(0), 1);
  assert.equal(clampPage('3'), 3);
});

test('route ids and search stay bounded', () => {
  assert.equal(normalizeEnvironment('Production'), 'production');
  assert.equal(normalizeApplicationId('production-IT_Service_Management_A00'), 'IT_Service_Management_A00');
  assert.equal(normalizeSearch('  abc  '), 'abc');
  assert.equal(normalizeSearch('x'.repeat(200)).length, 80);
});

test('P2P empty criticality is not a default column', () => {
  const fields = collectAvailableFields([
    {
      instance_id: '9',
      request_id: 'PO-1',
      process_id: 'purchase_orders',
      process_status: 'awaiting_grn',
      current_step: 'awaiting_grn',
      entity: '25',
      requester_email: '',
      criticality: '',
      snapshot_at: '2026-10-17',
      source_payload: { id: 9, status: 'awaiting_grn', po_number: 'PO-1' },
    },
  ]);
  const visible = defaultVisibleFields(fields);
  assert.equal(visible.includes('criticality'), false);
  assert.equal(visible.includes('request_id'), true);
  assert.equal(fields.some((field) => field.id === 'criticality'), false);
  assert.ok(visible.every((id) => typeof id === 'string'));
});

test('merge keeps raw snapshot row and adds cache-only tickets', () => {
  const merged = mergeSnapshotAndCache(
    [
      { instance_id: 'A1', request_id: 'IT-1', process_id: 'Live_IT_Service_Request_A00', snapshot_at: '2026-08-11' },
    ],
    [
      { id: 'A1', request_id: 'IT-1', process_id: 'Live_IT_Service_Request_A00' },
      { id: 'B9', request_id: 'IT-1223', process_id: 'Live_IT_Service_Request_A00' },
    ],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].row_source, 'item');
  assert.equal(merged[0].instance_id, 'A1');
  assert.equal(merged[1].row_source, 'engagement_cache');
  assert.equal(merged[1].request_id, 'IT-1223');
});
