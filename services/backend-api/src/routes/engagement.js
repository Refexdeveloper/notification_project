'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router({ mergeParams: true });

const APP_ENGAGEMENT_QUERY = `
WITH app_processes AS (
  SELECT process_id
  FROM engagement_reporting.process
  WHERE environment = $1
    AND application_id = $2
    AND is_current = true
),
latest_runs AS (
  SELECT DISTINCT ON (sr.process_id)
    sr.snapshot_run_id,
    sr.process_id
  FROM engagement_reporting.snapshot_run sr
  WHERE sr.environment = $1
    AND (
      sr.application_id = $2
      OR sr.process_id IN (SELECT process_id FROM app_processes)
    )
  ORDER BY sr.process_id, sr.created_at DESC
),
latest_user_snap AS (
  SELECT snapshot_run_id, snapshot_at
  FROM engagement_reporting."user"
  WHERE environment = $1
  ORDER BY snapshot_at DESC
  LIMIT 1
),
app_member AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
  UNION
  SELECT DISTINCT ia.principal_id AS user_id
  FROM engagement_reporting.item_assignment ia
  INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
  WHERE ia.environment = $1
    AND ia.principal_type = 'USER'
    AND (
      ia.application_id = $2
      OR ia.process_id IN (SELECT process_id FROM app_processes)
    )
  UNION
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.item_assignment ia
  INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
  INNER JOIN engagement_reporting.principal_user pu
    ON pu.environment = ia.environment
   AND pu.application_id = $2
   AND pu.principal_id = ia.principal_id
   AND pu.principal_type = ia.principal_type
   AND pu.valid_to IS NULL
  WHERE ia.environment = $1
    AND ia.principal_type = 'APP_ROLE'
    AND (
      ia.application_id = $2
      OR ia.process_id IN (SELECT process_id FROM app_processes)
    )
),
role_names AS (
  SELECT
    pu.user_id,
    array_agg(
      DISTINCT COALESCE(p.principal_name, p.principal_id)
      ORDER BY COALESCE(p.principal_name, p.principal_id)
    ) AS role_names
  FROM engagement_reporting.principal_user pu
  JOIN engagement_reporting.principal p
    ON p.environment = pu.environment
   AND p.application_id = pu.application_id
   AND p.principal_id = pu.principal_id
   AND p.principal_type = pu.principal_type
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
  GROUP BY pu.user_id
),
assignment_counts AS (
  SELECT user_id, SUM(assigned)::int AS assigned, SUM(open_count)::int AS open_count,
         SUM(completed_count)::int AS completed_count, SUM(rejected_count)::int AS rejected_count
  FROM (
    SELECT
      ia.principal_id AS user_id,
      COUNT(*)::int AS assigned,
      COUNT(*) FILTER (WHERE i.process_status = 'InProgress')::int AS open_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Completed')::int AS completed_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Withdrawn')::int AS rejected_count
    FROM engagement_reporting.item_assignment ia
    INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
    INNER JOIN engagement_reporting.item i
      ON i.environment = ia.environment
     AND i.process_id = ia.process_id
     AND i.instance_id = ia.instance_id
     AND i.snapshot_at = ia.snapshot_at
    WHERE ia.environment = $1
      AND ia.principal_type = 'USER'
      AND (
        ia.application_id = $2
        OR ia.process_id IN (SELECT process_id FROM app_processes)
      )
    GROUP BY ia.principal_id
    UNION ALL
    SELECT
      pu.user_id,
      COUNT(*)::int AS assigned,
      COUNT(*) FILTER (WHERE i.process_status = 'InProgress')::int AS open_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Completed')::int AS completed_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Withdrawn')::int AS rejected_count
    FROM engagement_reporting.item_assignment ia
    INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
    INNER JOIN engagement_reporting.item i
      ON i.environment = ia.environment
     AND i.process_id = ia.process_id
     AND i.instance_id = ia.instance_id
     AND i.snapshot_at = ia.snapshot_at
    INNER JOIN engagement_reporting.principal_user pu
      ON pu.environment = ia.environment
     AND pu.application_id = $2
     AND pu.principal_id = ia.principal_id
     AND pu.principal_type = ia.principal_type
     AND pu.valid_to IS NULL
    WHERE ia.environment = $1
      AND ia.principal_type = 'APP_ROLE'
      AND (
        ia.application_id = $2
        OR ia.process_id IN (SELECT process_id FROM app_processes)
      )
    GROUP BY pu.user_id
  ) counts
  GROUP BY user_id
)
SELECT
  u.user_id,
  u.user_name,
  u.email,
  u.user_type,
  u.active_status,
  u.last_sign_in,
  u.ever_logged_in,
  u.source_payload,
  COALESCE(a.assigned, 0) AS assigned,
  COALESCE(a.open_count, 0) AS open_count,
  COALESCE(a.completed_count, 0) AS completed_count,
  COALESCE(a.rejected_count, 0) AS rejected_count,
  COALESCE(rn.role_names, ARRAY[]::text[]) AS role_names,
  (COALESCE(a.assigned, 0) > 0) AS has_assignment,
  (COALESCE(array_length(rn.role_names, 1), 0) > 0) AS has_app_role,
  lus.snapshot_at
FROM engagement_reporting."user" u
INNER JOIN latest_user_snap lus ON u.snapshot_run_id = lus.snapshot_run_id
INNER JOIN app_member am ON am.user_id = u.user_id
LEFT JOIN assignment_counts a ON a.user_id = u.user_id
LEFT JOIN role_names rn ON rn.user_id = u.user_id
WHERE u.environment = $1
ORDER BY COALESCE(a.assigned, 0) DESC, u.user_name ASC NULLS LAST
`;

