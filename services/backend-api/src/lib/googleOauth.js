'use strict';

const { signPlatformToken, verifyPlatformToken } = require('./platformToken');
const { resolveUiOrigin } = require('./uiOrigins');
const { readGcpSecret } = require('./gcpSecrets');

async function loadGoogleOauthClient() {
  let id = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  let secret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  if (!id) id = await readGcpSecret(process.env.GOOGLE_OAUTH_CLIENT_ID_SECRET || 'engagement-report-google-oauth-client-id');
  if (!secret) {
    secret = await readGcpSecret(
      process.env.GOOGLE_OAUTH_CLIENT_SECRET_SECRET || 'engagement-report-google-oauth-client-secret',
    );
  }
  return { id: String(id || '').trim(), secret: String(secret || '').trim() };
}

function resolveUiOriginFromQuery(req) {
  return resolveUiOrigin(req.query.ui_origin || req.get('origin'));
}

function publicCallbackUrl(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}/api/v1/auth/google/callback`;
}

function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function createOauthState(uiOrigin, redirectUri) {
  return signPlatformToken({
    kind: 'google_oauth',
    ui: uiOrigin,
    redirect_uri: redirectUri,
  });
}

function readOauthState(state) {
  const payload = verifyPlatformToken(state);
  if (!payload || payload.kind !== 'google_oauth' || !payload.ui) return null;
  return payload;
}

async function exchangeGoogleCode({ code, redirectUri, clientId, clientSecret }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.id_token) {
    const err = new Error(tokenJson.error_description || tokenJson.error || 'Google token exchange failed');
    err.code = 'GOOGLE_TOKEN_FAILED';
    throw err;
  }
  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenJson.id_token)}`,
  );
  const info = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !info.email) {
    const err = new Error('Google did not return an email address');
    err.code = 'GOOGLE_EMAIL_MISSING';
    throw err;
  }
  if (info.aud && info.aud !== clientId) {
    const err = new Error('Google token was issued for a different application');
    err.code = 'GOOGLE_AUD_MISMATCH';
    throw err;
  }
  return {
    email: String(info.email).trim().toLowerCase(),
    name: String(info.name || info.email).trim(),
    emailVerified: info.email_verified === 'true' || info.email_verified === true,
  };
}

module.exports = {
  loadGoogleOauthClient,
  resolveUiOriginFromQuery,
  publicCallbackUrl,
  buildGoogleAuthUrl,
  createOauthState,
  readOauthState,
  exchangeGoogleCode,
};
