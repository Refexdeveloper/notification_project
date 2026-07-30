'use strict';

const express = require('express');
const { ok } = require('../lib/envelope');
const { checkConnection } = require('../lib/db');

const router = express.Router();

router.get('/health', (req, res) => {
  ok(res, req.correlationId, {
    status: 'alive',
    git_sha: process.env.GIT_SHA || 'unknown',
  });
});

router.get('/ready', async (req, res) => {
  try {
    await checkConnection();
    ok(res, req.correlationId, { status: 'ready', database: 'connected' });
  } catch (err) {
    res.status(503).json({
      success: false,
      correlation_id: req.correlationId,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'PostgreSQL not reachable',
        retryable: true,
      },
    });
  }
});

module.exports = router;
