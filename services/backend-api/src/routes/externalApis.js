'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { resolveSession } = require('../lib/session');
const { extractBearerToken, verifyPlatformToken } = require('../lib/platformToken');
const { isAdminRole } = require('../lib/platformUsers');
const { EXTERNAL_API_SERVICES, listExternalApiLogs } = require('../lib/externalApiLogs');
const { loadKeywordMatchDatabase } = require('../lib/keywordMatchDb');

const router = express.Router();

function sessionFromAdminToken(req) {
  const bearer = extractBearerToken(req);
  if (!bearer || bearer === 'backend-session') return null;
  const payload = verifyPlatformToken(bearer);
  if (!payload?.email || String(payload.role || '').toUpperCase() !== 'ADMIN') return null;
  return {
    subject: `platform:${payload.email}`,
    email: payload.email,
    display_name: payload.email.split('@')[0],
    role: 'ADMIN',
    source: 'platform',
  };
}

async function requireAdmin(req, res) {
  let session = await resolveSession(req);
  if (!session) {
    fail(res, req.correlationId, 'UNAUTHENTICATED', 'Sign in required', 401);
    return null;
  }
  if (process.env.NODE_ENV === 'production' && session.source === 'dev_stub') {
    const admin = sessionFromAdminToken(req);
    const bearer = extractBearerToken(req);
    const signedInAdmin = Boolean(bearer && bearer !== 'backend-session' && isAdminRole(session.role));
    if (admin) {
      session = admin;
    } else if (!signedInAdmin) {
      fail(res, req.correlationId, 'UNAUTHENTICATED', 'Sign in with an Admin account to view external APIs', 401);
      return null;
    }
  }
  if (!isAdminRole(session.role)) {
    fail(res, req.correlationId, 'FORBIDDEN', 'Only Admin users can view external API logs', 403);
    return null;
  }
  return session;
}

router.get('/', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const apis = Object.entries(EXTERNAL_API_SERVICES).map(([id, service]) => ({ id, service }));
  return ok(res, req.correlationId, { apis });
});

router.get('/keyword-matching/database', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const result = await loadKeywordMatchDatabase();
    return ok(res, req.correlationId, result);
  } catch (err) {
    const status = Number(err.status) || 502;
    return fail(res, req.correlationId, 'KEYWORD_DB_FAILED', err.message || 'Could not load the keyword database', status, true);
  }
});

router.get('/:id/logs', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = String(req.params.id || '').trim();
  if (!EXTERNAL_API_SERVICES[id]) {
    return fail(res, req.correlationId, 'NOT_FOUND', 'Unknown external API', 404);
  }
  try {
    const result = await listExternalApiLogs(id);
    return ok(res, req.correlationId, result);
  } catch (err) {
    const status = Number(err.status) || 502;
    return fail(res, req.correlationId, 'EXTERNAL_API_LOGS_FAILED', err.message || 'Could not load API logs', status, true);
  }
});

module.exports = router;
