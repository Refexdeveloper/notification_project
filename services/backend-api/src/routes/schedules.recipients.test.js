'use strict';

/**
 * PATCH /schedules/:id recipients: Bcc saved + returned; a To/Cc-only save keeps
 * existing Bcc; MANAGER_OF_USER rows are never deleted.
 * Run: node --test services/backend-api/src/routes/schedules.recipients.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const SCHEDULE_ID = '11111111-1111-1111-1111-111111111111';
let recipients = [];

function fakeQuery(sql, params = []) {
  const text = String(sql);
  if (/DELETE FROM engagement_reporting\.report_recipient/.test(text)) {
    const typed = /recipient_type IN \('TO', 'CC', 'BCC'\)/.test(text);
    recipients = recipients.filter((r) => typed && !['TO', 'CC', 'BCC'].includes(r.type));
    return { rows: [] };
  }
  const insert = text.match(/INSERT INTO engagement_reporting\.report_recipient[\s\S]*'(TO|CC|BCC)'/);
  if (insert) {
    recipients.push({ email: params[1], type: insert[1] });
    return { rows: [] };
  }
  if (/json_agg/.test(text) && params.length === 3) {
    return {
      rows: [{
        id: SCHEDULE_ID,
        definition_name: 'ITSM daily',
        report_definition_version_id: '22222222-2222-2222-2222-222222222222',
        application_id: 'IT_Service_Management_A00',
        template_id: 't1',
        template_name: 'ITSM',
        from_email: 'reports@refex.co.in',
        cron_expression: '0 9 * * *',
        timezone: 'Asia/Kolkata',
        is_active: false,
        recipients: recipients.map((r) => ({ ...r })),
        created_at: '2026-11-03T00:00:00Z',
      }],
    };
  }
  return { rows: [] };
}

function mock(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

mock('../lib/db', {
  isDatabaseConfigured: () => true,
  getPool: () => ({
    query: async (sql, params) => fakeQuery(sql, params),
    connect: async () => ({ query: async (sql, params) => fakeQuery(sql, params), release() {} }),
  }),
});
mock('../lib/session', { resolveSession: async () => ({ user: { id: 'u1' } }) });
mock('../lib/cloudSchedulerSync', {
  syncScheduleCloudJob: async () => ({ ok: true, skipped: true }),
  resolveLegacySchedulerId: () => null,
});
mock('../lib/smtpFromValidation', {
  validateScheduleFromEmail: () => ({ valid: true, authorized: true, message: 'ok' }),
});

const express = require('express');
const router = require('./schedules');

async function patch(body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.correlationId = 'test'; next(); });
  app.use('/applications/:applicationId/schedules', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/applications/IT_Service_Management_A00/schedules/${SCHEDULE_ID}?environment=production`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    );
    return { status: res.status, json: await res.json() };
  } finally {
    server.close();
  }
}

const types = (type) => recipients.filter((r) => r.type === type).map((r) => r.email).sort();

test('saves To / Cc / Bcc and returns bcc', async () => {
  recipients = [
    { email: 'old@x.com', type: 'TO' },
    { email: 'mgr-rule', type: 'MANAGER_OF_USER' },
  ];
  const { status, json } = await patch({
    recipients_to: ['a@x.com'],
    recipients_cc: ['c@x.com'],
    recipients_bcc: ['Hidden@X.com', 'hidden@x.com', 'not-an-email'],
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.deepEqual(types('TO'), ['a@x.com']);
  assert.deepEqual(types('CC'), ['c@x.com']);
  assert.deepEqual(types('BCC'), ['hidden@x.com'], 'normalized, deduped, invalid dropped');
  assert.deepEqual(types('MANAGER_OF_USER'), ['mgr-rule'], 'manager rows untouched');
  const item = json.data?.item || json.item;
  assert.deepEqual(item.bcc, ['hidden@x.com']);
  assert.deepEqual(item.recipients, ['a@x.com']);
  assert.deepEqual(item.cc, ['c@x.com']);
});

test('To/Cc-only save keeps existing Bcc', async () => {
  recipients = [
    { email: 'a@x.com', type: 'TO' },
    { email: 'keep@x.com', type: 'BCC' },
  ];
  const { status } = await patch({ recipients_to: ['b@x.com'], recipients_cc: [] });
  assert.equal(status, 200);
  assert.deepEqual(types('TO'), ['b@x.com']);
  assert.deepEqual(types('BCC'), ['keep@x.com']);
});

test('Bcc-only save keeps To and Cc', async () => {
  recipients = [
    { email: 'a@x.com', type: 'TO' },
    { email: 'c@x.com', type: 'CC' },
  ];
  const { status } = await patch({ recipients_bcc: ['z@x.com'] });
  assert.equal(status, 200);
  assert.deepEqual(types('TO'), ['a@x.com']);
  assert.deepEqual(types('CC'), ['c@x.com']);
  assert.deepEqual(types('BCC'), ['z@x.com']);
});

test('clearing Bcc removes it', async () => {
  recipients = [
    { email: 'a@x.com', type: 'TO' },
    { email: 'z@x.com', type: 'BCC' },
  ];
  const { status } = await patch({ recipients_bcc: [] });
  assert.equal(status, 200);
  assert.deepEqual(types('BCC'), []);
  assert.deepEqual(types('TO'), ['a@x.com']);
});
