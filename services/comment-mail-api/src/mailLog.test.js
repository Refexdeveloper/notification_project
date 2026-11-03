'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildMailLog } = require('./mailLog');

describe('buildMailLog', () => {
  it('keeps the addresses and the Cloud Run trace on one line', () => {
    const entry = buildMailLog(
      { get: (name) => (name === 'x-cloud-trace-context' ? 'abc123/span;o=1' : '') },
      {
        displayFrom: 'itsupport@extrovis.com',
        to: ['tanuja.villa@bs.nttdata.com', 'anusha.shyamala@bs.nttdata.com'],
        cc: ['kishore.yepuri@extrovis.com'],
        replyTo: 'tanuja.villa@bs.nttdata.com, anusha.shyamala@bs.nttdata.com',
      },
      'comment-mail sent',
    );
    assert.equal(entry.message, 'comment-mail sent');
    assert.equal(entry.from, 'itsupport@extrovis.com');
    assert.deepEqual(entry.to, ['tanuja.villa@bs.nttdata.com', 'anusha.shyamala@bs.nttdata.com']);
    assert.equal(entry['logging.googleapis.com/trace'], 'projects/master-diorama-489103-u2/traces/abc123');
  });
});
