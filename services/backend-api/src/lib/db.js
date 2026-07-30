'use strict';

const { Pool } = require('pg');

let pool;

function resolvePassword() {
  const value = process.env.PGPASSWORD ?? process.env.PG_PASS ?? '';
  return typeof value === 'string' ? value : String(value);
}

/** True when explicit database connection settings are present. */
function isDatabaseConfigured() {
  if (process.env.SKIP_DATABASE === 'true') return false;
  if (process.env.DATABASE_URL) return true;
  return Boolean(process.env.PGPASSWORD || process.env.PG_PASS || process.env.PG_CONNECT === 'true');
}

function getPool() {
  if (!isDatabaseConfigured()) {
    throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { code: 'DATABASE_NOT_CONFIGURED' });
  }
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  pool = connectionString
    ? new Pool({ connectionString })
    : new Pool({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: resolvePassword(),
        database: process.env.PGDATABASE || 'engagement_reporting',
      });
  return pool;
}

async function checkConnection() {
  if (!isDatabaseConfigured()) {
    throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { code: 'DATABASE_NOT_CONFIGURED' });
  }
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

module.exports = { getPool, checkConnection, isDatabaseConfigured, resolvePassword };
