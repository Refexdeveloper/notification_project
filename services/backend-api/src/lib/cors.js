'use strict';

/**
 * CORS for Admin UI → backend-api (cross-origin on Cloud Run).
 * With credentials: true, Access-Control-Allow-Origin cannot be "*".
 */
function resolveCorsOptions() {
  const raw = String(process.env.CORS_ORIGIN || 'http://localhost:3000').trim();
  const credentials = process.env.CORS_CREDENTIALS !== 'false';

  if (raw === '*') {
    return {
      origin(origin, callback) {
        callback(null, origin || true);
      },
      credentials,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'X-Correlation-Id', 'Authorization', 'Idempotency-Key'],
    };
  }

  const allowed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const allowList = new Set(allowed);
  // Always permit Cloud Run Admin UI hostnames when explicitly listed origins are used.
  const cloudRunAdminPattern = /^https:\/\/refex-admin-ui[-a-z0-9.]*\.run\.app$/i;

  if (allowed.length === 1) {
    return {
      origin: allowed[0],
      credentials,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'X-Correlation-Id', 'Authorization', 'Idempotency-Key'],
    };
  }

  return {
    origin(origin, callback) {
      if (!origin || allowList.has(origin) || cloudRunAdminPattern.test(origin)) {
        callback(null, origin || allowed[0] || true);
        return;
      }
      callback(null, false);
    },
    credentials,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Correlation-Id', 'Authorization', 'Idempotency-Key'],
  };
}

module.exports = { resolveCorsOptions };
