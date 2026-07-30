'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');

const router = express.Router();

const { resolveSession } = require('../lib/session');
router.get('/session', (req, res) => {
  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }
  ok(res, req.correlationId, session);
});

module.exports = router;
