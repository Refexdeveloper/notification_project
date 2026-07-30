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
        // Reflect request origin so browsers accept credentials mode.
        callback(null, origin || true);
      },
      credentials,
    };
  }

  const allowed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (allowed.length === 1) {
    return { origin: allowed[0], credentials };
  }

  return {
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) {
        callback(null, origin || allowed[0]);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials,
  };
}

module.exports = { resolveCorsOptions };
