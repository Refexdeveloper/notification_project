'use strict';

const { Pool } = require('pg');

let pool = null;

function resolvePassword() {
  const value = process.env.PGPASSWORD ?? process.env.PG_PASS ?? '';
  return typeof value === 'string' ? value : String(value);
}

function cloudSqlInstanceName() {
  if (process.env.CLOUD_SQL_CONNECTION_NAME) return process.env.CLOUD_SQL_CONNECTION_NAME;
  const pghost = process.env.PGHOST || '';
  if (pghost.startsWith('/cloudsql/')) return pghost.slice('/cloudsql/'.length);
  return null;
}

/** True when explicit database connection settings are present. */
function isDatabaseConfigured() {
  if (process.env.SKIP_DATABASE === 'true') return false;
  if (process.env.DATABASE_URL) return true;
  if (cloudSqlInstanceName()) return Boolean(process.env.PGPASSWORD || process.env.PG_PASS);
  return Boolean(process.env.PGPASSWORD || process.env.PG_PASS || process.env.PG_CONNECT === 'true');
}

async function initDatabase() {
  if (pool) return pool;
  if (!isDatabaseConfigured()) return null;

  if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return pool;
  }

  const instance = cloudSqlInstanceName();
  if (instance) {
    const { Connector, IpAddressTypes } = require('@google-cloud/cloud-sql-connector');
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      instanceConnectionName: instance,
      ipType: IpAddressTypes.PUBLIC,
    });
    pool = new Pool({
      ...clientOpts,
      user: process.env.PGUSER || 'postgres',
      password: resolvePassword(),
      database: process.env.PGDATABASE || 'engagement_reporting',
    });
    return pool;
  }

  pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: resolvePassword(),
    database: process.env.PGDATABASE || 'engagement_reporting',
  });
  return pool;
}

function getPool() {
  if (!pool) {
    throw Object.assign(new Error('DATABASE_NOT_INITIALIZED'), { code: 'DATABASE_NOT_INITIALIZED' });
  }
  return pool;
}

async function checkConnection() {
  if (!isDatabaseConfigured()) {
    throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { code: 'DATABASE_NOT_CONFIGURED' });
  }
  await initDatabase();
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

module.exports = { getPool, initDatabase, checkConnection, isDatabaseConfigured, resolvePassword };
