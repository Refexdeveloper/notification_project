'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { resolveSession } = require('../lib/session');
const {
  RegistrationConflictError,
  normalizeRegistrationBody,
  registerApplication,
  deleteApplication,
} = require('../lib/applicationRegistration');
const { validateAndDiscoverRegistrationInput } = require('../lib/kissflowDiscovery');

const router = express.Router();

const APPLICATIONS_QUERY = `
SELECT
  environment,
  application_id,
  application_name,
  last_seen_at,
  is_current,
  source_payload->>'kissflow_account_id' AS kissflow_account_id,
  source_payload->>'subdomain' AS subdomain,
  source_payload->>'region' AS region,
  source_payload->>'description' AS description
FROM engagement_reporting.application
WHERE is_current = true
ORDER BY application_name
`;

function dbNotConfigured(res, correlationId) {
  return ok(res, correlationId, {
    items: [],
    count: 0,
    warning: 'DATABASE_NOT_CONFIGURED',
    hint: 'Copy services/backend-api/.env.example to .env and set PGPASSWORD (or DATABASE_URL)',
  });
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }
  try {
    const { rows } = await getPool().query(APPLICATIONS_QUERY);
    ok(res, req.correlationId, { items: rows, count: rows.length });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    if (err.code === 'DATABASE_NOT_CONFIGURED') {
      return dbNotConfigured(res, req.correlationId);
    }
    if (err.message?.includes('password must be a string') || err.code === 'ECONNREFUSED') {
      return ok(res, req.correlationId, {
        items: [],
        count: 0,
        warning: 'DATABASE_UNAVAILABLE',
        hint: err.message,
      });
    }
    fail(res, req.correlationId, 'APPLICATIONS_LIST_FAILED', err.message, 500, true);
  }
});

router.post('/validate', async (req, res) => {
  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const { errors, input } = normalizeRegistrationBody(req.body);
  if (errors.length) {
    return fail(res, req.correlationId, 'VALIDATION_FAILED', errors.join('; '), 400);
  }

  try {
    const discovery = await validateAndDiscoverRegistrationInput(input);
    return ok(res, req.correlationId, {
      valid: true,
      ...discovery,
      application_id: input.applicationId,
      kissflow_account_id: input.kissflowAccountId,
    });
  } catch (err) {
    if (err.code === 'VALIDATION_FAILED') {
      return fail(res, req.correlationId, err.code, err.message, 400);
    }
    const status = err.status === 401 || err.status === 403 ? err.status : 502;
    return fail(
      res,
      req.correlationId,
      'KISSFLOW_VALIDATION_FAILED',
      err.message,
      status,
      status >= 500,
    );
  }
});

router.post('/', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey || String(idempotencyKey).length < 8) {
    return fail(res, req.correlationId, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header required', 400);
  }

  if (!isDatabaseConfigured()) {
    return fail(
      res,
      req.correlationId,
      'DATABASE_NOT_CONFIGURED',
      'PostgreSQL is required to register applications',
      503,
    );
  }

  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const { errors, input } = normalizeRegistrationBody(req.body);
  if (errors.length) {
    return fail(res, req.correlationId, 'VALIDATION_FAILED', errors.join('; '), 400);
  }

  let registrationInput = input;
  try {
    const discovery = await validateAndDiscoverRegistrationInput(input);
    registrationInput = {
      ...input,
      processIds: discovery.process_ids,
      dataformIds: discovery.dataform_ids,
      boardIds: discovery.board_ids,
      datasetIds: discovery.dataset_ids,
    };
  } catch (err) {
    const status = err.status === 401 || err.status === 403 ? err.status : 502;
    return fail(
      res,
      req.correlationId,
      'KISSFLOW_VALIDATION_FAILED',
      err.message,
      status,
      status >= 500,
    );
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await registerApplication(client, {
      input: registrationInput,
      idempotencyKey: String(idempotencyKey),
      correlationId: req.correlationId,
      actorSubject: session.subject,
    });
    await client.query('COMMIT');

    const status = result.idempotent_replay ? 200 : 201;
    return ok(res, req.correlationId, result, status);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof RegistrationConflictError) {
      return fail(res, req.correlationId, err.code, err.message, err.status);
    }
    if (err.code === '42P01') {
      return fail(res, req.correlationId, 'SCHEMA_NOT_MIGRATED', 'Database schema not migrated', 503);
    }
    return fail(res, req.correlationId, 'APPLICATION_REGISTER_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.delete('/:applicationId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const environment = String(req.query.environment || 'development').toLowerCase();
  const applicationId = req.params.applicationId;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await deleteApplication(client, {
      environment,
      applicationId,
      actorSubject: session.subject,
      correlationId: req.correlationId,
    });
    await client.query('COMMIT');
    return ok(res, req.correlationId, result);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'APPLICATION_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, err.status || 404);
    }
    return fail(res, req.correlationId, 'APPLICATION_DELETE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.get('/:applicationId/processes', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }
  try {
    const { rows } = await getPool().query(
      `SELECT
         environment,
         process_id,
         application_id,
         process_name,
         last_seen_at,
         is_current,
         source_payload->'field_discovery'->>'synced_at' AS field_sync_at,
         COALESCE((source_payload->'field_discovery'->>'item_count')::int, 0) AS field_item_count,
         COALESCE(jsonb_array_length(source_payload->'field_discovery'->'fields'), 0) AS field_count
       FROM engagement_reporting.process
       WHERE application_id = $1 AND is_current = true
       ORDER BY process_name`,
      [req.params.applicationId],
    );
    ok(res, req.correlationId, { items: rows, count: rows.length });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    fail(res, req.correlationId, 'PROCESSES_LIST_FAILED', err.message, 500, true);
  }
});

module.exports = router;
