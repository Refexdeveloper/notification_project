'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router();

const GLOBAL_DELIVERY_QUERY = `
SELECT
  rr.report_run_id,
  rr.application_id,
  rr.process_id,
  rr.status AS run_status,
  rr.scheduled_at,
  rr.completed_at,
  rr.error_message AS run_error,
  rnd.subject,
  rd.recipient_email,
  rd.delivery_status,
  rd.delivered_at,
  rd.error_message AS delivery_error,
  a.application_name
FROM engagement_reporting.report_run rr
LEFT JOIN engagement_reporting.report_render rnd
  ON rnd.report_run_id = rr.report_run_id
LEFT JOIN engagement_reporting.report_delivery rd
  ON rd.report_run_id = rr.report_run_id
LEFT JOIN engagement_reporting.application a
  ON a.environment = rr.environment
 AND a.application_id = rr.application_id
 AND a.is_current = true
WHERE rr.environment = $1
ORDER BY COALESCE(rd.delivered_at, rr.completed_at, rr.scheduled_at) DESC NULLS LAST
LIMIT $2
`;

const GLOBAL_RUNS_ONLY_QUERY = `
SELECT
  rr.report_run_id,
  rr.application_id,
  rr.process_id,
  rr.status AS run_status,
  rr.scheduled_at,
  rr.completed_at,
  rr.error_message AS run_error,
  rnd.subject,
  a.application_name
FROM engagement_reporting.report_run rr
LEFT JOIN engagement_reporting.report_render rnd
  ON rnd.report_run_id = rr.report_run_id
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

function mapDeliveryStatus(runStatus, deliveryStatus) {
  const delivery = String(deliveryStatus || '').toUpperCase();
  if (delivery === 'SENT') return 'delivered';
  if (delivery === 'FAILED') return 'failed';
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
    const pool = getPool();
    let rows;
    try {
      const result = await pool.query(GLOBAL_DELIVERY_QUERY, [environment, limit]);
      rows = result.rows;
    } catch (err) {
      if (err.code !== '42P01') throw err;
      rows = [];
    }

    if (!rows.length) {
      const fallback = await pool.query(GLOBAL_RUNS_ONLY_QUERY, [environment, limit]);
      rows = fallback.rows.map((row) => ({ ...row, recipient_email: null, delivery_status: null }));
    }

    const items = rows.map((row, index) => {
      const status = mapDeliveryStatus(row.run_status, row.delivery_status);
      const subject =
        row.subject ||
        `Report · ${row.application_name || row.application_id} · ${row.process_id}`;
      const occurredAt =
        row.delivered_at || row.completed_at || row.scheduled_at || new Date().toISOString();
      const errorMessage = row.delivery_error || row.run_error || null;

      return {
        id: row.recipient_email
          ? `${row.report_run_id}:${row.recipient_email}`
          : `${row.report_run_id}:${index}`,
        report_run_id: row.report_run_id,
        application_id: row.application_id,
        application_name: row.application_name || row.application_id,
        process_id: row.process_id,
        recipient: row.recipient_email || '—',
        subject,
        status,
        raw_status: row.delivery_status || row.run_status,
        error_message: errorMessage,
        sent_at: occurredAt,
        entity_type: 'ReportSchedule',
        entity_id: row.report_run_id,
      };
    });

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
