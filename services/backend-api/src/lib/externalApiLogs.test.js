'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactText, pathOnly, mapLogEntry } = require('./externalApiLogs');

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
});
