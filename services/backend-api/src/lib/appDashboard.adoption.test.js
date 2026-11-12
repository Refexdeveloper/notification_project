'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rosterSignInEngagement } = require('./appDashboard');

test('adoption counts come from the same roster as Users', () => {
  const now = new Date().toISOString();
  const roster = [
    { user_id: 'a', last_sign_in: now, ever_logged_in: true },
    { user_id: 'b', last_sign_in: now, ever_logged_in: true },
    { user_id: 'c', last_sign_in: '2025-01-10T05:00:00Z', ever_logged_in: true },
    { user_id: 'd', last_sign_in: null, ever_logged_in: false },
  ];
  // Cache said 17 signed in today for a 4-user roster — must not leak through.
  const e = rosterSignInEngagement(roster, { total_users: 4, active_today: 17, never_logged_in: 0 });
  assert.equal(e.total_users, 4);
  assert.equal(e.active_today, 2);
  assert.equal(e.never_logged_in, 1);
  assert.equal(e.inactive, 1);
  assert.equal(e.sign_in_rate_today, 50);
  assert.equal(e.sign_in_rate_overall, 75);
});

test('empty roster keeps fallback but never over 100%', () => {
  const e = rosterSignInEngagement([], { total_users: 16, active_today: 17, never_logged_in: 1 });
  assert.equal(e.total_users, 16);
  assert.equal(e.active_today, 16);
  assert.ok(e.sign_in_rate_today <= 100);
  assert.equal(e.sign_in_rate_overall, 94);
});
