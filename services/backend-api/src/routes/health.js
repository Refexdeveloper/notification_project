'use strict';

const express = require('express');
const { ok } = require('../lib/envelope');
const { checkConnection, isDatabaseConfigured } = require('../lib/db');

const router = express.Router();

router.get('/health', (req, res) => {
  ok(res, req.correlationId, {
    status: 'alive',
    git_sha: process.env.GIT_SHA || 'unknown',
    database_configured: isDatabaseConfigured(),
  });
});

router.get('/ready', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, {
      status: 'ready',
      database: 'skipped',
      note: 'Set PGPASSWORD in .env to enable PostgreSQL',
    });
  }
  try {
    await checkConnection();
    ok(res, req.correlationId, { status: 'ready', database: 'connected' });
  } catch (err) {
    res.status(503).json({
      success: false,
      correlation_id: req.correlationId,
      error: {
        code: err.code === 'DATABASE_NOT_CONFIGURED' ? 'DATABASE_NOT_CONFIGURED' : 'DATABASE_UNAVAILABLE',
        message: err.message,
        retryable: true,
      },
    });
  }
});

module.exports = router;
