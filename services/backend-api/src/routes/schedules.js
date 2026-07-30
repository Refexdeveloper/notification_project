'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router({ mergeParams: true });

const SCHEDULES_QUERY = `
SELECT
  rs.report_schedule_id::text AS id,
  rs.cron_expression,
  rs.timezone,
  rs.is_active,
  rs.created_at,
  rd.name AS definition_name,
  rdv.config->>'application_id' AS application_id,
  rdv.config->>'template_id' AS template_id,
  rdv.config->>'template_name' AS template_name,
  COALESCE(
    json_agg(
      DISTINCT jsonb_build_object(
        'email', rr.recipient_email,
        'type', rr.recipient_type
      )
    ) FILTER (WHERE rr.recipient_email IS NOT NULL),
    '[]'::json
  ) AS recipients
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition_version rdv
  ON rdv.report_definition_version_id = rs.report_definition_version_id
JOIN engagement_reporting.report_definition rd
  ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a
  ON a.account_id = rd.account_id
LEFT JOIN engagement_reporting.report_recipient rr
  ON rr.report_schedule_id = rs.report_schedule_id
WHERE a.environment = $1
  AND ($2::text IS NULL OR rdv.config->>'application_id' = $2)
GROUP BY
  rs.report_schedule_id,
  rs.cron_expression,
  rs.timezone,
  rs.is_active,
  rs.created_at,
  rd.name,
  rdv.config
ORDER BY rs.created_at DESC
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

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }

  const environment = normalizeEnvironment(req.query.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const applicationId = req.params.applicationId;

  try {
    const { rows } = await getPool().query(SCHEDULES_QUERY, [environment, applicationId]);
    const items = rows.map((row) => {
      const recipients = Array.isArray(row.recipients) ? row.recipients : [];
      const toEmails = recipients
        .filter((r) => r.type === 'TO')
        .map((r) => String(r.email));
      return {
        id: row.id,
        name: row.definition_name,
        application_id: row.application_id || null,
        template_id: row.template_id || null,
        template_name: row.template_name || null,
        cron_expression: row.cron_expression,
        timezone: row.timezone,
        is_active: row.is_active,
        status: row.is_active ? 'active' : 'paused',
        recipients: toEmails,
        created_at: row.created_at,
      };
    });

    return ok(res, req.correlationId, {
      items,
      count: items.length,
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
    return fail(res, req.correlationId, 'SCHEDULES_LIST_FAILED', err.message, 500, true);
  }
});

module.exports = router;
