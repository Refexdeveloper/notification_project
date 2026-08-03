'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { resolveSession } = require('../lib/session');
const { verifyPassword } = require('../lib/password');
const { signPlatformToken } = require('../lib/platformToken');
const {
  ensureBootstrapAdmin,
  loadPlatformUserByEmail,
  normalizeRole,
} = require('../lib/platformUsers');

const router = express.Router();

router.get('/session', async (req, res) => {
  try {
    const session = await resolveSession(req);
    if (!session) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
    }
    return ok(res, req.correlationId, session);
  } catch (err) {
    return fail(res, req.correlationId, 'SESSION_FAILED', err.message, 500, true);
  }
});

router.post('/login', async (req, res) => {
  try {
    await ensureBootstrapAdmin();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      return fail(res, req.correlationId, 'VALIDATION_FAILED', 'email and password are required', 400);
    }

    const user = await loadPlatformUserByEmail(email);
    if (!user || !user.is_active) {
      return fail(res, req.correlationId, 'INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }
    if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
      return fail(res, req.correlationId, 'INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    const role = normalizeRole(user.role) || 'VIEWER';
    const token = signPlatformToken({
      sub: user.id,
      email: user.email,
      role,
    });

    return ok(res, req.correlationId, {
      access_token: token,
      token_type: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role,
      },
    });
  } catch (err) {
    return fail(res, req.correlationId, 'LOGIN_FAILED', err.message, 500, true);
  }
});

router.post('/logout', (_req, res) => {
  return ok(res, _req.correlationId, { logged_out: true });
});

module.exports = router;
