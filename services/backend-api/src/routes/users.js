'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router();

const USERS_QUERY = `
WITH latest_user_snap AS (
  SELECT snapshot_run_id, snapshot_at
  FROM engagement_reporting."user"
  WHERE environment = $1
  ORDER BY snapshot_at DESC
  LIMIT 1
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
  lus.snapshot_at
FROM engagement_reporting."user" u
INNER JOIN latest_user_snap lus ON u.snapshot_run_id = lus.snapshot_run_id
WHERE u.environment = $1
ORDER BY u.user_name ASC NULLS LAST, u.email ASC NULLS LAST
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

  try {
    const { rows } = await getPool().query(USERS_QUERY, [environment]);
    const snapshotAt = rows[0]?.snapshot_at || null;
    const items = rows.map((row) => ({
      user_id: row.user_id,
      user_name: row.user_name,
      email: row.email,
      user_type: row.user_type,
      active_status: row.active_status,
      last_sign_in: row.last_sign_in,
      ever_logged_in: row.ever_logged_in,
      source_payload: row.source_payload,
    }));

    return ok(res, req.correlationId, {
      items,
      count: items.length,
      totals: buildTotals(rows),
      generated_at: new Date().toISOString(),
      snapshot_at: snapshotAt,
      environment,
      scope: 'account',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, totals: buildTotals([]), warning: 'SCHEMA_NOT_MIGRATED' });
    }
    if (err.code === 'DATABASE_NOT_CONFIGURED') {
      return dbNotConfigured(res, req.correlationId);
    }
    return fail(res, req.correlationId, 'USERS_LIST_FAILED', err.message, 500, true);
  }
});

module.exports = router;
