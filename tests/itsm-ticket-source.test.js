'use strict';

/**
 * Unit checks for ITSM Source classification (no network).
 * Run: node tests/itsm-ticket-source.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  classifyTicketSource,
  pickSourceRaw,
  emptySourceBuckets,
  bumpSource,
} = require(path.join(
  __dirname,
  '..',
  'services/engagement-pipeline/scripts/itsm-ticket-source.js',
));

assert.strictEqual(classifyTicketSource('Email'), 'Email');
assert.strictEqual(classifyTicketSource('E-mail Portal'), 'Email');
assert.strictEqual(classifyTicketSource('WhatsApp'), 'WhatsApp');
assert.strictEqual(classifyTicketSource('Mobile App'), 'Mobile');
assert.strictEqual(classifyTicketSource('Phone'), 'Mobile');
assert.strictEqual(classifyTicketSource('Web Portal'), 'Web');
assert.strictEqual(classifyTicketSource('Unknown XYZ'), 'Other');
assert.strictEqual(classifyTicketSource(''), 'Other');

assert.strictEqual(
  classifyTicketSource({ Source: { Name: 'Email' } }),
  'Email',
);
assert.strictEqual(
  classifyTicketSource({ Column_BDSZ_sAHys: { Name: 'Mobile' } }),
  'Mobile',
);
assert.strictEqual(
  classifyTicketSource({ Column_hFjGV8lRrn: 'WhatsApp' }),
  'WhatsApp',
);
assert.strictEqual(
  pickSourceRaw({ Column_BDSZ_sAHys: { Value: 'Web' } }),
  'Web',
);

const buckets = emptySourceBuckets();
bumpSource(buckets, 'Email');
bumpSource(buckets, 'Email');
bumpSource(buckets, 'Mobile');
assert.strictEqual(buckets.Email, 2);
assert.strictEqual(buckets.Mobile, 1);
assert.strictEqual(buckets.WhatsApp, 0);

console.log('PASS: itsm-ticket-source classification');
