'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router();

const GLOBAL_SENDS_QUERY = `
SELECT
  rr.report_run_id,
  rr.application_id,
  rr.process_id,
  rr.status AS run_status,
  rr.scheduled_at,
  rr.completed_at,
  rr.error_message AS run_error,
  a.application_name
FROM engagement_reporting.report_run rr
LEFT JOIN engagement_reporting.application a
  ON a.environment = rr.environment
 AND a.application_id = rr.application_id
 AND a.is_current = true
WHERE rr.environment = $1
ORDER BY COALESCE(rr.completed_at, rr.scheduled_at) DESC NULLS LAST
LIMIT $2
`;

function normalizeEnvironment(value) {
  const lower = String(value || 'production').toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower;
}

function mapSendStatus(runStatus) {
  const run = String(runStatus || '').toUpperCase();
  if (run === 'COMPLETED') return 'delivered';
  if (run === 'FAILED') return 'failed';
  if (run === 'IN_PROGRESS' || run === 'PENDING' || run === 'RETRY_PENDING') return 'pending';
  return 'pending';
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, {
      items: [],
      total: 0,
      warning: 'DATABASE_NOT_CONFIGURED',
    });
  }

  const environment = normalizeEnvironment(req.query.environment);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  try {
    const { rows } = await getPool().query(GLOBAL_SENDS_QUERY, [environment, limit]);

    const items = rows.map((row) => ({
      id: row.report_run_id,
      report_run_id: row.report_run_id,
      application_id: row.application_id,
      application_name: row.application_name || row.application_id,
      process_id: row.process_id || null,
      status: mapSendStatus(row.run_status),
      raw_status: row.run_status,
      sent_at: row.completed_at || row.scheduled_at || null,
      error_message: row.run_error || null,
    }));

    return ok(res, req.correlationId, {
      items,
      total: items.length,
      environment,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], total: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'DELIVERY_HISTORY_FAILED', err.message, 500, true);
  }
});

module.exports = router;
