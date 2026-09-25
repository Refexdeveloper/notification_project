'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { DEFAULT_REPORT_TIMEZONE } = require('../lib/reportTimezone');
const { loadApplicationDashboard } = require('../lib/appDashboard');
const { loadDashboardOverview } = require('../lib/dashboardOverview');
const { refreshDashboardLive } = require('../lib/dashboardRefresh');
const { resolveSession } = require('../lib/session');
const { isP2pApplication, loadP2pDashboard } = require('../lib/p2pDashboard');
const { loadApplicationRecords } = require('../lib/appRecords');

const router = express.Router();

function normalizeEnvironment(value) {
  const lower = String(value || 'production').toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower;
}

/** Strip route prefix (production-ITSM_A00 → ITSM_A00). */
function normalizeRouteApplicationId(applicationId) {
  const id = String(applicationId || '').trim();
  const m = id.match(/^(?:production|development|uat|staging)-(.+)$/i);
  return m ? m[1] : id;
}

/**
 * Main dashboard — PostgreSQL snapshot + engagement_cache overlay when fresher.
 * POST /refresh triggers related-user live pull (not full directory / not full email ingest).
 */
router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, {
      applications: [],
      recent_sends: [],
      warning: 'DATABASE_NOT_CONFIGURED',
    });
  }

  const environment = normalizeEnvironment(req.query.environment);
  const askedLive = String(req.query.refresh || '').toLowerCase() === 'live';

  try {
    const pool = getPool();
    const applications = await loadDashboardOverview(pool, environment);
    const warnings = [];
    if (askedLive) {
      warnings.push(
        'Use POST /api/v1/dashboard/refresh for live overlay (related app users + item counts). GET stays fast from PostgreSQL.',
      );
    }

    return ok(res, req.correlationId, {
      environment,
      applications,
      recent_sends: [],
      generated_at: new Date().toISOString(),
      refresh_mode: applications.some((a) => a.data_source === 'live_overlay') ? 'live_overlay' : 'snapshot',
      timezone: DEFAULT_REPORT_TIMEZONE,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { applications: [], recent_sends: [], warning: 'SCHEMA_NOT_MIGRATED' });
    }
    if (err.code === '57014' || /statement timeout/i.test(String(err.message || ''))) {
      return fail(
        res,
        req.correlationId,
        'DASHBOARD_TIMEOUT',
        'Dashboard query timed out — try again in a moment',
        504,
        true,
      );
    }
    return fail(res, req.correlationId, 'DASHBOARD_FAILED', err.message, 500, true);
  }
});

/**
 * Soft live refresh — related application users + live item counts.
 * Persists engagement_cache; updates last_sign_in on existing user rows.
 */
router.post('/refresh', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  try {
    const session = await resolveSession(req);
    if (!session) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', 'Session required', 401);
    }
  } catch (err) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', err.message, 401);
  }

  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  const applicationId = String(
    req.query.application_id || req.query.applicationId || req.body?.application_id || req.body?.applicationId || '',
  ).trim();

  try {
    const liveKissflow = String(req.query.live || req.body?.live || '').toLowerCase() === '1'
      || req.body?.live === true
      || String(req.query.refresh || '').toLowerCase() === 'live';
    const payload = await refreshDashboardLive({
      environment,
      applicationId: applicationId || undefined,
      persist: true,
      live: liveKissflow,
    });
    return ok(res, req.correlationId, {
      ...payload,
      timezone: DEFAULT_REPORT_TIMEZONE,
    });
  } catch (err) {
    if (err.code === '57014' || /statement timeout/i.test(String(err.message || ''))) {
      return fail(res, req.correlationId, 'DASHBOARD_REFRESH_TIMEOUT', 'Live refresh timed out', 504, true);
    }
    return fail(res, req.correlationId, 'DASHBOARD_REFRESH_FAILED', err.message, 500, true);
  }
});

