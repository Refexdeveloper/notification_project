'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isRmcWebsite,
  isRmcRilLead,
  isRmcLeadSchedule,
  leadRequestFromRecord,
  summarizeRequests,
  renderRequestTableHtml,
  rmcLeadSubject,
  RMC_LEAD_REPORT_NAME,
} = require('../services/engagement-pipeline/scripts/rmc-lead-scope');

describe('RMC Lead Management scope', () => {
  it('requires Form/Website RMC and entity code RIL_RMC together', () => {
    const match = {
      Website_and_form: 'RMC',
      Entity_Code: 'RIL_RMC',
      Entity: { Name: 'Refex' },
    };
    assert.equal(isRmcRilLead(match), true);
    assert.equal(isRmcRilLead({ Website_and_form: 'RMC', Entity_Code: 'RIL_REF' }), false);
    assert.equal(isRmcRilLead({ Website_and_form: 'Modepro', Entity_Code: 'RIL_RMC' }), false);
    assert.equal(isRmcWebsite({ Website: { Name: 'RMC' } }), true);
    assert.equal(isRmcWebsite({ Website_and_form: 'Refex Mobility' }), false);
  });

  it('opens the RMC layout only for that website and entity schedule', () => {
    assert.equal(isRmcLeadSchedule('RMC', 'RIL_RMC'), true);
    assert.equal(isRmcLeadSchedule('rmc', 'ril_rmc'), true);
    assert.equal(isRmcLeadSchedule('RMC', ''), false);
    assert.equal(isRmcLeadSchedule('Modepro', 'RIL_RMC'), false);
  });

  it('shows who created the request, who it is pending with, and SLA days', () => {
    const now = new Date('2026-10-17T04:30:00Z');
    const pending = leadRequestFromRecord({
      Name: 'LD-2401',
      Website_and_form: 'RMC',
      Entity_Code: 'RIL_RMC',
      Requester: { Name: 'Meera Iyer' },
      Lead_Status: 'Open',
      _created_at: '2026-10-13T04:30:00Z',
      _current_step: 'Sales Manager Review',
      _current_assigned_to: [{ Name: 'Rahul Menon' }],
    }, now);
    assert.equal(pending.raisedBy, 'Meera Iyer');
    assert.equal(pending.pendingWith, 'Rahul Menon');
    assert.equal(pending.pendingAt, 'Sales Manager Review');
    assert.equal(pending.slaDays, '4');
    assert.equal(pending.completed, false);

    const done = leadRequestFromRecord({
      Name: 'LD-2412',
      Lead_Status: 'Closed',
      Requester: { Name: 'Kavya Nair' },
      _created_at: '2026-10-10T04:30:00Z',
      _completed_at: '2026-10-16T04:30:00Z',
      Assigned_To: { Name: 'Priya Sharma' },
    }, now);
    assert.equal(done.completed, true);
    assert.equal(done.pendingWith, '—');
    assert.equal(done.slaDays, '6');
    assert.deepEqual(summarizeRequests([pending, done]), { total: 2, completed: 1, pending: 1 });
  });

  it('names the report and subject with today\'s date', () => {
    const subject = rmcLeadSubject(new Date('2026-10-17T04:30:00Z'));
    assert.equal(RMC_LEAD_REPORT_NAME, 'RMC - Lead Management - Report');
    assert.equal(subject, 'RMC - Lead Management - Report (17-Oct-2026)');
  });
});
