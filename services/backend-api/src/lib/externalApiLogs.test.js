'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactText, pathOnly, mapLogEntry, mergeMailOntoRequests } = require('./externalApiLogs');

test('redacts tokens and keeps a short message', () => {
  const text = redactText('failed Bearer abc.def key and cmk_7f3a9c2e1b84d6f0a5e8c193b2470d6e');
  assert.equal(text.includes('abc.def'), false);
  assert.equal(text.includes('cmk_'), false);
  assert.match(text, /Bearer \[redacted\]/);
});

test('drops query strings from request URLs', () => {
  assert.equal(
    pathOnly('https://refex-comment-mail-dhwffeu7pq-el.a.run.app/v1/send?key=secret'),
    '/v1/send',
  );
});

test('maps a Cloud Run request log without the raw URL', () => {
  const row = mapLogEntry({
    timestamp: '2026-10-27T09:00:00Z',
    severity: 'INFO',
    httpRequest: {
      requestMethod: 'POST',
      status: 200,
      requestUrl: 'https://keyword-matching-api-dhwffeu7pq-el.a.run.app/api/v1/keyword-match?token=1',
      latency: '0.210s',
    },
    textPayload: 'ok',
  });
  assert.equal(row.method, 'POST');
  assert.equal(row.status, 200);
  assert.equal(row.path, '/api/v1/keyword-match');
  assert.equal(row.message, 'ok');
  assert.equal(row.requestBody, '');
  assert.equal(row.responseBody, '');
});

test('keeps request and response bodies for the expand panel', () => {
  const row = mapLogEntry({
    timestamp: '2026-10-27T09:00:00Z',
    severity: 'INFO',
    trace: 'projects/master/traces/abc123',
    resource: { labels: { revision_name: 'refex-comment-mail-00005-7ch' } },
    httpRequest: {
      requestMethod: 'POST',
      status: 200,
      requestUrl: 'https://refex-comment-mail-dhwffeu7pq-el.a.run.app/v1/send',
      latency: '0.4s',
      protocol: 'HTTP/1.1',
      requestSize: '1200',
      responseSize: '80',
      remoteIp: '49.200.185.245',
      userAgent: 'refexone',
    },
    jsonPayload: {
      requestBody: { to: ['user@extrovis.com'], html: 'Bearer secret-token' },
      response: { ok: true, messageId: 'm1' },
    },
  });
  assert.equal(row.requestSize, '1200');
  assert.equal(row.responseSize, '80');
  assert.equal(row.revision, 'refex-comment-mail-00005-7ch');
  assert.equal(row.trace, 'abc123');
  assert.equal(row.requestBody.includes('user@extrovis.com'), true);
  assert.equal(row.requestBody.includes('secret-token'), false);
  assert.equal(row.responseBody.includes('"ok": true'), true);
});

test('shows from, to, and cc on the request row that shares the send trace', () => {
  const [row] = mergeMailOntoRequests([
    mapLogEntry({
      timestamp: '2026-10-29T06:00:01Z',
      trace: 'projects/master/traces/mail1',
      jsonPayload: {
        msg: 'comment-mail sent',
        from: 'itsupport@extrovis.com',
        to: ['Tanuja.Villa@bs.nttdata.com', 'Anusha.Shyamala@bs.nttdata.com'],
        cc: ['kishore.yepuri@extrovis.com', 'mohamedaasik.m@refex.co.in'],
        replyTo: ['Tanuja.Villa@bs.nttdata.com', 'Anusha.Shyamala@bs.nttdata.com'],
      },
    }),
    mapLogEntry({
      timestamp: '2026-10-29T06:00:00Z',
      trace: 'projects/master/traces/mail1',
      httpRequest: {
        requestMethod: 'POST',
        status: 200,
        requestUrl: 'https://refex-comment-mail-dhwffeu7pq-el.a.run.app/v1/send',
      },
    }),
  ]);
  assert.equal(row.method, 'POST');
  assert.equal(row.mailFrom, 'itsupport@extrovis.com');
  assert.equal(row.mailTo, 'Tanuja.Villa@bs.nttdata.com, Anusha.Shyamala@bs.nttdata.com');
  assert.equal(row.mailCc.includes('kishore.yepuri@extrovis.com'), true);
  assert.equal(row.mailCc.includes('mohamedaasik.m@refex.co.in'), true);
  assert.equal(row.replyTo.includes('Anusha.Shyamala@bs.nttdata.com'), true);
});

test('reads addresses from a text log and attaches them to the closest request', () => {
  const [row] = mergeMailOntoRequests([
    mapLogEntry({
      timestamp: '2026-10-29T06:57:42.000Z',
      textPayload: JSON.stringify({
        message: 'comment-mail sent',
        from: 'itsupport@extrovis.com',
        to: ['tanuja.villa@bs.nttdata.com', 'anusha.shyamala@bs.nttdata.com'],
        cc: ['kishore.yepuri@extrovis.com'],
        replyTo: 'tanuja.villa@bs.nttdata.com, anusha.shyamala@bs.nttdata.com',
      }),
    }),
    mapLogEntry({
      timestamp: '2026-10-29T06:57:39.000Z',
      trace: 'projects/master/traces/req1',
      httpRequest: {
        requestMethod: 'POST',
        status: 200,
        requestUrl: 'https://refex-comment-mail-dhwffeu7pq-el.a.run.app/v1/send',
      },
    }),
  ]);
  assert.equal(row.path, '/v1/send');
  assert.equal(row.mailFrom, 'itsupport@extrovis.com');
  assert.equal(row.mailTo, 'tanuja.villa@bs.nttdata.com, anusha.shyamala@bs.nttdata.com');
  assert.equal(row.mailCc, 'kishore.yepuri@extrovis.com');
  assert.equal(row.replyTo, 'tanuja.villa@bs.nttdata.com, anusha.shyamala@bs.nttdata.com');
});
