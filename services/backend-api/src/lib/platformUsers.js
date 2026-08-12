'use strict';

const { getPool, isDatabaseConfigured } = require('./db');
const { hashPassword } = require('./password');

const PLATFORM_ROLES = ['ADMIN', 'VIEWER'];

async function ensurePlatformRoles(client = getPool()) {
  for (const name of PLATFORM_ROLES) {
    await client.query(
      `INSERT INTO engagement_reporting.admin_role (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [name],
    );
  }
}

async function ensurePasswordColumn(client = getPool()) {
  await client.query(`
    ALTER TABLE engagement_reporting.admin_user
      ADD COLUMN IF NOT EXISTS password_hash text
  `);
}

async function loadPlatformUserByEmail(email) {
  if (!isDatabaseConfigured()) return null;
  const { rows } = await getPool().query(
    `SELECT
       u.admin_user_id::text AS id,
       u.identity_subject,
       u.email,
       u.display_name,
       u.is_active,
       u.password_hash,
       COALESCE(
         (
           SELECT r.name
           FROM engagement_reporting.admin_user_role ur
           INNER JOIN engagement_reporting.admin_role r ON r.admin_role_id = ur.admin_role_id
           WHERE ur.admin_user_id = u.admin_user_id
           ORDER BY CASE r.name WHEN 'ADMIN' THEN 0 ELSE 1 END
           LIMIT 1
         ),
         'VIEWER'
       ) AS role
     FROM engagement_reporting.admin_user u
     WHERE lower(u.email::text) = lower($1)
     LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function ensureBootstrapAdmin() {
  if (!isDatabaseConfigured()) return { created: false, reason: 'DATABASE_NOT_CONFIGURED' };

  const email = String(
    process.env.PLATFORM_BOOTSTRAP_EMAIL || 'mohamedaasik.m@refex.co.in',
  )
    .trim()
    .toLowerCase();
  const password = String(process.env.PLATFORM_BOOTSTRAP_PASSWORD || 'Refex@2026');
  const displayName = String(process.env.PLATFORM_BOOTSTRAP_NAME || 'Mohamed Asaik').trim();

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await ensurePasswordColumn(client);
    await ensurePlatformRoles(client);

    const existing = await client.query(
      `SELECT admin_user_id::text AS id, password_hash
       FROM engagement_reporting.admin_user
       WHERE lower(email::text) = lower($1)
       LIMIT 1`,
      [email],
    );

    if (existing.rows.length) {
      if (!existing.rows[0].password_hash) {
        await client.query(
          `UPDATE engagement_reporting.admin_user
           SET password_hash = $2, display_name = COALESCE(NULLIF(display_name, ''), $3), is_active = true
           WHERE admin_user_id = $1::uuid`,
          [existing.rows[0].id, hashPassword(password), displayName],
        );
        await client.query('COMMIT');
        return { created: false, updated_password: true, email };
      }
      await client.query('COMMIT');
      return { created: false, email };
    }

    const inserted = await client.query(
      `INSERT INTO engagement_reporting.admin_user (identity_subject, email, display_name, is_active, password_hash)
       VALUES ($1, $2, $3, true, $4)
       RETURNING admin_user_id::text AS id`,
      [email, email, displayName, hashPassword(password)],
    );
    const roleRow = await client.query(
      `SELECT admin_role_id FROM engagement_reporting.admin_role WHERE name = 'ADMIN'`,
    );
    await client.query(
      `INSERT INTO engagement_reporting.admin_user_role (admin_user_id, admin_role_id)
       VALUES ($1::uuid, $2)
       ON CONFLICT DO NOTHING`,
      [inserted.rows[0].id, roleRow.rows[0].admin_role_id],
    );
    await client.query('COMMIT');
    return { created: true, email };
  } catch (err) {
    await client.query('ROLLBACK');
    return { created: false, error: err.message };
  } finally {
    client.release();
  }
}

function normalizeRole(role) {
  const upper = String(role || 'VIEWER').trim().toUpperCase();
  if (upper === 'ADMIN') return 'ADMIN';
  if (upper === 'VIEWER' || upper === 'OPERATOR' || upper === 'AUDITOR') return 'VIEWER';
  return null;
}

function isAdminRole(role) {
  return String(role || '').toUpperCase() === 'ADMIN';
}

module.exports = {
  PLATFORM_ROLES,
  ensurePlatformRoles,
  ensurePasswordColumn,
  ensureBootstrapAdmin,
  loadPlatformUserByEmail,
  normalizeRole,
  isAdminRole,
};
