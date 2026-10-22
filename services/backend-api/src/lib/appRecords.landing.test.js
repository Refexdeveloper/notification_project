'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ENGAGEMENT_RECORDS_SCHEMA_VERSION } = require('./engagementCache');
const { loadKissflowRecords, primeItsmReportCloserCache, extractItsmCloserMeta } = require('./appRecords');

test('landing records return engagement cache without extra snapshot SQL', async () => {
  const sql = [];
  const pool = {
    async query(text) {
      sql.push(String(text));
      return {
        rows: [{
          source_payload: {
            engagement_cache: {
              fetched_at: new Date().toISOString(),
              items: [],
              records_schema_version: ENGAGEMENT_RECORDS_SCHEMA_VERSION,
              records: [
                {
                  id: 'rec-1',
                  request_id: 'TRReq-1',
                  subject: 'Chennai trip',
                  status: 'open',
                  process_id: 'Travel_Management_A02',
                  created_at: '2026-10-01T10:00:00Z',
                },
                {
                  id: 'rec-2',
                  request_id: 'IT-2',
                  subject: 'VPN',
                  status: 'closed',
                  process_id: 'Live_IT_Service_Request_A00',
                  created_at: '2026-10-02T10:00:00Z',
                },
              ],
            },
          },
        }],
      };
    },
  };

  const travel = await loadKissflowRecords(pool, {
    environment: 'production',
    applicationId: 'Expense_and_Travel_Management_A00',
    limit: 50,
    offset: 0,
  });
  assert.equal(travel.items.length, 2);
  assert.equal(travel.data_source, 'live_cache');
  assert.equal(sql.length, 1);
  assert.match(sql[0], /engagement_reporting\.application/);
  assert.doesNotMatch(sql[0], /snapshot_run|latestRuns|item i/i);
});

test('ITSM landing overlays Closed By from process-report closer cache', async () => {
  const extras = new Map();
  extras.set('it-2', { closed_by: 'Sakthivel' });
  extras.set('IT-SR-2', { closed_by: 'Sakthivel' });
  primeItsmReportCloserCache('production', extras);

  const sql = [];
  const pool = {
    async query(text) {
      sql.push(String(text));
      return {
        rows: [{
          source_payload: {
            engagement_cache: {
              fetched_at: new Date().toISOString(),
              items: [],
              records_schema_version: ENGAGEMENT_RECORDS_SCHEMA_VERSION,
              records: [
                {
                  id: 'it-2',
                  request_id: 'IT-SR-2',
                  subject: 'VPN',
                  status: 'closed',
                  form_status: 'Closed',
                  assigned_to: '—',
                  closed_by: null,
                  process_id: 'Live_IT_Service_Request_A00',
                  created_at: '2026-10-02T10:00:00Z',
                },
              ],
            },
          },
        }],
      };
    },
  };

  const itsm = await loadKissflowRecords(pool, {
    environment: 'production',
    applicationId: 'IT_Service_Management_A00',
    inventory: true,
  });
  assert.equal(itsm.items.length, 1);
  assert.equal(itsm.items[0].closed_by, 'Sakthivel');
  assert.equal(itsm.items[0].assigned_to, 'Sakthivel');
  assert.equal(sql.length, 1);
  assert.match(sql[0], /engagement_reporting\.application/);
  assert.doesNotMatch(sql.join('\n'), /snapshot_run|item i|Get-all-items/i);
});

test('Closed By condition prefers solver ActedBy then Closed_By and hides bots', () => {
  assert.equal(extractItsmCloserMeta({
    'IT Tech Support': [{ ActedBy: { Name: 'Sakthivel' }, Status: 'Completed' }],
    Closed_By: { Name: 'ITSM BOT' },
  }).closed_by, 'Sakthivel');
  assert.equal(extractItsmCloserMeta({
    Closed_By: { Name: 'Bhukkay Naik' },
    _status: 'Completed',
  }).closed_by, 'Bhukkay Naik');
  assert.equal(extractItsmCloserMeta({
    Closed_By: { Name: 'ITSM BOT' },
    _modified_by: { Name: 'ITSM BOT' },
    _status: 'Completed',
  }).closed_by, '');
});
