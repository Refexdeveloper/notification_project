'use strict';

/**
 * Procurement to Pay (P2P) — read-only MySQL access.
 *
 * HARD RULES (never relax without an explicit product decision):
 * - Never use the p2p_app application user.
 * - Never run INSERT / UPDATE / DELETE / ALTER / DROP / CREATE / TRUNCATE / GRANT.
 * - Prefer Cloud SQL Auth Proxy / Connector; credentials only via env / Secret Manager.
 * - Do not build a mirror unless reporting load starts stressing production.
 */

const FORBIDDEN_USERS = new Set(['p2p_app', 'root', 'mysql.sys', 'mysql.session', 'mysql.infoschema']);
const WRITE_SQL_RE =
  /\b(insert|update|delete|alter|drop|create|truncate|replace|grant|revoke|rename|call|load\s+data|outfile|dumpfile)\b/i;

function assertReadOnlySql(sql) {
  const text = String(sql || '').trim();
  if (!text) throw Object.assign(new Error('Empty SQL'), { code: 'P2P_EMPTY_SQL' });
  if (WRITE_SQL_RE.test(text)) {
    throw Object.assign(new Error('P2P MySQL allows SELECT-only statements'), { code: 'P2P_WRITE_FORBIDDEN' });
  }
  if (!/^\s*(select|show|describe|desc|explain)\b/i.test(text)) {
    throw Object.assign(new Error('P2P MySQL allows SELECT / SHOW / DESCRIBE / EXPLAIN only'), {
      code: 'P2P_WRITE_FORBIDDEN',
    });
  }
}

function assertReadOnlyUser(user) {
  const u = String(user || '').trim().toLowerCase();
  if (!u) {
    throw Object.assign(new Error('P2P_DB_USER is required'), { code: 'P2P_NOT_CONFIGURED' });
  }
  if (FORBIDDEN_USERS.has(u) || u.includes('p2p_app')) {
    throw Object.assign(
      new Error('Refusing P2P connection: use a dedicated read-only reporting user, never p2p_app'),
      { code: 'P2P_FORBIDDEN_USER' },
    );
  }
}

function isP2pConfigured() {
  return Boolean(
    process.env.P2P_DB_USER
      && process.env.P2P_DB_PASSWORD
      && (process.env.P2P_INSTANCE_CONNECTION_NAME || process.env.P2P_DB_HOST),
  );
}

function p2pConfig() {
  const user = process.env.P2P_DB_USER;
  assertReadOnlyUser(user);
  return {
    instanceConnectionName:
      process.env.P2P_INSTANCE_CONNECTION_NAME || 'master-diorama-489103-u2:asia-south1:p2p-mysql',
    host: process.env.P2P_DB_HOST || '127.0.0.1',
    port: Number(process.env.P2P_DB_PORT || 3306),
    database: process.env.P2P_DB_NAME || 'p2p_system',
    user,
    password: process.env.P2P_DB_PASSWORD || '',
  };
}

let poolPromise = null;

async function getP2pPool() {
  if (!isP2pConfigured()) {
    const err = new Error('P2P MySQL read-only credentials are not configured');
    err.code = 'P2P_NOT_CONFIGURED';
    throw err;
  }
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    let mysql;
    try {
      mysql = require('mysql2/promise');
    } catch {
      const err = new Error('mysql2 is not installed in backend-api — add dependency for P2P RO reads');
      err.code = 'P2P_DRIVER_MISSING';
      throw err;
    }
    const cfg = p2pConfig();
    assertReadOnlyUser(cfg.user);

    // Prefer Cloud SQL Node Connector when instance name is set and host is not forced.
    if (cfg.instanceConnectionName && !process.env.P2P_DB_HOST) {
      const { Connector } = require('@google-cloud/cloud-sql-connector');
      const connector = new Connector();
      const clientOpts = await connector.getOptions({
        instanceConnectionName: cfg.instanceConnectionName,
        ipType: 'PUBLIC',
      });
      return mysql.createPool({
        ...clientOpts,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
        waitForConnections: true,
        connectionLimit: 4,
        enableKeepAlive: true,
      });
    }

    return mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: 4,
      enableKeepAlive: true,
    });
  })();

  return poolPromise;
}

/** Read-only query helper — rejects any non-SELECT statement. */
async function p2pQuery(sql, params = []) {
  assertReadOnlySql(sql);
  const pool = await getP2pPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = {
  FORBIDDEN_USERS,
  assertReadOnlySql,
  assertReadOnlyUser,
  isP2pConfigured,
  p2pConfig,
  getP2pPool,
  p2pQuery,
};
