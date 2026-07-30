'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router({ mergeParams: true });

const SNAPSHOT_HISTORY_QUERY = `
SELECT
  sr.snapshot_run_id,
  sr.application_id,
  sr.process_id,
  sr.status,
  sr.created_at,
  sr.load_completed_at,
  sr.extraction_completed_at,
  sr.item_record_count,
  sr.user_record_count,
  sr.assignment_record_count,
  sr.unresolved_role_count,
  p.process_name
FROM engagement_reporting.snapshot_run sr
LEFT JOIN engagement_reporting.process p
  ON p.environment = sr.environment
 AND p.process_id = sr.process_id
 AND p.application_id = sr.application_id
 AND p.is_current = true
WHERE sr.environment = $1
  AND sr.application_id = $2
ORDER BY sr.created_at DESC
LIMIT 100
`;

const DELIVERY_HISTORY_QUERY = `
SELECT
  rr.report_run_id,
  rr.application_id,
  rr.process_id,
  rr.status,
  rr.scheduled_at,
  rr.completed_at,
  rr.error_message
FROM engagement_reporting.report_run rr
WHERE rr.environment = $1
  AND rr.application_id = $2
ORDER BY rr.scheduled_at DESC
LIMIT 100
`;

function dbNotConfigured(res, correlationId) {
  return ok(res, correlationId, {
    items: [],
    count: 0,
    warning: 'DATABASE_NOT_CONFIGURED',
  });
}

function normalizeEnvironment(value) {
  const lower = String(value || '').toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower;
}

function mapSnapshotStatus(status) {
  const upper = String(status || '').toUpperCase();
  if (upper === 'COMPLETED') return 'completed';
  if (upper === 'PARTIAL') return 'partial';
  if (upper === 'FAILED') return 'failed';
  if (upper === 'IN_PROGRESS' || upper === 'PENDING') return 'running';
  return 'partial';
}

function mapReportStatus(status) {
  const upper = String(status || '').toUpperCase();
  if (upper === 'COMPLETED') return 'delivered';
  if (upper === 'FAILED') return 'failed';
  if (upper === 'IN_PROGRESS' || upper === 'PENDING') return 'pending';
  return 'pending';
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }

  const environment = normalizeEnvironment(req.query.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const applicationId = req.params.applicationId;
  if (!applicationId) {
    return fail(res, req.correlationId, 'APPLICATION_ID_REQUIRED', 'Application id is required', 400);
  }

  try {
    const pool = getPool();
    const [snapshots, reports] = await Promise.all([
      pool.query(SNAPSHOT_HISTORY_QUERY, [environment, applicationId]),
      pool.query(DELIVERY_HISTORY_QUERY, [environment, applicationId]),
    ]);

    const snapshotItems = snapshots.rows.map((row) => ({
      id: row.snapshot_run_id,
      kind: 'snapshot',
      title: `Ingestion · ${row.process_name || row.process_id}`,
      subtitle: row.snapshot_run_id,
      process_id: row.process_id,
      process_name: row.process_name,
      status: mapSnapshotStatus(row.status),
      raw_status: row.status,
      occurred_at: row.load_completed_at || row.extraction_completed_at || row.created_at,
      item_record_count: row.item_record_count,
      user_record_count: row.user_record_count,
      assignment_record_count: row.assignment_record_count,
      unresolved_role_count: row.unresolved_role_count,
      detail: `${row.item_record_count} items · ${row.user_record_count} users · ${row.assignment_record_count} assignments`,
    }));

    const reportItems = reports.rows.map((row) => ({
      id: row.report_run_id,
      kind: 'report',
      title: row.application_id,
      subtitle: row.application_id,
      process_id: row.process_id,
      process_name: null,
      status: mapReportStatus(row.status),
      raw_status: row.status,
      occurred_at: row.completed_at || row.scheduled_at,
      error_message: row.error_message,
      detail: mapReportStatus(row.status),
    }));

    const sendsOnly = String(req.query.sends_only || '').toLowerCase() === 'true';
    const items = sendsOnly
      ? reportItems.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
      : [...reportItems, ...snapshotItems].sort(
          (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
        );

    return ok(res, req.correlationId, {
      items,
      count: items.length,
      snapshot_count: snapshotItems.length,
      report_count: reportItems.length,
      environment,
      application_id: applicationId,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    if (err.code === 'DATABASE_NOT_CONFIGURED') {
      return dbNotConfigured(res, req.correlationId);
    }
    return fail(res, req.correlationId, 'HISTORY_LIST_FAILED', err.message, 500, true);
  }
});

module.exports = router;
