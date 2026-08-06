'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { resolveSession } = require('../lib/session');
const { hashPassword } = require('../lib/password');
const {
  PLATFORM_ROLES,
  ensurePlatformRoles,
  ensurePasswordColumn,
  ensureBootstrapAdmin,
  normalizeRole,
  isAdminRole,
} = require('../lib/platformUsers');

const router = express.Router();

async function requireAdmin(req, res) {
  const session = await resolveSession(req);
  if (!session) {
    fail(res, req.correlationId, 'UNAUTHENTICATED', 'Sign in required', 401);
    return null;
  }
  if (!isAdminRole(session.role)) {
    fail(res, req.correlationId, 'FORBIDDEN', 'Only Admin users can manage portal accounts', 403);
    return null;
  }
  return session;
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, { items: [], count: 0, warning: 'DATABASE_NOT_CONFIGURED' });
  }
  try {
    await ensureBootstrapAdmin();
    await ensurePasswordColumn();
    await ensurePlatformRoles();

    const session = await resolveSession(req);
    if (!session) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', 'Sign in required', 401);
    }

    const { rows } = await getPool().query(
      `SELECT
         u.admin_user_id::text AS id,
         u.identity_subject,
         u.email,
         u.display_name,
         u.is_active,
         u.created_at,
         (u.password_hash IS NOT NULL AND length(u.password_hash) > 0) AS has_password,
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

    const items = rows.map((row) => ({
      ...row,
      roles: (Array.isArray(row.roles) ? row.roles : [])
        .map((name) => normalizeRole(name))
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i),
    }));

    return ok(res, req.correlationId, {
      items,
      count: items.length,
      current_user_role: session.role,
      can_manage: isAdminRole(session.role),
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'PLATFORM_USERS_LIST_FAILED', err.message, 500, true);
  }
});

router.post('/', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;

  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.display_name || body.name || '').trim();
  const role = normalizeRole(body.role || 'VIEWER');
  const password = String(body.password || '');
  const identitySubject = String(body.identity_subject || email).trim();

  if (!email || !displayName) {
    return fail(res, req.correlationId, 'VALIDATION_FAILED', 'email and display_name are required', 400);
  }
  if (!role) {
    return fail(res, req.correlationId, 'VALIDATION_FAILED', `role must be one of: ${PLATFORM_ROLES.join(', ')}`, 400);
  }
  if (password.length < 8) {
    return fail(res, req.correlationId, 'VALIDATION_FAILED', 'password must be at least 8 characters', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await ensurePasswordColumn(client);
    await ensurePlatformRoles(client);

    const existing = await client.query(
      `SELECT admin_user_id FROM engagement_reporting.admin_user WHERE lower(email::text) = lower($1)`,
      [email],
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return fail(res, req.correlationId, 'USER_EXISTS', 'Platform user with this email already exists', 409);
    }

    const inserted = await client.query(
      `INSERT INTO engagement_reporting.admin_user (identity_subject, email, display_name, is_active, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING admin_user_id::text AS id, identity_subject, email, display_name, is_active, created_at`,
      [identitySubject, email, displayName, body.is_active !== false, hashPassword(password)],
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
    return ok(
      res,
      req.correlationId,
      { item: { ...inserted.rows[0], roles: [role], has_password: true } },
      201,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(res, req.correlationId, 'PLATFORM_USER_CREATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.patch('/:userId', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;

  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const userId = req.params.userId;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await ensurePasswordColumn(client);
    const { rows } = await client.query(
      `SELECT admin_user_id FROM engagement_reporting.admin_user WHERE admin_user_id = $1::uuid`,
      [userId],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return fail(res, req.correlationId, 'USER_NOT_FOUND', 'Platform user not found', 404);
    }

    if (body.display_name != null || body.is_active != null || body.password) {
      const passwordHash =
        body.password != null && String(body.password).length > 0
          ? hashPassword(String(body.password))
          : null;
      if (body.password != null && String(body.password).length > 0 && String(body.password).length < 8) {
        await client.query('ROLLBACK');
        return fail(res, req.correlationId, 'VALIDATION_FAILED', 'password must be at least 8 characters', 400);
      }
      await client.query(
        `UPDATE engagement_reporting.admin_user
         SET display_name = COALESCE($2, display_name),
             is_active = COALESCE($3, is_active),
             password_hash = COALESCE($4, password_hash)
         WHERE admin_user_id = $1::uuid`,
        [
          userId,
          body.display_name != null ? String(body.display_name).trim() : null,
          body.is_active != null ? Boolean(body.is_active) : null,
          passwordHash,
        ],
      );
    }

    if (body.role) {
      const role = normalizeRole(body.role);
      if (!role) {
        await client.query('ROLLBACK');
        return fail(res, req.correlationId, 'VALIDATION_FAILED', `Invalid role: ${body.role}`, 400);
      }
      await ensurePlatformRoles(client);
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
              (u.password_hash IS NOT NULL AND length(u.password_hash) > 0) AS has_password,
              COALESCE(json_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '[]'::json) AS roles
       FROM engagement_reporting.admin_user u
       LEFT JOIN engagement_reporting.admin_user_role ur ON ur.admin_user_id = u.admin_user_id
       LEFT JOIN engagement_reporting.admin_role r ON r.admin_role_id = ur.admin_role_id
       WHERE u.admin_user_id = $1::uuid
       GROUP BY u.admin_user_id`,
      [userId],
    );
    const item = updated.rows[0];
    if (item) {
      item.roles = (Array.isArray(item.roles) ? item.roles : [])
        .map((name) => normalizeRole(name))
        .filter(Boolean);
    }
    return ok(res, req.correlationId, { item });
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(res, req.correlationId, 'PLATFORM_USER_UPDATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.delete('/:userId', async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;

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
