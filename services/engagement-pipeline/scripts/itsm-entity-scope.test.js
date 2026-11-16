'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  itsmEntityMatchesFilter,
  canonicalItsmEntityFilter,
  canonicalItsmEntityLabel,
  itsmEntityEmailDomain,
  itsmUserEmailMatchesEntity,
} = require('./itsm-entity-scope.js');

describe('itsmEntityMatchesFilter', () => {
  it('scopes Extrovis filter to Extrovis only', () => {
    assert.equal(itsmEntityMatchesFilter('Extrovis', 'Extrovis'), true);
    assert.equal(itsmEntityMatchesFilter('Kavis', 'Extrovis'), false);
    assert.equal(itsmEntityMatchesFilter('ModePro', 'Extrovis'), false);
    assert.equal(itsmEntityMatchesFilter('', 'all'), true);
  });

  it('matches Kavis aliases for KavisPharma filter', () => {
    assert.equal(canonicalItsmEntityFilter('KavisPharma'), 'kavis');
    assert.equal(canonicalItsmEntityFilter('Kavispharma'), 'kavis');
    assert.equal(itsmEntityMatchesFilter('Kavis', 'KavisPharma'), true);
    assert.equal(itsmEntityMatchesFilter('Kavis Pharma', 'KavisPharma'), true);
    assert.equal(itsmEntityMatchesFilter('KavisPharma', 'Kavispharma'), true);
    assert.equal(itsmEntityMatchesFilter('Extrovis', 'KavisPharma'), false);
  });

  it('matches ModePro aliases', () => {
    assert.equal(itsmEntityMatchesFilter('ModePro', 'ModePro'), true);
    assert.equal(itsmEntityMatchesFilter('ModePro', 'Modepro'), true);
    assert.equal(itsmEntityMatchesFilter('Modepro', 'ModePro'), true);
    assert.equal(itsmEntityMatchesFilter('Extrovis', 'ModePro'), false);
  });
});

describe('itsmEntityEmailDomain', () => {
  it('maps entity schedules to company email domains', () => {
    assert.equal(itsmEntityEmailDomain('Extrovis'), 'extrovis.com');
    assert.equal(itsmEntityEmailDomain('KavisPharma'), 'kavispharma.com');
    assert.equal(itsmEntityEmailDomain('Kavispharma'), 'kavispharma.com');
    assert.equal(itsmEntityEmailDomain('ModePro'), 'modepro.com');
    assert.equal(itsmEntityEmailDomain('Modepro'), 'modepro.com');
    assert.equal(itsmEntityEmailDomain('Refex'), '');
    assert.equal(itsmEntityEmailDomain('all'), '');
  });

  it('filters users by email domain', () => {
    assert.equal(itsmUserEmailMatchesEntity('a@extrovis.com', 'Extrovis'), true);
    assert.equal(itsmUserEmailMatchesEntity('a@modepro.com', 'Extrovis'), false);
    assert.equal(itsmUserEmailMatchesEntity('jon@kavispharma.com', 'KavisPharma'), true);
    assert.equal(itsmUserEmailMatchesEntity('pradip@modepro.com', 'ModePro'), true);
    assert.equal(itsmUserEmailMatchesEntity('x@refex.co.in', 'ModePro'), false);
    assert.equal(itsmUserEmailMatchesEntity('', 'ModePro'), false);
    assert.equal(itsmUserEmailMatchesEntity('anyone@x.com', 'all'), true);
  });

  it('canonical labels match Kissflow Entity names', () => {
    assert.equal(canonicalItsmEntityLabel('Extrovis'), 'Extrovis');
    assert.equal(canonicalItsmEntityLabel('Kavispharma'), 'KavisPharma');
    assert.equal(canonicalItsmEntityLabel('Modepro'), 'ModePro');
  });
});