/** Per-application report-style dashboard with optional entity / process / resource filters. */
router.get('/application/:applicationId', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment);
  const applicationId = normalizeRouteApplicationId(req.params.applicationId);
  if (!applicationId) {
    return fail(res, req.correlationId, 'APP_ID_REQUIRED', 'applicationId is required', 400);
  }

  // Procurement to Pay — direct MySQL read-only (never Kissflow / never writes).
  if (isP2pApplication(applicationId)) {
    try {
      const payload = await loadP2pDashboard({
        environment,
        period: req.query.period,
        entity: req.query.entity,
        dateFrom: req.query.date_from || req.query.dateFrom,
        dateTo: req.query.date_to || req.query.dateTo,
      });
      return ok(res, req.correlationId, {
        ...payload,
        generated_at: new Date().toISOString(),
        timezone: DEFAULT_REPORT_TIMEZONE,
      });
    } catch (err) {
      return fail(res, req.correlationId, err.code || 'P2P_DASHBOARD_FAILED', err.message, 500, true);
    }
  }

  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, {
      warning: 'DATABASE_NOT_CONFIGURED',
      metrics: { total: 0, pending: 0, completed: 0, rejected: 0 },
      by_process: [],
      users: [],
      entities: [],
    });
  }

  try {
    const pool = getPool();
    const client = await pool.connect();
    let payload;
    try {
      const forceFullSql = req.query.full === '1';
      const preferCache = !forceFullSql && req.query.fast !== '0';
      const timeoutMs = preferCache ? 25000 : 90000;
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
      payload = await loadApplicationDashboard(client, {
        environment,
        applicationId,
        entity: req.query.entity,
        user: req.query.user || req.query.assignee,
        processId: req.query.process_id || req.query.processId,
        resourceType: req.query.resource_type || req.query.resourceType,
        resourceId: req.query.resource_id || req.query.resourceId,
        period: req.query.period,
        dateFrom: req.query.date_from || req.query.dateFrom || req.query.from,
        dateTo: req.query.date_to || req.query.dateTo || req.query.to,
        preferCache,
        allowStaleCache: req.query.stale !== '0',
        forceFullSql,
      });
    } finally {
      client.release();
    }
    return ok(res, req.correlationId, {
      ...payload,
      generated_at: new Date().toISOString(),
      timezone: DEFAULT_REPORT_TIMEZONE,
    });
  } catch (err) {
    if (err.code === 'APP_NOT_FOUND') {
      return fail(res, req.correlationId, 'APP_NOT_FOUND', err.message, 404);
    }
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { warning: 'SCHEMA_NOT_MIGRATED', by_process: [], users: [], entities: [] });
    }
    if (err.code === '57014' || /statement timeout/i.test(String(err.message || ''))) {
      return fail(res, req.correlationId, 'APP_DASHBOARD_TIMEOUT', 'App dashboard timed out', 504, true);
    }
    return fail(res, req.correlationId, 'APP_DASHBOARD_FAILED', err.message, 500, true);
  }
});

/** CEO records list — request id, assignee, requester, status (paginated). */
router.get('/application/:applicationId/records', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment);
  const applicationId = normalizeRouteApplicationId(req.params.applicationId);
  if (!applicationId) {
    return fail(res, req.correlationId, 'APP_ID_REQUIRED', 'applicationId is required', 400);
  }

  try {
    if (isP2pApplication(applicationId)) {
      const payload = await loadApplicationRecords(null, {
        applicationId,
        environment,
        entity: req.query.entity,
        status: req.query.status,
        search: req.query.search || req.query.q,
        assigned: req.query.assigned || req.query.assigned_to,
        requester: req.query.requester || req.query.requested_by,
        dateFrom: req.query.date_from || req.query.dateFrom || req.query.from,
        dateTo: req.query.date_to || req.query.dateTo || req.query.to,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return ok(res, req.correlationId, {
        ...payload,
        generated_at: new Date().toISOString(),
        timezone: DEFAULT_REPORT_TIMEZONE,
      });
    }

    if (!isDatabaseConfigured()) {
      return ok(res, req.correlationId, {
        warning: 'DATABASE_NOT_CONFIGURED',
        items: [],
        total: 0,
        columns: [],
      });
    }

    const pool = getPool();
    const payload = await loadApplicationRecords(pool, {
      applicationId,
      environment,
      entity: req.query.entity,
      status: req.query.status,
      search: req.query.search || req.query.q,
      assigned: req.query.assigned || req.query.assigned_to,
      requester: req.query.requester || req.query.requested_by,
      dateFrom: req.query.date_from || req.query.dateFrom || req.query.from,
      dateTo: req.query.date_to || req.query.dateTo || req.query.to,
      limit: req.query.limit,
      offset: req.query.offset,
      forceLive: req.query.force_live === '1' || req.query.live === '1',
      inventory: req.query.inventory === '1' || req.query.inventory === 'true',
    });
    return ok(res, req.correlationId, {
      ...payload,
      generated_at: payload.generated_at || new Date().toISOString(),
      timezone: DEFAULT_REPORT_TIMEZONE,
    });
  } catch (err) {
    if (err.code === 'APP_NOT_FOUND') {
      return fail(res, req.correlationId, 'APP_NOT_FOUND', err.message, 404);
    }
    if (err.code === '57014' || /statement timeout/i.test(String(err.message || ''))) {
      return fail(res, req.correlationId, 'RECORDS_TIMEOUT', 'Records query timed out — try Refresh again', 504, true);
    }
    return fail(res, req.correlationId, err.code || 'APP_RECORDS_FAILED', err.message, 500, true);
  }
});

module.exports = router;
