import { describe, expect, it } from 'vitest';
import {
  dedupeLeadItems,
  isCountableLeadForReport,
  isLeadDraftItem,
} from './leadReport';

const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const thisFy = `${todayIst}T10:00:00+05:30`;

describe('lead report dashboard parity', () => {
  it('excludes drafts', () => {
    const draft = {
      _id: 'd1',
      Website_and_form: '3iMedtech',
      _created_at: thisFy,
      _status: 'Draft',
    };
    expect(isLeadDraftItem(draft)).toBe(true);
    expect(isCountableLeadForReport(draft, '3iMedtech')).toBe(false);
  });

  it('requires _created_at in This FY like the dashboard', () => {
    expect(
      isCountableLeadForReport(
        { _id: '1', Website_and_form: '3iMedtech', Requested_Date: thisFy },
        '3iMedtech',
      ),
    ).toBe(false);
    expect(
      isCountableLeadForReport(
        { _id: '2', Website_and_form: '3iMedtech', _created_at: thisFy },
        '3iMedtech',
      ),
    ).toBe(true);
  });

  it('dedupes by Kissflow id', () => {
    const rows = dedupeLeadItems([
      { _id: 'a', Website_and_form: '3iMedtech' },
      { _id: 'a', Website_and_form: '3iMedtech' },
    ]);
    expect(rows).toHaveLength(1);
  });
});
