'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router();

function dbNotConfigured(res, correlationId) {
  return ok(res, correlationId, {
    items: [],
    count: 0,
    warning: 'DATABASE_NOT_CONFIGURED',
    hint: 'Copy services/backend-api/.env.example to .env and set PGPASSWORD (or DATABASE_URL)',
  });
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }
  try {
    const { rows } = await getPool().query(
      `SELECT environment, application_id, application_name, last_seen_at, is_current
       FROM engagement_reporting.application
       WHERE is_current = true
       ORDER BY application_name`,
    );
    ok(res, req.correlationId, { items: rows, count: rows.length });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    if (err.code === 'DATABASE_NOT_CONFIGURED') {
      return dbNotConfigured(res, req.correlationId);
    }
    if (err.message?.includes('password must be a string') || err.code === 'ECONNREFUSED') {
      return ok(res, req.correlationId, {
        items: [],
        count: 0,
        warning: 'DATABASE_UNAVAILABLE',
        hint: err.message,
      });
    }
    fail(res, req.correlationId, 'APPLICATIONS_LIST_FAILED', err.message, 500, true);
  }
});

router.post('/', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey || String(idempotencyKey).length < 8) {
    return fail(res, req.correlationId, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header required', 400);
  }
  fail(
    res,
    req.correlationId,
    'NOT_IMPLEMENTED',
    'Application registration will persist credential_binding refs only — not yet implemented',
    501,
  );
});

router.get('/:applicationId/processes', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }
  try {
    const { rows } = await getPool().query(
      `SELECT environment, process_id, application_id, process_name, last_seen_at, is_current
       FROM engagement_reporting.process
       WHERE application_id = $1 AND is_current = true
       ORDER BY process_name`,
      [req.params.applicationId],
    );
    ok(res, req.correlationId, { items: rows, count: rows.length });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    fail(res, req.correlationId, 'PROCESSES_LIST_FAILED', err.message, 500, true);
  }
});

module.exports = router;
