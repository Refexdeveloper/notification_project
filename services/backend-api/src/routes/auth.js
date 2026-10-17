'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { resolveSession } = require('../lib/session');
const { verifyPassword } = require('../lib/password');
const { signPlatformToken } = require('../lib/platformToken');
const {
  ensureBootstrapAdmin,
  ensureAasikAdmin,
  loadPlatformUserByLogin,
  loadPlatformUserByEmail,
  normalizeRole,
} = require('../lib/platformUsers');
const { requestPasswordReset, resetPasswordWithToken, resolveResetUiOrigin } = require('../lib/passwordReset');
const {
  loadGoogleOauthClient,
  resolveUiOriginFromQuery,
  publicCallbackUrl,
  buildGoogleAuthUrl,
  createOauthState,
  readOauthState,
  exchangeGoogleCode,
} = require('../lib/googleOauth');

function loginPayload(user) {
  const role = normalizeRole(user.role) || 'VIEWER';
  const token = signPlatformToken({
    sub: user.id,
    email: user.email,
    role,
  });
  return {
    access_token: token,
    token_type: 'Bearer',
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      role,
    },
  };
}

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
    await ensureAasikAdmin();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = String(body.email || body.username || '').trim();
    const password = String(body.password || '');

    if (!email || !password) {
      return fail(res, req.correlationId, 'VALIDATION_FAILED', 'username/email and password are required', 400);
    }

    const user = await loadPlatformUserByLogin(email);
    if (!user || !user.is_active) {
      return fail(res, req.correlationId, 'INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }
    if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
      return fail(res, req.correlationId, 'INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    return ok(res, req.correlationId, loginPayload(user));
  } catch (err) {
    return fail(res, req.correlationId, 'LOGIN_FAILED', err.message, 500, true);
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const login = String(body.email || body.username || '').trim();
    if (!login) {
      return fail(res, req.correlationId, 'VALIDATION_FAILED', 'username/email is required', 400);
    }
    await requestPasswordReset(login, resolveResetUiOrigin(req));
    return ok(res, req.correlationId, {
      queued: true,
      message: 'If this account exists, a reset link was sent to its email address.',
    });
  } catch (err) {
    if (err.code === 'SMTP_NOT_CONFIGURED' || err.code === 'DATABASE_NOT_CONFIGURED') {
      return fail(res, req.correlationId, err.code, 'Password reset email is not available. Ask your admin to reset it from Platform users.', 503, true);
    }
    return fail(res, req.correlationId, 'FORGOT_PASSWORD_FAILED', err.message, 500, true);
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    await resetPasswordWithToken(body.token, body.password);
    return ok(res, req.correlationId, { reset: true });
  } catch (err) {
    if (err.code === 'VALIDATION_FAILED' || err.code === 'RESET_TOKEN_INVALID') {
      return fail(res, req.correlationId, err.code, err.message, 400);
    }
    return fail(res, req.correlationId, 'RESET_PASSWORD_FAILED', err.message, 500, true);
  }
});

router.get('/google/start', async (req, res) => {
  const ui = resolveUiOriginFromQuery(req);
  try {
    const client = await loadGoogleOauthClient();
    if (!client.id || !client.secret) {
      return res.redirect(`${ui}/login?google_error=${encodeURIComponent('Google sign-in is not configured')}`);
    }
    const redirectUri = publicCallbackUrl(req);
    const state = createOauthState(ui, redirectUri);
    return res.redirect(buildGoogleAuthUrl({ clientId: client.id, redirectUri, state }));
  } catch (err) {
    return res.redirect(`${ui}/login?google_error=${encodeURIComponent(err.message || 'Google sign-in failed')}`);
  }
});

router.get('/google/callback', async (req, res) => {
  const fallbackUi = resolveUiOriginFromQuery(req);
  const state = readOauthState(String(req.query.state || ''));
  const ui = state?.ui || fallbackUi;
  try {
    if (req.query.error) {
      return res.redirect(`${ui}/login?google_error=${encodeURIComponent(String(req.query.error))}`);
    }
    if (!state) {
      return res.redirect(`${ui}/login?google_error=${encodeURIComponent('Google sign-in expired. Try again.')}`);
    }
    const client = await loadGoogleOauthClient();
    const profile = await exchangeGoogleCode({
      code: String(req.query.code || ''),
      redirectUri: state.redirect_uri || publicCallbackUrl(req),
      clientId: client.id,
      clientSecret: client.secret,
    });
    if (!profile.emailVerified) {
      return res.redirect(`${ui}/login?google_error=${encodeURIComponent('Google email is not verified')}`);
    }
    const user = await loadPlatformUserByEmail(profile.email);
    if (!user || !user.is_active) {
      return res.redirect(
        `${ui}/login?google_error=${encodeURIComponent('No Notification Engine account for this Google email. Ask an admin to add you.')}`,
      );
    }
    const payload = loginPayload(user);
    return res.redirect(`${ui}/login?google_token=${encodeURIComponent(payload.access_token)}`);
  } catch (err) {
    return res.redirect(`${ui}/login?google_error=${encodeURIComponent(err.message || 'Google sign-in failed')}`);
  }
});

router.post('/logout', (_req, res) => {
  return ok(res, _req.correlationId, { logged_out: true });
});

module.exports = router;
