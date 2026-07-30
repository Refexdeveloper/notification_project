'use strict';

const { randomUUID } = require('crypto');

function correlationMiddleware(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  req.correlationId =
    typeof incoming === 'string' && incoming.length >= 8 ? incoming : randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
}

module.exports = { correlationMiddleware };
