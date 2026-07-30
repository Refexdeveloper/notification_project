'use strict';

function ok(res, correlationId, data, status = 200) {
  return res.status(status).json({ success: true, correlation_id: correlationId, data });
}

function fail(res, correlationId, code, message, status = 400, retryable = false) {
  return res.status(status).json({
    success: false,
    correlation_id: correlationId,
    error: { code, message, retryable },
  });
}

module.exports = { ok, fail };
