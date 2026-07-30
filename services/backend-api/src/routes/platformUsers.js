'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { resolveSession } = require('../lib/session');

const router = express.Router();

const ROLES = ['ADMIN', 'OPERATOR', 'VIEWER', 'AUDITOR'];

async function ensureRoles(pool) {
  for (const name of ROLES) {
    await pool.query(
      `INSERT INTO engagement_reporting.admin_role (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [name],
    );
  }
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, { items: [], count: 0, warning: 'DATABASE_NOT_CONFIGURED' });
  }
  try {
    await ensureRoles(getPool());
    const { rows } = await getPool().query(
      `SELECT
         u.admin_user_id::text AS id,
         u.identity_subject,
         u.email,
         u.display_name,
         u.is_active,
         u.created_at,
         COALESCE(
           json_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL),
           '[]'::json
         ) AS roles
       FROM engagement_reporting.admin_user u
       LEFT JOIN engagement_reporting.admin_user_role ur ON ur.admin_user_id = u.admin_user_id
       LEFT JOIN engagement_reporting.admin_role r ON r.admin_role_id = ur.admin_role_id
       GROUP BY u.admin_user_id
       ORDER BY u.display_name ASC`,
    );
    return ok(res, req.correlationId, { items: rows, count: rows.length });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'PLATFORM_USERS_LIST_FAILED', err.message, 500, true);
  }
});

router.post('/', async (req, res) => {
  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.display_name || body.name || '').trim();
  const role = String(body.role || 'OPERATOR').trim().toUpperCase();
  const identitySubject = String(body.identity_subject || email).trim();

  if (!email || !displayName) {
    return fail(res, req.correlationId, 'VALIDATION_FAILED', 'email and display_name are required', 400);
  }
  if (!ROLES.includes(role)) {
    return fail(res, req.correlationId, 'VALIDATION_FAILED', `role must be one of: ${ROLES.join(', ')}`, 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await ensureRoles(client);

    const existing = await client.query(
      `SELECT admin_user_id FROM engagement_reporting.admin_user WHERE email = $1`,
      [email],
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return fail(res, req.correlationId, 'USER_EXISTS', 'Platform user with this email already exists', 409);
    }

    const inserted = await client.query(
      `INSERT INTO engagement_reporting.admin_user (identity_subject, email, display_name, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING admin_user_id::text AS id, identity_subject, email, display_name, is_active, created_at`,
      [identitySubject, email, displayName, body.is_active !== false],
    );

    const roleRow = await client.query(
      `SELECT admin_role_id FROM engagement_reporting.admin_role WHERE name = $1`,
      [role],
    );
    await client.query(
      `INSERT INTO engagement_reporting.admin_user_role (admin_user_id, admin_role_id)
       VALUES ($1::uuid, $2)`,
      [inserted.rows[0].id, roleRow.rows[0].admin_role_id],
    );

    await client.query(
      `INSERT INTO engagement_reporting.audit_event
         (actor_subject, action, resource_type, resource_id, correlation_id, evidence)
       VALUES ($1, 'CREATE_PLATFORM_USER', 'admin_user', $2, $3, $4::jsonb)`,
      [session.subject, inserted.rows[0].id, req.correlationId, JSON.stringify({ email, role })],
    );

    await client.query('COMMIT');
    return ok(res, req.correlationId, { item: { ...inserted.rows[0], roles: [role] } }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(res, req.correlationId, 'PLATFORM_USER_CREATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.patch('/:userId', async (req, res) => {
  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const userId = req.params.userId;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT admin_user_id FROM engagement_reporting.admin_user WHERE admin_user_id = $1::uuid`,
      [userId],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return fail(res, req.correlationId, 'USER_NOT_FOUND', 'Platform user not found', 404);
    }

    if (body.display_name != null || body.is_active != null) {
      await client.query(
        `UPDATE engagement_reporting.admin_user
         SET display_name = COALESCE($2, display_name),
             is_active = COALESCE($3, is_active)
         WHERE admin_user_id = $1::uuid`,
        [
          userId,
          body.display_name != null ? String(body.display_name).trim() : null,
          body.is_active != null ? Boolean(body.is_active) : null,
        ],
      );
    }

    if (body.role) {
      const role = String(body.role).trim().toUpperCase();
      if (!ROLES.includes(role)) {
        await client.query('ROLLBACK');
        return fail(res, req.correlationId, 'VALIDATION_FAILED', `Invalid role: ${role}`, 400);
      }
      await ensureRoles(client);
      const roleRow = await client.query(
        `SELECT admin_role_id FROM engagement_reporting.admin_role WHERE name = $1`,
        [role],
      );
      await client.query(`DELETE FROM engagement_reporting.admin_user_role WHERE admin_user_id = $1::uuid`, [
        userId,
      ]);
      await client.query(
        `INSERT INTO engagement_reporting.admin_user_role (admin_user_id, admin_role_id) VALUES ($1::uuid, $2)`,
        [userId, roleRow.rows[0].admin_role_id],
      );
    }

    await client.query('COMMIT');
    const updated = await getPool().query(
      `SELECT u.admin_user_id::text AS id, u.email, u.display_name, u.is_active,
              COALESCE(json_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '[]'::json) AS roles
       FROM engagement_reporting.admin_user u
       LEFT JOIN engagement_reporting.admin_user_role ur ON ur.admin_user_id = u.admin_user_id
       LEFT JOIN engagement_reporting.admin_role r ON r.admin_role_id = ur.admin_role_id
       WHERE u.admin_user_id = $1::uuid
       GROUP BY u.admin_user_id`,
      [userId],
    );
    return ok(res, req.correlationId, { item: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(res, req.correlationId, 'PLATFORM_USER_UPDATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.delete('/:userId', async (req, res) => {
  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  try {
    const { rowCount } = await getPool().query(
      `UPDATE engagement_reporting.admin_user SET is_active = false WHERE admin_user_id = $1::uuid`,
      [req.params.userId],
    );
    if (!rowCount) {
      return fail(res, req.correlationId, 'USER_NOT_FOUND', 'Platform user not found', 404);
    }
    return ok(res, req.correlationId, { deleted: true, id: req.params.userId });
  } catch (err) {
    return fail(res, req.correlationId, 'PLATFORM_USER_DELETE_FAILED', err.message, 500, true);
  }
});

module.exports = router;
