'use strict';

const crypto = require('crypto');

function normalizeEnvironment(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  if (lower === 'uat') return 'uat';
  if (lower === 'staging') return 'staging';
  return lower;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function buildCredentialSecretResource() {
  const project =
    process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'master-diorama-489103-u2';
  const keyIdSecret =
    process.env.KISSFLOW_KEY_ID_SECRET || `projects/${project}/secrets/kissflow-developer-key-id`;
  const keySecretSecret =
    process.env.KISSFLOW_KEY_SECRET_SECRET ||
    `projects/${project}/secrets/kissflow-developer-key-secret`;
  return JSON.stringify({ key_id: keyIdSecret, key_secret: keySecretSecret });
}

function hashPayload(input) {
  const redacted = {
    ...input,
    access_key_id: '[redacted]',
    access_key_secret: '[redacted]',
  };
  return crypto.createHash('sha256').update(JSON.stringify(redacted)).digest('hex');
}

function normalizeRegistrationBody(body) {
  const source = body && typeof body === 'object' ? body : {};
  const errors = [];

  const kissflowAccountId = String(source.kissflow_account_id || source.account_id || '').trim();
  const applicationId = String(source.application_id || source.app_id || '').trim();
  const subdomain = String(source.subdomain || '').trim();
  const accessKeyId = String(source.access_key_id || '').trim();
  const accessKeySecret = String(source.access_key_secret || '').trim();
  const environment = normalizeEnvironment(source.environment || 'development');

  if (!kissflowAccountId) errors.push('kissflow_account_id is required');
  if (!applicationId) errors.push('application_id is required');
  if (!subdomain) errors.push('subdomain is required');
  if (!accessKeyId) errors.push('access_key_id is required');
  if (!accessKeySecret) errors.push('access_key_secret is required');
  if (!environment) errors.push('environment is required');

  const applicationName =
    String(source.application_name || source.name || applicationId).trim() || applicationId;
  const displayName =
    String(source.display_name || source.name || `Refex ${environment}`).trim() ||
    `Refex ${environment}`;

  return {
    errors,
    input: {
      kissflowAccountId,
      applicationId,
      applicationName,
      displayName,
      subdomain,
      region: String(source.region || 'com').trim() || 'com',
      description: String(source.description || '').trim(),
      environment,
      accessKeyId,
      accessKeySecret,
      processIds: normalizeStringList(source.process_ids ?? source.processIds),
      dataformIds: normalizeStringList(source.dataform_ids ?? source.dataformIds),
      boardIds: normalizeStringList(source.board_ids ?? source.boardIds),
      datasetIds: normalizeStringList(source.dataset_ids ?? source.datasetIds),
    },
  };
}

async function findIdempotentReplay(client, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT evidence
     FROM engagement_reporting.audit_event
     WHERE action = 'REGISTER_APPLICATION'
       AND evidence->>'idempotency_key' = $1
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [idempotencyKey],
  );
  if (!rows.length) return null;
  const response = rows[0].evidence?.response;
  if (!response) return null;
  return { item: response, idempotent_replay: true };
}

class RegistrationConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 409;
  }
}

async function registerApplication(client, { input, idempotencyKey, correlationId, actorSubject }) {
  const replay = await findIdempotentReplay(client, idempotencyKey);
  if (replay) return replay;

  const existing = await client.query(
    `SELECT source_payload
     FROM engagement_reporting.application
     WHERE environment = $1 AND application_id = $2`,
    [input.environment, input.applicationId],
  );
  if (existing.rows.length) {
    const payload = existing.rows[0].source_payload || {};
    const existingAccount = payload.kissflow_account_id;
    if (existingAccount && existingAccount !== input.kissflowAccountId) {
      throw new RegistrationConflictError(
        'APPLICATION_ACCOUNT_MISMATCH',
        'Application already registered under a different Kissflow account',
      );
    }
  }

  const accountResult = await client.query(
    `INSERT INTO engagement_reporting.account (display_name, kissflow_account_id, environment, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (kissflow_account_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           environment = EXCLUDED.environment,
           updated_at = now()
     RETURNING account_id`,
    [input.displayName, input.kissflowAccountId, input.environment],
  );
  const accountId = accountResult.rows[0].account_id;

  const secretResource = buildCredentialSecretResource();
  const bindingResult = await client.query(
    `INSERT INTO engagement_reporting.credential_binding (account_id, provider, secret_resource)
     VALUES ($1, 'KISSFLOW', $2)
     ON CONFLICT (account_id, provider) DO UPDATE
       SET secret_resource = EXCLUDED.secret_resource
     RETURNING credential_binding_id`,
    [accountId, secretResource],
  );
  const credentialBindingId = bindingResult.rows[0].credential_binding_id;

  const sourcePayload = {
    kissflow_account_id: input.kissflowAccountId,
    subdomain: input.subdomain,
    region: input.region,
    description: input.description,
    dataform_ids: input.dataformIds,
    board_ids: input.boardIds,
    dataset_ids: input.datasetIds,
    account_id: accountId,
    registered_at: new Date().toISOString(),
  };

  await client.query(
    `INSERT INTO engagement_reporting.application
       (environment, application_id, application_name, first_seen_at, last_seen_at, is_current, source_payload)
     VALUES ($1, $2, $3, now(), now(), true, $4::jsonb)
     ON CONFLICT (environment, application_id) DO UPDATE
       SET application_name = EXCLUDED.application_name,
           last_seen_at = now(),
           is_current = true,
           source_payload = COALESCE(engagement_reporting.application.source_payload, '{}'::jsonb) || EXCLUDED.source_payload`,
    [input.environment, input.applicationId, input.applicationName, JSON.stringify(sourcePayload)],
  );

  for (const processId of input.processIds) {
    await client.query(
      `INSERT INTO engagement_reporting.process
         (environment, process_id, application_id, process_name, first_seen_at, last_seen_at, is_current, source_payload)
       VALUES ($1, $2, $3, $4, now(), now(), true, '{}'::jsonb)
       ON CONFLICT (environment, process_id) DO UPDATE
         SET application_id = EXCLUDED.application_id,
             process_name = EXCLUDED.process_name,
             last_seen_at = now(),
             is_current = true`,
      [input.environment, processId, input.applicationId, processId],
    );
  }

  const item = {
    account_id: accountId,
    credential_binding_id: credentialBindingId,
    environment: input.environment,
    application_id: input.applicationId,
    application_name: input.applicationName,
    kissflow_account_id: input.kissflowAccountId,
    subdomain: input.subdomain,
    region: input.region,
    process_ids: input.processIds,
    route_id: `${input.environment}-${input.applicationId}`,
    credentials_persisted: false,
    credential_secret_resource: secretResource,
  };

  await client.query(
    `INSERT INTO engagement_reporting.audit_event
       (actor_subject, action, resource_type, resource_id, correlation_id, evidence)
     VALUES ($1, 'REGISTER_APPLICATION', 'application', $2, $3, $4::jsonb)`,
    [
      actorSubject,
      input.applicationId,
      correlationId,
      JSON.stringify({
        idempotency_key: idempotencyKey,
        payload_hash: hashPayload(input),
        response: item,
      }),
    ],
  );

  return { item, idempotent_replay: false };
}

module.exports = {
  RegistrationConflictError,
  normalizeRegistrationBody,
  registerApplication,
};
