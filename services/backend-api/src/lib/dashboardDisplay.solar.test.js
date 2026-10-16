'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifySolarCategory, solarPackCountsFromRecords } = require('./dashboardDisplay');

test('Start through VP Approval is Operation', () => {
  assert.equal(classifySolarCategory({}, 'Start'), 'Operation');
  assert.equal(classifySolarCategory({}, 'HO Review'), 'Operation');
  assert.equal(classifySolarCategory({}, 'VP Approval'), 'Operation');
  assert.equal(classifySolarCategory({}, ''), 'Operation');
});

test('BU Approval onward is Finance', () => {
  assert.equal(classifySolarCategory({}, 'BU Approval'), 'Finance');
  assert.equal(classifySolarCategory({}, 'Finance Processing'), 'Finance');
  assert.equal(classifySolarCategory({}, 'Finance Process'), 'Finance');
});

test('process status labels are not Finance', () => {
  assert.equal(classifySolarCategory({}, 'InProgress'), 'Operation');
  assert.equal(classifySolarCategory({}, 'Rejected'), 'Operation');
});

test('process Completed is Finance', () => {
  assert.equal(classifySolarCategory({ _status: 'Completed' }, ''), 'Finance');
});

test('department / category keywords do not move an ops-step record to Finance', () => {
  const payload = {
    Department: 'Finance',
    Cost_Center: 'Accounts',
    Category: 'Invoice',
    Request_Type: 'Treasury',
  };
  assert.equal(classifySolarCategory(payload, 'HO Review'), 'Operation');
  assert.equal(classifySolarCategory(payload, 'Start'), 'Operation');
});

test('Kissflow _current_step wins over InProgress / expense-type current_step', () => {
  assert.equal(
    classifySolarCategory({ _current_step: 'Finance Processing' }, 'InProgress'),
    'Finance',
  );
  assert.equal(
    classifySolarCategory({ _current_step: 'BU Approval' }, 'InProgress'),
    'Finance',
  );
  assert.equal(
    classifySolarCategory({ _current_step: 'HO Review' }, 'Site Expenses'),
    'Operation',
  );
});

test('rejected items use _current_context step, not Rejected', () => {
  assert.equal(
    classifySolarCategory({
      _status: 'Rejected',
      _current_context: [{ _context_current_step: 'HO Review', _status: 'Rejected' }],
    }, 'Rejected'),
    'Operation',
  );
  assert.equal(
    classifySolarCategory({
      _status: 'Rejected',
      _current_context: [{ _context_current_step: 'BU Approval', _status: 'Rejected' }],
    }, ''),
    'Finance',
  );
});

test('Operation Closed is moved-to-finance; Rejected follows last real step', () => {
  const packs = solarPackCountsFromRecords([
    { current_step: 'HO Review', status: 'open' },
    { current_step: 'HO Review', status: 'rejected', status_raw: 'Rejected' },
    { current_step: 'BU Approval', status: 'open' },
    { current_step: 'Finance Processing', status: 'closed', status_raw: 'Completed' },
  ]);
  assert.deepEqual(packs.operation, { open: 1, closed: 2, rejected: 1 });
  assert.deepEqual(packs.finance, { open: 1, closed: 1, rejected: 0 });
});
