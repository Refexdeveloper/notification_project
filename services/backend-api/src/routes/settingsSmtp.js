'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { resolveSession } = require('../lib/session');
const { isAdminRole } = require('../lib/platformUsers');
const {
  gcpProject,
  readGcpSecret,
  addGcpSecretVersion,
  refreshScheduleRunnerSecrets,
} = require('../lib/gcpSecrets');

const router = express.Router();

const SMTP_USER_SECRET =
  process.env.SMTP_USER_SECRET || 'engagement-report-smtp-user';
const SMTP_APP_PASSWORD_SECRET =
  process.env.SMTP_APP_PASSWORD_SECRET || 'engagement-report-smtp-app-password';

async function requireAdmin(req, res) {
  const session = await resolveSession(req);
  if (!session) {
    fail(res, req.correlationId, 'UNAUTHENTICATED', 'Sign in required', 401);
    return null;
  }
  // Never allow the open Continue/dev stub to read or rotate SMTP secrets in production.
  if (process.env.NODE_ENV === 'production' && session.source === 'dev_stub') {
    fail(res, req.correlationId, 'UNAUTHENTICATED', 'Sign in with an Admin account to manage email settings', 401);
    return null;
  }
  if (!isAdminRole(session.role)) {
    fail(res, req.correlationId, 'FORBIDDEN', 'Only Admin users can manage email settings', 403);
    return null;
  }
  return session;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

router.get('/smtp', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const envUser = String(process.env.SMTP_USER || process.env.SMTP_FROM || '').trim();
    const smtpUser = (await readGcpSecret(SMTP_USER_SECRET)) || envUser;
    const envPassword = String(process.env.SMTP_APP_PASSWORD || '').trim();
    const secretPassword = await readGcpSecret(SMTP_APP_PASSWORD_SECRET);
    const passwordConfigured = Boolean(secretPassword || envPassword);

    return ok(res, req.correlationId, {
      smtp_user: smtpUser || '',
      password_configured: passwordConfigured,
      host: 'smtp.gmail.com',
      port: 465,
      secret_hints: {
        smtp_user: SMTP_USER_SECRET,
        app_password: SMTP_APP_PASSWORD_SECRET,
        project: gcpProject(),
      },
      note: 'App password is never returned. Leave the password field blank when saving to keep the current one.',
    });
  } catch (err) {
    return fail(res, req.correlationId, 'SMTP_SETTINGS_LOAD_FAILED', err.message, 500, true);
  }
});

router.put('/smtp', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const body = req.body || {};
  const smtpUserRaw = body.smtp_user != null ? String(body.smtp_user).trim().toLowerCase() : null;
  const appPasswordRaw =
    body.app_password != null && String(body.app_password).trim()
      ? String(body.app_password).trim()
      : null;

  if (smtpUserRaw != null && smtpUserRaw && !isValidEmail(smtpUserRaw)) {
    return fail(res, req.correlationId, 'INVALID_SMTP_USER', 'SMTP login must be a valid email', 400);
  }
  if (smtpUserRaw == null && appPasswordRaw == null) {
    return fail(
      res,
      req.correlationId,
      'NO_CHANGES',
      'Provide smtp_user and/or app_password to update',
      400,
    );
  }

  try {
    const updates = [];
    if (smtpUserRaw != null && smtpUserRaw) {
      const result = await addGcpSecretVersion(SMTP_USER_SECRET, smtpUserRaw);
      updates.push({ secret: SMTP_USER_SECRET, version: result.name });
      process.env.SMTP_USER = smtpUserRaw;
    }
    if (appPasswordRaw) {
      // Gmail app passwords are often shown with spaces — strip them.
      const normalized = appPasswordRaw.replace(/\s+/g, '');
      if (normalized.length < 8) {
        return fail(
          res,
          req.correlationId,
          'INVALID_APP_PASSWORD',
          'App password looks too short',
          400,
        );
      }
      const result = await addGcpSecretVersion(SMTP_APP_PASSWORD_SECRET, normalized);
      updates.push({ secret: SMTP_APP_PASSWORD_SECRET, version: result.name });
      process.env.SMTP_APP_PASSWORD = normalized;
    }

    const refresh = await refreshScheduleRunnerSecrets();
    const smtpUser =
      smtpUserRaw ||
      (await readGcpSecret(SMTP_USER_SECRET)) ||
      String(process.env.SMTP_USER || '').trim();

    return ok(res, req.correlationId, {
      smtp_user: smtpUser || '',
      password_configured: true,
      updated: updates,
      schedule_runner_refreshed: Boolean(refresh.refreshed),
      warning: refresh.warning || null,
      secret_hints: {
        smtp_user: SMTP_USER_SECRET,
        app_password: SMTP_APP_PASSWORD_SECRET,
        project: gcpProject(),
      },
    });
  } catch (err) {
    return fail(
      res,
      req.correlationId,
      err.code || 'SMTP_SETTINGS_UPDATE_FAILED',
      err.message,
      err.status || 500,
      true,
    );
  }
});

module.exports = router;
