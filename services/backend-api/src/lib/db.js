'use strict';

const { Pool } = require('pg');

let pool = null;
let connector = null;

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

function poolOptions(extra = {}) {
  return {
    max: Math.max(2, Number(process.env.PG_POOL_MAX || 4)),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 20000),
    ...extra,
  };
}

async function initDatabase() {
  if (pool) return pool;
  if (!isDatabaseConfigured()) return null;

  if (process.env.DATABASE_URL) {
    pool = guardPool(new Pool(poolOptions({ connectionString: process.env.DATABASE_URL })));
    return pool;
  }

  const instance = cloudSqlInstanceName();
  if (instance) {
    const { Connector, IpAddressTypes } = require('@google-cloud/cloud-sql-connector');
    connector = new Connector();
    const clientOpts = await connector.getOptions({
      instanceConnectionName: instance,
      ipType: IpAddressTypes.PUBLIC,
    });
    pool = guardPool(new Pool(poolOptions({
      ...clientOpts,
      user: process.env.PGUSER || 'postgres',
      password: resolvePassword(),
      database: process.env.PGDATABASE || 'engagement_reporting',
    })));
    return pool;
  }

  pool = guardPool(new Pool(poolOptions({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: resolvePassword(),
    database: process.env.PGDATABASE || 'engagement_reporting',
  })));
  return pool;
}

function isDeadConnectionError(err) {
  const msg = String(err && err.message || '');
  const code = String(err && err.code || '');
  return code === 'ECONNRESET'
    || code === '57P01'
    || code === '57P03'
    || /terminat|not yet connected|Connection ended|ECONNRESET|server closed/i.test(msg);
}

function guardPool(nextPool) {
  nextPool.on('error', (err) => {
    console.error('[pg-pool] idle client error', err && err.message);
    if (isDeadConnectionError(err)) {
      resetPool().catch(() => undefined);
    }
  });
  return nextPool;
}

async function resetPool() {
  const oldPool = pool;
  const oldConnector = connector;
  pool = null;
  connector = null;
  if (oldPool) {
    try { await oldPool.end(); } catch { /* ignore */ }
  }
  if (oldConnector) {
    try { await oldConnector.close(); } catch { /* ignore */ }
  }
  return initDatabase();
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
  try {
    const client = await getPool().connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    if (!isDeadConnectionError(err)) throw err;
    await resetPool();
    const client = await getPool().connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  }
}

module.exports = { getPool, initDatabase, checkConnection, isDatabaseConfigured, resolvePassword, resetPool };
