'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isLeadDraftItem,
  isCountableLeadForReport,
  filterLeadsForReport,
  istDateKey,
  currentFyBounds,
  currentIndianFyStartYear,
} = require('../archive/prototype-mysql-api/services/leadReportService');

const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const thisFy = `${todayIst}T10:00:00+05:30`;
const lastFy = '2024-02-01T10:00:00+05:30';

describe('lead report counts match dashboard scope', () => {
  it('drops drafts that the dashboard inventory also drops', () => {
    const draft = {
      _id: 'd1',
      Website_and_form: '3iMedtech',
      _created_at: thisFy,
      _status: 'Draft',
      Lead_Status: 'Open',
    };
    assert.equal(isLeadDraftItem(draft), true);
    assert.equal(isCountableLeadForReport(draft, '3iMedtech'), false);
  });

  it('does not count a lead that only has Requested_Date in FY (dashboard uses _created_at)', () => {
    const lead = {
      _id: 'x1',
      Website_and_form: '3iMedtech',
      Requested_Date: thisFy,
      Lead_Status: 'Open',
    };
    assert.equal(isCountableLeadForReport(lead, '3iMedtech'), false);
  });

  it('counts a live FY 3iMedtech lead', () => {
    const lead = {
      _id: 'ok',
      Website_and_form: '3iMedtech',
      _created_at: thisFy,
      Lead_Status: 'Open',
    };
    assert.equal(isCountableLeadForReport(lead, '3iMedtech'), true);
  });

  it('reads _created_at from Kissflow {v} objects', () => {
    const lead = {
      _id: 'ok3',
      Website_and_form: '3iMedtech',
      _created_at: { v: thisFy },
      Lead_Status: 'Open',
    };
    assert.equal(isCountableLeadForReport(lead, '3iMedtech'), true);
  });

  it('reads website from Kissflow {v} objects', () => {
    const lead = {
      _id: 'ok2',
      Website_and_form: { v: '3iMedtech' },
      _created_at: thisFy,
      Lead_Status: 'Open',
    };
    assert.equal(isCountableLeadForReport(lead, '3iMedtech'), true);
  });

  it('dedupes the same Kissflow id and ignores last FY', () => {
    const rows = filterLeadsForReport(
      [
        { _id: 'a', Website_and_form: '3iMedtech', _created_at: thisFy, Lead_Status: 'Open' },
        { _id: 'a', Website_and_form: '3iMedtech', _created_at: thisFy, Lead_Status: 'Open' },
        { _id: 'b', Website_and_form: '3iMedtech', _created_at: lastFy, Lead_Status: 'Open' },
        { _id: 'c', Website_and_form: 'Modepro', _created_at: thisFy, Lead_Status: 'Open' },
      ],
      '3iMedtech',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]._id, 'a');
  });

  it('IST days are zero-padded YYYY-MM-DD so June stays in FY in October', () => {
    assert.equal(istDateKey(new Date('2026-06-02T09:07:03Z')), '2026-06-02');
    assert.equal(istDateKey(new Date('2026-10-01T00:00:00+05:30')), '2026-10-01');
    const june = '2026-06-02';
    assert.equal(june >= '2026-04-01' && june <= '2026-10-01', true);
    assert.equal('2026-6-2' <= '2026-10-01', false);
  });

  it('FY bounds match other emails (YYYY-MM-DD) and reject Cloud Run 10/1/2026', () => {
    const { from, to } = currentFyBounds();
    assert.match(from, /^\d{4}-04-01$/);
    assert.match(to, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(to.includes('/'), false);
    assert.equal(Number.isNaN(Number(from.slice(0, 4))), false);
    assert.equal(currentIndianFyStartYear('10/1/2026'), currentIndianFyStartYear());
    assert.equal(currentIndianFyStartYear('2026-10-01'), 2026);
    assert.equal(currentIndianFyStartYear('2026-03-31'), 2025);
  });
});
