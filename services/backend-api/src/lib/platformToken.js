'use strict';

const crypto = require('crypto');

const TOKEN_TTL_SECONDS = Number(process.env.PLATFORM_TOKEN_TTL_SECONDS || 60 * 60 * 12); // 12h

function sessionSecret() {
  return (
    process.env.PLATFORM_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    'refex-dev-platform-session-secret-change-me'
  );
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64').toString('utf8');
}

function signPlatformToken(payload) {
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', sessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyPlatformToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try {
    body = JSON.parse(fromBase64url(encoded));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  if (typeof body.exp !== 'number' || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

module.exports = {
  signPlatformToken,
  verifyPlatformToken,
  extractBearerToken,
  TOKEN_TTL_SECONDS,
};
