'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { normalizeEnvironment } = require('../lib/kissflowClient');
const { readFieldDiscovery } = require('../lib/fieldDiscovery');
const { syncProcessFields, mapFieldRow, PROCESS_QUERY } = require('../lib/fieldSyncService');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, { fields: [], count: 0, warning: 'DATABASE_NOT_CONFIGURED' });
  }

  try {
    const { rows } = await getPool().query(PROCESS_QUERY, [
      environment,
      req.params.applicationId,
      req.params.processId,
    ]);
    if (!rows.length) {
      return fail(res, req.correlationId, 'PROCESS_NOT_FOUND', 'Process not found for this application', 404);
    }

    const discovery = readFieldDiscovery(rows[0].source_payload);
    const fields = discovery.fields.map(mapFieldRow);
    return ok(res, req.correlationId, {
      process_id: rows[0].process_id,
      application_id: rows[0].application_id,
      environment,
      fields,
      count: fields.length,
      item_count: discovery.itemCount,
      sampled: discovery.sampled,
      synced_at: discovery.syncedAt,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { fields: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'FIELDS_LIST_FAILED', err.message, 500, true);
  }
});

router.post('/sync', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required for field sync', 503);
  }

  const pageSize = Math.min(Math.max(Number(req.body?.page_size) || 500, 1), 1000);
  const inProgressOnly = req.body?.in_progress_only !== false;
  const incremental = req.body?.incremental !== false;

  try {
    const result = await syncProcessFields(getPool(), {
      environment,
      applicationId: req.params.applicationId,
      processId: req.params.processId,
      pageSize,
      inProgressOnly,
      incremental,
    });
    return ok(res, req.correlationId, result);
  } catch (err) {
    if (err.code === 'PROCESS_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, 404);
    }
    if (err.code === 'ACCOUNT_ID_MISSING') {
      return fail(res, req.correlationId, err.code, err.message, 400);
    }
    if (err.code === 'KISSFLOW_CREDENTIALS_MISSING') {
      return fail(res, req.correlationId, err.code, err.message, 503);
    }
    if (err.status === 401 || err.status === 403) {
      return fail(res, req.correlationId, 'KISSFLOW_AUTH_FAILED', err.message, err.status);
    }
    if (err.code === '42P01') {
      return fail(res, req.correlationId, 'SCHEMA_NOT_MIGRATED', 'Database schema not migrated', 503);
    }
    return fail(res, req.correlationId, 'FIELD_SYNC_FAILED', err.message, 500, true);
  }
});

module.exports = router;
