'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderMisPendingSection,
  renderRmcMisUserRows,
  workflowStep,
} = require('../services/engagement-pipeline/scripts/mis-pending-detail');

describe('existing MIS pending detail', () => {
  it('adds who raised the request, who it is pending with, and days pending', () => {
    const html = renderMisPendingSection([
      { raised_by: 'Meera Iyer', pending_with: 'Rahul Menon', pending_step: 'Manager Review', days_pending: 4 },
    ]);
    assert.match(html, /Raised by/);
    assert.match(html, /Pending with/);
    assert.match(html, /Pending at/);
    assert.match(html, /Manager Review/);
    assert.match(html, /Days pending/);
    assert.match(html, /Meera Iyer/);
    assert.match(html, /Rahul Menon/);
    assert.match(html, />4</);
  });

  it('leaves the MIS section unchanged when nothing is pending', () => {
    assert.equal(renderMisPendingSection([]), '');
  });

  it('puts raised by, the workflow step, and days on the same user row', () => {
    assert.equal(workflowStep('["Local Conveyance"]'), '');
    assert.equal(workflowStep('L1 Manager Approval'), 'L1 Manager Approval');
    const html = renderRmcMisUserRows(
      [{ user_name: 'Anil S Kulkarni', last_sign_in: '2026-10-17 09:58', pending_count: 2, completed_count: 0 }],
      [
        {
          raised_by: 'Rakesh Kumar Gupta',
          pending_with: 'Anil S Kulkarni',
          pending_step: 'L1 Manager Approval',
          days_pending: 12,
        },
        {
          raised_by: 'SACHIN JARE',
          pending_with: 'Anil S Kulkarni',
          pending_step: '["Local Conveyance"]',
          days_pending: 8,
        },
      ],
      '2026-10-17',
      'pending_with',
    );
    assert.match(html, /Rakesh Kumar Gupta/);
    assert.match(html, /SACHIN JARE/);
    assert.match(html, /Anil S Kulkarni/);
    assert.doesNotMatch(html, /Raised by /);
    assert.match(html, /L1 Manager Approval/);
    assert.doesNotMatch(html, /Local Conveyance/);
    assert.match(html, />12</);
    assert.match(html, />8</);
    assert.equal((html.match(/<tr /g) || []).length, 2);
  });
});
