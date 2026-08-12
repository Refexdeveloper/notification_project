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
  updateApplicationMetadata,
  attachApplicationResources,
} = require('../lib/applicationRegistration');
const {
  validateAndDiscoverRegistrationInput,
  tryDiscoverProcesses,
  buildBaseUrl,
  normalizeIdList,
} = require('../lib/kissflowDiscovery');
const { bootstrapApplication } = require('../lib/applicationBootstrap');
const { normalizeEnvironment, resolveKissflowCredentials } = require('../lib/kissflowClient');
const { syncProcessFields } = require('../lib/fieldSyncService');

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
  source_payload->>'description' AS description,
  COALESCE(source_payload->'dataform_ids', '[]'::jsonb) AS dataform_ids,
  COALESCE(source_payload->'board_ids', '[]'::jsonb) AS board_ids,
  COALESCE(source_payload->'dataset_ids', '[]'::jsonb) AS dataset_ids
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
  const session = await resolveSession(req);
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

  const session = await resolveSession(req);
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

router.get('/:applicationId/credentials-status', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, {
      credentials_configured: false,
      warning: 'DATABASE_NOT_CONFIGURED',
    });
  }

  const environment = String(req.query.environment || 'production').toLowerCase();
  const applicationId = req.params.applicationId;

  try {
    const { rows } = await getPool().query(
      `SELECT
         a.source_payload->>'kissflow_account_id' AS kissflow_account_id,
         a.source_payload->>'account_id' AS account_uuid,
         cb.provider,
         cb.secret_resource,
         cb.created_at AS credentials_bound_at
       FROM engagement_reporting.application a
       LEFT JOIN engagement_reporting.credential_binding cb
         ON cb.account_id = (a.source_payload->>'account_id')::uuid
        AND cb.provider = 'KISSFLOW'
       WHERE a.environment = $1
         AND a.application_id = $2
         AND a.is_current = true
       LIMIT 1`,
      [environment, applicationId],
    );

    if (!rows.length) {
      return fail(res, req.correlationId, 'APPLICATION_NOT_FOUND', 'Application not found', 404);
    }

    const row = rows[0];
    let secretHints = [];
    if (row.secret_resource) {
      try {
        const parsed = JSON.parse(row.secret_resource);
        secretHints = Object.values(parsed).map((v) => String(v).split('/').pop() || String(v));
      } catch {
        secretHints = [String(row.secret_resource).split('/').pop() || row.secret_resource];
      }
    }

    return ok(res, req.correlationId, {
      credentials_configured: Boolean(row.secret_resource),
      kissflow_account_id: row.kissflow_account_id || null,
      provider: row.provider || 'KISSFLOW',
      secret_hints: secretHints,
      credentials_bound_at: row.credentials_bound_at || null,
      note: 'Access keys are stored in GCP Secret Manager and are never returned by the API.',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { credentials_configured: false, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'CREDENTIALS_STATUS_FAILED', err.message, 500, true);
  }
});

