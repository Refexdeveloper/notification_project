'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { isDatabaseConfigured } = require('../lib/db');
const { resolveSession } = require('../lib/session');
const { normalizeEnvironment } = require('../lib/kissflowClient');
const { runIncrementalSyncAll } = require('../lib/incrementalSync');

const router = express.Router();

function authorizeCronOrSession(req) {
  const cronToken = process.env.INCREMENTAL_SYNC_TOKEN || '';
  const headerToken = String(req.headers['x-sync-token'] || req.query.token || '').trim();
  if (cronToken && headerToken && headerToken === cronToken) {
    return { ok: true, source: 'cron_token' };
  }
  return null;
}

/**
 * POST /api/v1/ops/incremental-sync
 * Hourly job: sync in-progress + newly modified fields; refresh stale engagement caches.
 */
router.post('/incremental-sync', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const cronAuth = authorizeCronOrSession(req);
  if (!cronAuth) {
    try {
      const session = await resolveSession(req);
      if (!session) {
        return fail(res, req.correlationId, 'UNAUTHENTICATED', 'Session or sync token required', 401);
      }
    } catch (err) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', err.message, 401);
    }
  }

  const environment = normalizeEnvironment(
    req.query.environment || req.body?.environment || 'production',
  );
  const refreshEngagement = req.body?.refresh_engagement !== false;
  const force = req.body?.force === true || String(req.query.force || '') === 'true';

  try {
    const result = await runIncrementalSyncAll({ environment, refreshEngagement, force });
    return ok(res, req.correlationId, result);
  } catch (err) {
    return fail(res, req.correlationId, 'INCREMENTAL_SYNC_FAILED', err.message, 500, true);
  }
});

module.exports = router;
