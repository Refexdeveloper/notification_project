'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { annotate } = require('../services/backend-api/src/lib/travelFareAnalysis');
const { buildLiveRecordRows, serializeRecordItem, applyTravelFareAnalysis } = require('../services/backend-api/src/lib/appRecords');

function flightRow(overrides = {}) {
  return {
    id: overrides.id || 'f1',
    travel_mode: 'Air',
    from_city: 'Chennai',
    to_city: 'Delhi',
    amount: 10000,
    created_at: '2026-10-01T00:00:00.000Z',
    departure_date: '2026-10-15T00:00:00.000Z',
    status: 'open',
    ...overrides,
  };
}

function summarize(rows) {
  let open = 0;
  let closed = 0;
  let rejected = 0;
  for (const row of rows) {
    const status = String(row.status || '').toLowerCase();
    if (status === 'closed') closed += 1;
    else if (status === 'rejected') rejected += 1;
    else open += 1;
  }
  return { total: rows.length, open, closed, rejected };
}

test('late booking is flagged', () => {
  const [row] = annotate([flightRow({
    created_at: '2026-10-10T00:00:00.000Z',
    departure_date: '2026-10-12T00:00:00.000Z',
  })]);
  assert.equal(row.advance_days, 2);
  assert.equal(row.advance_check, 'fail');
  assert.equal(row.fare_check, 'Flagged');
  assert.deepEqual(row.fare_flags, ['Late booking']);
});

test('over-cap is blocked', () => {
  const rows = annotate([
    flightRow({ id: 'a', amount: 10000 }),
    flightRow({ id: 'b', amount: 10000 }),
    flightRow({ id: 'c', amount: 20000 }),
  ]);
  const expensive = rows.find((row) => row.id === 'c');
  assert.equal(expensive.cap_check, 'fail');
  assert.equal(expensive.fare_check, 'Blocked');
  assert.ok(expensive.fare_flags.includes('Over fare cap'));
});

test('normal flight is compliant', () => {
  const [row] = annotate([flightRow()]);
  assert.equal(row.advance_check, 'pass');
  assert.equal(row.cap_check, 'not evaluated');
  assert.equal(row.fare_check, 'Compliant');
  assert.deepEqual(row.fare_flags, []);
  assert.equal(row.fare_route, 'CHENNAI-DELHI');
});

test('route with fewer than 3 samples is not capped', () => {
  const rows = annotate([
    flightRow({ id: 'a', amount: 10000 }),
    flightRow({ id: 'b', amount: 40000 }),
  ]);
  assert.equal(rows[0].cap_check, 'not evaluated');
  assert.equal(rows[1].cap_check, 'not evaluated');
  assert.equal(rows[1].fare_check, 'Compliant');
});

test('missing dates are not evaluated', () => {
  const [row] = annotate([flightRow({
    created_at: null,
    departure_date: null,
  })]);
  assert.equal(row.advance_days, null);
  assert.equal(row.advance_check, 'not evaluated');
  assert.equal(row.fare_check, 'Not evaluated');
});

test('non-flight is n/a', () => {
  const [row] = annotate([{
    id: 't1',
    travel_mode: 'Train',
    from_city: 'Chennai',
    to_city: 'Madurai',
    amount: 900,
    status: 'open',
  }]);
  assert.equal(row.fare_check, 'n/a');
  assert.equal(row.fare_route, undefined);
});

test('chair car is not treated as air', () => {
  const [row] = annotate([{ id: 'c1', travel_mode: 'Chair Car', status: 'open' }]);
  assert.equal(row.fare_check, 'n/a');
});

test('lowest fare and cabin stay not evaluated without those fields', () => {
  const [row] = annotate([flightRow()]);
  assert.equal(row.lowest_fare_check, 'not evaluated');
  assert.equal(row.cabin_check, 'not evaluated');
});

test('records totals and existing columns stay identical after annotate', () => {
  const raw = [
    {
      _id: 'abc',
      _process_id: 'Travel_Management_A02',
      Request_ID: 'TRReq-1',
      Travel_Mode: 'Air',
      Boarding_from: 'Chennai',
      Destination_to_1: 'Delhi',
      Departure_Date: '2026-10-23',
      _status: 'InProgress',
      _created_at: '2026-10-01T10:00:00Z',
      FS_Booking_Amount: 12000,
    },
    {
      _id: 'adv',
      _process_id: 'Advance_Payment_Request_Process_A01',
      Request_ID: 'AD-1',
      Travel_Mode: 'Train',
      _status: 'Completed',
      _created_at: '2026-10-02T10:00:00Z',
    },
  ];
  const before = buildLiveRecordRows(raw, 'Expense_and_Travel_Management_A00');
  const summaryBefore = summarize(before);
  const existing = before.map((row) => ({
    id: row.id,
    request_id: row.request_id,
    status: row.status,
    from_city: row.from_city,
    to_city: row.to_city,
    travel_mode: row.travel_mode,
    amount: row.amount,
    created_at: row.created_at,
  }));
  const after = annotate(before);
  assert.deepEqual(summarize(after), summaryBefore);
  assert.deepEqual(after.map((row) => ({
    id: row.id,
    request_id: row.request_id,
    status: row.status,
    from_city: row.from_city,
    to_city: row.to_city,
    travel_mode: row.travel_mode,
    amount: row.amount,
    created_at: row.created_at,
  })), existing);
  const serialized = serializeRecordItem(after[0]);
  assert.equal(serialized.request_id, existing[0].request_id);
  assert.equal(serialized.fare_check, 'Compliant');
});

test('applyTravelFareAnalysis is a no-op for non-travel apps', () => {
  const rows = [{ id: '1', status: 'open', travel_mode: 'Train' }];
  assert.equal(applyTravelFareAnalysis('IT_Service_Management_A00', rows), rows);
  const travel = applyTravelFareAnalysis('Expense_and_Travel_Management_A00', rows);
  assert.equal(travel[0].fare_check, 'n/a');
});
