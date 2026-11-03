'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { asEmailList, fromDisplayName, parseSendRequest } = require('./mail');

describe('parseSendRequest', () => {
  it('accepts to/cc strings and html', () => {
    const parsed = parseSendRequest({
      to: 'itsupport@extrovis.com',
      cc: 'kishore.yepuri@extrovis.com, mohamedaasik.m@refex.co.in',
      subject: 'Tech Help Desk - New Comment Added | Ticket EXT-1',
      html: '<p>Hello</p>',
    });
    assert.deepEqual(parsed.to, ['itsupport@extrovis.com']);
    assert.deepEqual(parsed.cc, ['kishore.yepuri@extrovis.com']);
    assert.equal(parsed.displayFrom, 'itsupport@extrovis.com');
    assert.equal(parsed.replyTo, 'itsupport@extrovis.com');
  });

  it('uses replyTo only when the caller sends one', () => {
    const sap = parseSendRequest({
      to: 'vishnu.gullapally@extrovis.com',
      cc: 'kishore.yepuri@extrovis.com',
      from: 'itsupport@extrovis.com',
      replyTo: 'kishore.yepuri@extrovis.com',
      subject: 'S',
      html: '<p>x</p>',
    });
    assert.equal(sap.displayFrom, 'itsupport@extrovis.com');
    assert.equal(sap.replyTo, 'kishore.yepuri@extrovis.com');
    const both = parseSendRequest({
      to: ['tanuja.villa@bs.nttdata.com', 'anusha.shyamala@bs.nttdata.com'],
      replyTo: ['tanuja.villa@bs.nttdata.com', 'anusha.shyamala@bs.nttdata.com'],
      subject: 'S',
      html: '<p>x</p>',
    });
    assert.equal(both.replyTo, both.to.join(', '));
    assert.deepEqual(both.to, ['tanuja.villa@bs.nttdata.com', 'anusha.shyamala@bs.nttdata.com']);
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

describe('fromDisplayName', () => {
  it('names the mailbox by entity domain', () => {
    assert.equal(fromDisplayName('itsupport@modepro.com'), 'ModePro IT Support');
    assert.equal(fromDisplayName('itsupport@kavispharma.com'), 'Kavis Pharma IT Support');
    assert.equal(fromDisplayName('itsupport@extrovis.com'), 'Extrovis IT Support');
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