router.patch('/:applicationId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const session = await resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const environment = String(req.query.environment || req.body?.environment || 'production').toLowerCase();
  const applicationId = req.params.applicationId;
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'application_name')) {
    patch.application_name = body.application_name;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    patch.application_name = body.name;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    patch.description = body.description;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'subdomain')) {
    patch.subdomain = body.subdomain;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'region')) {
    patch.region = body.region;
  }

  if (!Object.keys(patch).length) {
    return fail(
      res,
      req.correlationId,
      'UPDATE_FIELDS_REQUIRED',
      'Provide application_name, description, subdomain, and/or region',
      400,
    );
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const item = await updateApplicationMetadata(client, {
      environment,
      applicationId,
      patch,
      actorSubject: session.subject,
      correlationId: req.correlationId,
    });
    await client.query('COMMIT');
    return ok(res, req.correlationId, { item, environment, application_id: applicationId });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'APPLICATION_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, err.status || 404);
    }
    return fail(res, req.correlationId, 'APPLICATION_UPDATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.delete('/:applicationId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const session = await resolveSession(req);
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

/**
 * Add processes / dataforms / boards / datasets to an already-connected application.
 * Processes are validated against Kissflow Admin Get-all-items before insert.
 */
router.post('/:applicationId/resources', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const session = await resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const environment = normalizeEnvironment(
    req.query.environment || req.body?.environment || 'production',
  );
  const applicationId = req.params.applicationId;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const processIds = normalizeIdList(body.process_ids ?? body.processIds);
  const dataformIds = body.dataform_ids !== undefined || body.dataformIds !== undefined
    ? normalizeIdList(body.dataform_ids ?? body.dataformIds)
    : undefined;
  const boardIds = body.board_ids !== undefined || body.boardIds !== undefined
    ? normalizeIdList(body.board_ids ?? body.boardIds)
    : undefined;
  const datasetIds = body.dataset_ids !== undefined || body.datasetIds !== undefined
    ? normalizeIdList(body.dataset_ids ?? body.datasetIds)
    : undefined;
  const syncFields = body.sync_fields !== false;

  if (
    !processIds.length &&
    dataformIds === undefined &&
    boardIds === undefined &&
    datasetIds === undefined
  ) {
    return fail(
      res,
      req.correlationId,
      'RESOURCES_REQUIRED',
      'Provide process_ids and/or dataform_ids / board_ids / dataset_ids',
      400,
    );
  }

  const pool = getPool();
  const { rows: appRows } = await pool.query(
    `SELECT
       application_id,
       source_payload->>'subdomain' AS subdomain,
       source_payload->>'region' AS region,
       source_payload->>'kissflow_account_id' AS kissflow_account_id
     FROM engagement_reporting.application
     WHERE environment = $1 AND application_id = $2 AND is_current = true`,
    [environment, applicationId],
  );
  if (!appRows.length) {
    return fail(res, req.correlationId, 'APPLICATION_NOT_FOUND', 'Application not found', 404);
  }

  const { rows: existingProcessRows } = await pool.query(
    `SELECT process_id
     FROM engagement_reporting.process
     WHERE environment = $1 AND application_id = $2 AND is_current = true`,
    [environment, applicationId],
  );
  const alreadyLinked = new Set(existingProcessRows.map((r) => r.process_id));
  const newProcessIds = processIds.filter((id) => !alreadyLinked.has(id));

  let validatedProcessIds = processIds.filter((id) => alreadyLinked.has(id));
  let warnings = [];
  if (newProcessIds.length) {
    try {
      const credentials = await resolveKissflowCredentials(environment);
      if (!credentials.keyId || !credentials.secret) {
        return fail(
          res,
          req.correlationId,
          'KISSFLOW_CREDENTIALS_MISSING',
          'Kissflow API credentials are not configured',
          503,
        );
      }
      const baseUrl = buildBaseUrl(
        appRows[0].subdomain || credentials.subdomain || 'refexgroup',
        appRows[0].region || 'com',
      );
      const accountId = appRows[0].kissflow_account_id || credentials.accountId;
      const discovery = await tryDiscoverProcesses({
        baseUrl,
        accountId,
        keyId: credentials.keyId,
        secret: credentials.secret,
        applicationId,
        processIds: newProcessIds,
      });
      warnings = discovery.warnings || [];
      validatedProcessIds = [...validatedProcessIds, ...(discovery.process_ids || [])];
      if (!(discovery.process_ids || []).length) {
        return fail(
          res,
          req.correlationId,
          'PROCESS_VALIDATION_FAILED',
          warnings.join(' ') || 'Could not validate any new process IDs against Kissflow',
          400,
        );
      }
    } catch (err) {
      return fail(
        res,
        req.correlationId,
        err.code || 'PROCESS_VALIDATION_FAILED',
        err.message,
        err.status || 502,
        true,
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attached = await attachApplicationResources(client, {
      environment,
      applicationId,
      processIds: validatedProcessIds,
      dataformIds,
      boardIds,
      datasetIds,
      actorSubject: session.subject,
      correlationId: req.correlationId,
    });
    await client.query('COMMIT');

    let field_sync = [];
    if (syncFields && attached.added_process_ids.length) {
      for (const processId of attached.added_process_ids) {
        try {
          const syncResult = await syncProcessFields(pool, {
            environment,
            applicationId,
            processId,
            incremental: false,
            inProgressOnly: true,
            pageSize: 500,
          });
          field_sync.push({
            process_id: processId,
            ok: true,
            field_count: Array.isArray(syncResult.fields) ? syncResult.fields.length : 0,
            item_count: syncResult.item_count,
            synced_at: syncResult.synced_at,
          });
        } catch (err) {
          field_sync.push({
            process_id: processId,
            ok: false,
            error: err.message,
          });
        }
      }
    }

    return ok(res, req.correlationId, {
      ...attached,
      warnings,
      field_sync,
      environment,
      application_id: applicationId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof RegistrationConflictError || err.code === 'PROCESS_ALREADY_REGISTERED') {
      return fail(res, req.correlationId, err.code || 'PROCESS_ALREADY_REGISTERED', err.message, 409);
    }
    if (err.code === 'APPLICATION_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, 404);
    }
    return fail(res, req.correlationId, 'ATTACH_RESOURCES_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

/** First-time field sync, engagement cache, draft template + paused schedule after Connect. */
router.post('/:applicationId/bootstrap', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const environment = normalizeEnvironment(
    req.query.environment || req.body?.environment || 'production',
  );
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'environment is required', 400);
  }

  try {
    const result = await bootstrapApplication({
      environment,
      applicationId: req.params.applicationId,
    });
    return ok(res, req.correlationId, result);
  } catch (err) {
    if (err.code === 'KISSFLOW_CREDENTIALS_MISSING') {
      return fail(res, req.correlationId, err.code, err.message, 503);
    }
    return fail(res, req.correlationId, 'APPLICATION_BOOTSTRAP_FAILED', err.message, 500, true);
  }
});

module.exports = router;
