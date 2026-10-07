'use strict';

/**
 * Head My Team Closed By / Closed Date extraction from Kissflow payloads.
 * Run: node tests/itsm-closer-from-payload.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  extractItsmCloserMeta,
  applyItsmMisExtras,
} = require(path.join(__dirname, '..', 'services/backend-api/src/lib/appRecords.js'));

const refexClosed = extractItsmCloserMeta({
  _status: 'Completed',
  _modified_at: '2026-09-02T10:00:00.000Z',
  _modified_by: { Name: 'ITSM Bot' },
  _current_assigned_to: { Name: 'IT Agents' },
  'IT Tech Support': [{
    Status: 'Completed',
    ActedBy: [{ Name: 'Sakthivel' }],
    ActedAt: '2026-09-01T18:30:00.000Z',
  }],
});
assert.strictEqual(refexClosed.closed_by, 'Sakthivel');
assert.strictEqual(refexClosed.modified_at, '2026-09-02T10:00:00.000Z');
assert.strictEqual(refexClosed.agent_closed_at, '2026-09-01T18:30:00.000Z');

const extrovisClosed = extractItsmCloserMeta({
  _status: 'Completed',
  Column_qr_9gP_vE5: [{
    Status: 'Completed',
    ActedBy: { Name: 'Deepan Duraisamy' },
    ActedAt: '2026-08-20T04:00:00.000Z',
  }],
});
assert.strictEqual(extrovisClosed.closed_by, 'Deepan Duraisamy');
assert.strictEqual(extrovisClosed.agent_closed_at, '2026-08-20T04:00:00.000Z');

const overlaid = applyItsmMisExtras(
  [{
    id: '1',
    request_id: 'SR-1',
    status: 'closed',
    assigned_to: 'IT Agents Extrovis',
    closed_by: 'ITSM Bot',
  }],
  new Map([['1', {
    closed_by: 'Sakthivel',
    modified_at: '2026-09-02T10:00:00.000Z',
    agent_closed_at: '2026-09-01T18:30:00.000Z',
    closed_at: null,
  }]]),
);
assert.strictEqual(overlaid[0].closed_by, 'Sakthivel');
assert.strictEqual(overlaid[0].assigned_to, 'Sakthivel');
assert.strictEqual(overlaid[0].modified_at, '2026-09-02T10:00:00.000Z');
assert.strictEqual(overlaid[0].closed_at, null, 'Closed Today KPI must not inherit modified_at');

const reopenMove = extractItsmCloserMeta({
  _status: 'InProgress',
  _current_step: 'IT Tech Reopen',
  'IT Tech Reopen': [{
    Status: 'InProgress',
    ActedAt: '2026-10-06T06:30:00.000Z',
  }],
});
assert.strictEqual(reopenMove.reopen_entered_at, '2026-10-06T06:30:00.000Z');

const extrovisReopen = extractItsmCloserMeta({
  _status: 'InProgress',
  _current_step: 'ReOpen Window',
  'ReOpen Window': [{
    Status: 'InProgress',
    ActedAt: '2026-10-06T07:00:00.000Z',
  }],
});
assert.strictEqual(extrovisReopen.reopen_entered_at, '2026-10-06T07:00:00.000Z');

console.log('itsm closer from payload ok');
