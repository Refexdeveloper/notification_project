'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router({ mergeParams: true });

const TEMPLATES_QUERY = `
SELECT
  rt.report_template_id::text AS id,
  rt.name,
  rt.created_at,
  rtv.version_number,
  rtv.content_ref,
  COALESCE(rtv.created_at, rt.created_at) AS updated_at,
  rdv.config->>'application_id' AS application_id
FROM engagement_reporting.report_template rt
LEFT JOIN LATERAL (
  SELECT version_number, content_ref, created_at
  FROM engagement_reporting.report_template_version rtv
  WHERE rtv.report_template_id = rt.report_template_id
  ORDER BY version_number DESC
  LIMIT 1
) rtv ON true
LEFT JOIN engagement_reporting.report_definition_version rdv
  ON rdv.config->>'template_id' = rt.report_template_id::text
LEFT JOIN engagement_reporting.report_definition rd
  ON rd.report_definition_id = rdv.report_definition_id
LEFT JOIN engagement_reporting.account a
  ON a.account_id = rd.account_id
WHERE ($1::text IS NULL OR a.environment = $1 OR a.environment IS NULL)
  AND ($2::text IS NULL OR rdv.config->>'application_id' = $2 OR rdv.config IS NULL)
ORDER BY rt.created_at DESC
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
  return lower || null;
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }

  const environment = normalizeEnvironment(req.query.environment);
  const applicationId = req.params.applicationId || null;

  try {
    const { rows } = await getPool().query(TEMPLATES_QUERY, [environment, applicationId]);
    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      application_id: row.application_id || null,
      version_number: row.version_number || 0,
      content_ref: row.content_ref || null,
      status: row.version_number ? 'published' : 'draft',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

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
    return fail(res, req.correlationId, 'TEMPLATES_LIST_FAILED', err.message, 500, true);
  }
});

module.exports = router;
