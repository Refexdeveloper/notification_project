'use strict';

const { extractBearerToken, verifyPlatformToken } = require('./platformToken');
const { loadPlatformUserByEmail, normalizeRole } = require('./platformUsers');

async function resolveSession(req) {
  const bearer = extractBearerToken(req);
  if (bearer) {
    const payload = verifyPlatformToken(bearer);
    if (payload?.email) {
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
      return null;
    }
  }

  // IAP / Cloud Run identity is not enough for Admin UI login.
  // Keep as a soft hint only when explicitly enabled for service tooling.
  if (process.env.ALLOW_IAP_SESSION === 'true') {
    const iapEmail = req.headers['x-goog-authenticated-user-email'];
    if (typeof iapEmail === 'string' && iapEmail.includes(':')) {
      const email = iapEmail.split(':').pop();
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
    }
  }

  return null;
}

function requireSession(session) {
  return Boolean(session && session.email);
}

module.exports = { resolveSession, requireSession };