function dbNotConfigured(res, correlationId) {
  return ok(res, correlationId, {
    items: [],
    count: 0,
    totals: {
      total_users: 0,
      active_today: 0,
      inactive: 0,
      never_logged_in: 0,
      total_assigned: 0,
      with_assignments: 0,
      with_app_role: 0,
    },
    warning: 'DATABASE_NOT_CONFIGURED',
  });
}

function normalizeEnvironment(value) {
  const lower = String(value || '').toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower;
}

function isLoggedInToday(lastSignIn) {
  if (!lastSignIn) return false;
  const login = new Date(lastSignIn);
  if (Number.isNaN(login.getTime())) return false;
  const now = new Date();
  return (
    login.getFullYear() === now.getFullYear() &&
    login.getMonth() === now.getMonth() &&
    login.getDate() === now.getDate()
  );
}

function buildTotals(rows) {
  return {
    total_users: rows.length,
    active_today: rows.filter((row) => isLoggedInToday(row.last_sign_in)).length,
    inactive: rows.filter((row) => row.last_sign_in && !isLoggedInToday(row.last_sign_in)).length,
    never_logged_in: rows.filter((row) => !row.ever_logged_in && !row.last_sign_in).length,
    total_assigned: rows.reduce((sum, row) => sum + Number(row.assigned || 0), 0),
    with_assignments: rows.filter((row) => Number(row.assigned || 0) > 0).length,
    with_app_role: rows.filter((row) => row.has_app_role).length,
  };
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
    const { rows } = await getPool().query(APP_ENGAGEMENT_QUERY, [environment, applicationId]);
    const snapshotAt = rows[0]?.snapshot_at || null;
    const items = rows.map((row) => ({
      user_id: row.user_id,
      user_name: row.user_name,
      email: row.email,
      user_type: row.user_type,
      active_status: row.active_status,
      last_sign_in: row.last_sign_in,
      ever_logged_in: row.ever_logged_in,
      assigned: row.assigned,
      open: row.open_count,
      completed: row.completed_count,
      rejected: row.rejected_count,
      role_names: row.role_names || [],
      has_assignment: row.has_assignment,
      has_app_role: row.has_app_role,
      source_payload: row.source_payload,
    }));

    return ok(res, req.correlationId, {
      items,
      count: items.length,
      totals: buildTotals(rows),
      generated_at: new Date().toISOString(),
      snapshot_at: snapshotAt,
      environment,
      application_id: applicationId,
      scope: 'application',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, {
        items: [],
        count: 0,
        totals: buildTotals([]),
        warning: 'SCHEMA_NOT_MIGRATED',
      });
    }
    if (err.code === 'DATABASE_NOT_CONFIGURED') {
      return dbNotConfigured(res, req.correlationId);
    }
    return fail(res, req.correlationId, 'ENGAGEMENT_LIST_FAILED', err.message, 500, true);
  }
});

module.exports = router;
