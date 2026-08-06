'use strict';

const { extractBearerToken, verifyPlatformToken } = require('./platformToken');
const { loadPlatformUserByEmail, normalizeRole } = require('./platformUsers');

/**
 * Session resolution for Admin UI / API.
 * Preference: platform Bearer → IAP email → dev/stub (for Continue login / Kissflow embed).
 */
async function resolveSession(req) {
  const bearer = extractBearerToken(req);
  if (bearer && bearer !== 'backend-session') {
    const payload = verifyPlatformToken(bearer);
    if (payload?.email) {
      try {
        const row = await loadPlatformUserByEmail(payload.email);
        if (row && row.is_active) {
          return {
            subject: `platform:${row.email}`,
            email: row.email,
            display_name: row.display_name,
            role: normalizeRole(row.role) || 'VIEWER',
            source: 'platform',
            admin_user_id: row.id,
          };
        }
      } catch {
        /* fall through */
      }
    }
  }

  const iapEmail = req.headers['x-goog-authenticated-user-email'];
  if (typeof iapEmail === 'string' && iapEmail.includes(':')) {
    const email = iapEmail.split(':').pop();
    try {
      const row = await loadPlatformUserByEmail(email);
      if (row && row.is_active) {
        return {
          subject: iapEmail,
          email: row.email,
          display_name: row.display_name,
          role: normalizeRole(row.role) || 'VIEWER',
          source: 'iap',
          admin_user_id: row.id,
        };
      }
    } catch {
      /* use IAP email without platform user row */
    }
    return {
      subject: iapEmail,
      email,
      display_name: email.split('@')[0],
      role: 'ADMIN',
      source: 'iap',
    };
  }

  // No password validation path for Admin UI — Continue / embed uses stub when enabled.
  if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_AUTH_STUB === 'true') {
    return {
      subject: `dev:${process.env.DEV_AUTH_EMAIL || 'mohamedaasik.m@refex.co.in'}`,
      email: process.env.DEV_AUTH_EMAIL || 'mohamedaasik.m@refex.co.in',
      display_name: process.env.DEV_AUTH_NAME || 'Mohamed Asaik',
      role: process.env.DEV_AUTH_ROLE || 'ADMIN',
      source: 'dev_stub',
    };
  }

  return null;
}

function requireSession(session) {
  return Boolean(session && session.email);
}

module.exports = { resolveSession, requireSession };
