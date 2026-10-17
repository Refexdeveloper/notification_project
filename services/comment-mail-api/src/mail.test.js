'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { asEmailList, parseSendRequest } = require('./mail');

describe('parseSendRequest', () => {
  it('accepts to/cc strings and html', () => {
    const parsed = parseSendRequest({
      to: 'itsupport@extrovis.com',
      cc: 'mohamedaasik.m@refex.co.in',
      subject: 'Tech Help Desk - New Comment Added | Ticket EXT-1',
      html: '<p>Hello</p>',
    });
    assert.deepEqual(parsed.to, ['itsupport@extrovis.com']);
    assert.deepEqual(parsed.cc, ['mohamedaasik.m@refex.co.in']);
    assert.equal(parsed.displayFrom, 'itsupport@extrovis.com');
  });

  it('rejects missing html and invalid recipients', () => {
    assert.equal(parseSendRequest({ to: 'not-an-email', html: '<p>x</p>', subject: 'S' }).error.includes('to email'), true);
    assert.equal(parseSendRequest({ to: 'a@b.com', html: '', subject: 'S' }).error, 'html body is required');
    assert.equal(parseSendRequest({ to: 'a@b.com', html: '<p>x</p>', subject: '' }).error, 'subject is required');
  });

  it('dedupes cc that already appear in to', () => {
    const parsed = parseSendRequest({
      to: ['user@refex.co.in', 'user@refex.co.in'],
      cc: 'user@refex.co.in',
      subject: 'S',
      html: '<p>x</p>',
    });
    assert.deepEqual(parsed.to, ['user@refex.co.in']);
    assert.deepEqual(parsed.cc, []);
  });
});

describe('asEmailList', () => {
  it('splits comma/semicolon lists', () => {
    assert.deepEqual(
      asEmailList('itsupport@extrovis.com; mohamedaasik.m@refex.co.in'),
      ['itsupport@extrovis.com', 'mohamedaasik.m@refex.co.in'],
    );
  });
});
