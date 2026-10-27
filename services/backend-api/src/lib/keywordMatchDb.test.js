'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rowsFrom } = require('./keywordMatchDb');

test('maps BigQuery cells onto column names', () => {
  const rows = rowsFrom({
    schema: { fields: [{ name: 'sub_type' }, { name: 'keywords' }] },
    rows: [{ f: [{ v: 'Network' }, { v: 'wifi,lan' }] }],
  });
  assert.deepEqual(rows, [{ sub_type: 'Network', keywords: 'wifi,lan' }]);
});
