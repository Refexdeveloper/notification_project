'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { itsmEntityMatchesFilter, canonicalItsmEntityFilter } = require('./itsm-entity-scope.js');

describe('itsmEntityMatchesFilter', () => {
  it('scopes Extrovis filter to Extrovis only', () => {
    assert.equal(itsmEntityMatchesFilter('Extrovis', 'Extrovis'), true);
    assert.equal(itsmEntityMatchesFilter('Kavis', 'Extrovis'), false);
    assert.equal(itsmEntityMatchesFilter('ModePro', 'Extrovis'), false);
    assert.equal(itsmEntityMatchesFilter('', 'all'), true);
  });

  it('matches Kavis aliases for Kavispharma filter', () => {
    assert.equal(canonicalItsmEntityFilter('Kavispharma'), 'kavis');
    assert.equal(itsmEntityMatchesFilter('Kavis', 'Kavispharma'), true);
    assert.equal(itsmEntityMatchesFilter('Kavis Pharma', 'Kavispharma'), true);
    assert.equal(itsmEntityMatchesFilter('KavisPharma', 'Kavispharma'), true);
    assert.equal(itsmEntityMatchesFilter('Extrovis', 'Kavispharma'), false);
  });

  it('matches Modepro aliases', () => {
    assert.equal(itsmEntityMatchesFilter('ModePro', 'Modepro'), true);
    assert.equal(itsmEntityMatchesFilter('Modepro', 'Modepro'), true);
    assert.equal(itsmEntityMatchesFilter('Extrovis', 'Modepro'), false);
  });
});
