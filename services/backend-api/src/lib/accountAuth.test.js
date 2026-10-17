'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashResetToken } = require('./passwordReset');
const { resolveUiOrigin, allowedUiOrigins } = require('./uiOrigins');
const { isValidEmailAddress, normalizeEmailAddress } = require('./platformUsers');
const { createOauthState, readOauthState } = require('./googleOauth');

test('reset tokens are hashed, not stored raw', () => {
  const token = 'abc123';
  const hashed = hashResetToken(token);
  assert.notEqual(hashed, token);
  assert.equal(hashed, hashResetToken(token));
  assert.notEqual(hashed, hashResetToken('other'));
});

test('UI origins stay on Notification Engine hosts', () => {
  assert.ok(allowedUiOrigins().includes('https://refex-admin-ui-dhwffeu7pq-el.a.run.app'));
  assert.equal(
    resolveUiOrigin('https://evil.example/login'),
    'https://refex-admin-ui-dhwffeu7pq-el.a.run.app',
  );
  assert.equal(resolveUiOrigin('http://localhost:5173'), 'http://localhost:5173');
});

test('email edit accepts only real addresses', () => {
  assert.equal(normalizeEmailAddress('  Aasik@Refex.co.in '), 'aasik@refex.co.in');
  assert.equal(isValidEmailAddress('aasik@refex.co.in'), true);
  assert.equal(isValidEmailAddress('aasik'), false);
});

test('Google OAuth state cannot be reused as a login token kind', () => {
  const state = createOauthState('https://refex-admin-ui-dhwffeu7pq-el.a.run.app', 'https://example/callback');
  const parsed = readOauthState(state);
  assert.equal(parsed.kind, 'google_oauth');
  assert.equal(parsed.ui, 'https://refex-admin-ui-dhwffeu7pq-el.a.run.app');
  assert.equal(readOauthState('not-a-token'), null);
});
