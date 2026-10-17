'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const {
  listDatabaseApplications,
  listDatabaseItems,
  normalizeEnvironment,
} = require('../lib/databaseExplorer');

const router = express.Router();

function dbNotConfigured(res, correlationId) {
  return ok(res, correlationId, {
    items: [],
    count: 0,
    warning: 'DATABASE_NOT_CONFIGURED',
    hint: 'PostgreSQL is not configured on this service.',
  });
}

router.get('/applications', async (req, res) => {
  if (!isDatabaseConfigured()) return dbNotConfigured(res, req.correlationId);
  const environment = normalizeEnvironment(req.query.environment || 'production');
  try {
    const payload = await listDatabaseApplications(getPool(), { environment });
    return ok(res, req.correlationId, payload);
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, {
        items: [],
        count: 0,
        warning: 'SCHEMA_NOT_MIGRATED',
      });
    }
    if (err.code === '57014' || /statement timeout/i.test(String(err.message || ''))) {
      return fail(res, req.correlationId, 'DATABASE_TIMEOUT', 'Database catalog timed out', 504, true);
    }
    return fail(res, req.correlationId, 'DATABASE_APPS_FAILED', err.message, 500, true);
  }
});

router.get('/applications/:applicationId/items', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, {
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      warning: 'DATABASE_NOT_CONFIGURED',
    });
  }
  try {
    const payload = await listDatabaseItems(getPool(), {
      environment: req.query.environment || 'production',
      applicationId: req.params.applicationId,
      processId: req.query.process_id || req.query.processId || '',
      search: req.query.search || req.query.q || '',
      status: req.query.status || '',
      entity: req.query.entity || '',
      source: req.query.source || req.query.row_source || '',
      page: req.query.page,
      pageSize: req.query.page_size || req.query.pageSize || req.query.limit,
    });
    return ok(res, req.correlationId, payload);
  } catch (err) {
    if (err.code === 'APP_ID_REQUIRED') {
      return fail(res, req.correlationId, 'APP_ID_REQUIRED', err.message, 400);
    }
    if (err.code === '42P01') {
      return ok(res, req.correlationId, {
        items: [],
        total: 0,
        page: 1,
        warning: 'SCHEMA_NOT_MIGRATED',
      });
    }
    if (err.code === '57014' || /statement timeout/i.test(String(err.message || ''))) {
      return fail(res, req.correlationId, 'DATABASE_TIMEOUT', 'Database page timed out — try a smaller page size', 504, true);
    }
    return fail(res, req.correlationId, 'DATABASE_ITEMS_FAILED', err.message, 500, true);
  }
});

module.exports = router;
