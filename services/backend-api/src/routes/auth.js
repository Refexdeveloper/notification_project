'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');

const router = express.Router();

function resolveSession(req) {
  const iapEmail = req.headers['x-goog-authenticated-user-email'];
  if (typeof iapEmail === 'string' && iapEmail.includes(':')) {
    const email = iapEmail.split(':').pop();
    return {
      subject: iapEmail,
      email,
      display_name: email.split('@')[0],
      role: 'OPERATOR',
      source: 'iap',
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    return {
      subject: `dev:${process.env.DEV_AUTH_EMAIL || 'dev@refex.co.in'}`,
      email: process.env.DEV_AUTH_EMAIL || 'dev@refex.co.in',
      display_name: process.env.DEV_AUTH_NAME || 'Dev Operator',
      role: process.env.DEV_AUTH_ROLE || 'ADMIN',
      source: 'dev_stub',
    };
  }

  return null;
}

router.get('/session', (req, res) => {
  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }
  ok(res, req.correlationId, session);
});

module.exports = router;
