'use strict';

const crypto = require('crypto');
const { getPool, isDatabaseConfigured } = require('./db');
const { hashPassword } = require('./password');
const { loadPlatformUserByLogin } = require('./platformUsers');
const { resolveUiOrigin } = require('./uiOrigins');
const { sendTransactionalMail } = require('./smtpTransactional');

const RESET_TTL_MS = 30 * 60 * 1000;

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function resolveResetUiOrigin(req) {
  return resolveUiOrigin(req.body?.ui_origin || req.query.ui_origin || req.get('origin'));
}

async function ensureResetColumns(client = getPool()) {
  await client.query(`
    ALTER TABLE engagement_reporting.admin_user
      ADD COLUMN IF NOT EXISTS password_reset_token_hash text,
      ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz
  `);
}

async function requestPasswordReset(login, uiOrigin) {
  if (!isDatabaseConfigured()) {
    const err = new Error('Database is not configured');
    err.code = 'DATABASE_NOT_CONFIGURED';
    throw err;
  }
  const user = await loadPlatformUserByLogin(login);
  if (!user || !user.is_active) return { queued: true };
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TTL_MS);
  await ensureResetColumns();
  await getPool().query(
    `UPDATE engagement_reporting.admin_user
     SET password_reset_token_hash = $2, password_reset_expires_at = $3
     WHERE admin_user_id = $1::uuid`,
    [user.id, hashResetToken(token), expires],
  );
  const resetUrl = `${uiOrigin}/reset-password?token=${encodeURIComponent(token)}`;
  await sendTransactionalMail({
    to: user.email,
    subject: 'Reset your Notification Engine password',
    text: `Reset your password using this link (valid for 30 minutes):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Reset your Notification Engine password using this link (valid for 30 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
  });
  return { queued: true };
}

async function resetPasswordWithToken(token, password) {
  if (!isDatabaseConfigured()) {
    const err = new Error('Database is not configured');
    err.code = 'DATABASE_NOT_CONFIGURED';
    throw err;
  }
  const raw = String(token || '').trim();
  const nextPassword = String(password || '');
  if (!raw || nextPassword.length < 8) {
    const err = new Error('A valid reset link and a password of at least 8 characters are required');
    err.code = 'VALIDATION_FAILED';
    throw err;
  }
  await ensureResetColumns();
  const { rows } = await getPool().query(
    `SELECT admin_user_id::text AS id
     FROM engagement_reporting.admin_user
     WHERE password_reset_token_hash = $1
       AND password_reset_expires_at > now()
       AND is_active = true
     LIMIT 1`,
    [hashResetToken(raw)],
  );
  if (!rows.length) {
    const err = new Error('This reset link is invalid or has expired');
    err.code = 'RESET_TOKEN_INVALID';
    throw err;
  }
  await getPool().query(
    `UPDATE engagement_reporting.admin_user
     SET password_hash = $2,
         password_reset_token_hash = NULL,
         password_reset_expires_at = NULL
     WHERE admin_user_id = $1::uuid`,
    [rows[0].id, hashPassword(nextPassword)],
  );
  return { reset: true };
}

module.exports = {
  hashResetToken,
  resolveResetUiOrigin,
  ensureResetColumns,
  requestPasswordReset,
  resetPasswordWithToken,
};
