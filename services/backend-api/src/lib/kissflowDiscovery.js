'use strict';

/**
 * Kissflow connection test + optional resource discovery before PostgreSQL registration.
 */
const { normalizeEnvironment } = require('./kissflowClient');

const OPEN_STATUSES = new Set([
  'inprogress',
  'in progress',
  'in_progress',
  'pending',
  'open',
  'active',
  'submitted',
]);

const CLOSED_STATUSES = new Set([
  'completed',
  'complete',
  'closed',
  'rejected',
  'cancelled',
  'canceled',
  'withdrawn',
]);

function buildBaseUrl(subdomain, region) {
  const sub = String(subdomain || 'refexgroup').trim();
  const reg = String(region || 'com').trim() || 'com';
  return `https://${sub}.kissflow.${reg}`;
}

async function kissflowFetch({ baseUrl, accountId, keyId, secret, path, query = {} }) {
  const params = new URLSearchParams(query);
  const url = `${baseUrl}${path}${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, {
    headers: {
      'X-Access-Key-Id': keyId,
      'X-Access-Key-Secret': secret,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(
      res.status === 403
        ? '403 Forbidden — Admin Access Key required.'
        : res.status === 401
          ? '401 Unauthorized — check Access Key ID / Secret.'
          : `Kissflow HTTP ${res.status}`,
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

function normalizeIdList(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function mergeIds(existing, discovered) {
  return normalizeIdList([...(existing || []), ...(discovered || [])]);
}

function extractProcessStatus(item) {
  if (!item || typeof item !== 'object') return '';
  const raw =
    item._status ??
    item.Status ??
    item.status ??
    item.process_status ??
    item.Process_Status ??
    '';
  return String(raw).trim();
}

function classifyItemStatus(rawStatus) {
  const lower = String(rawStatus || '').toLowerCase();
  if (!lower) return 'unknown';
  if (OPEN_STATUSES.has(lower)) return 'open';
  if (CLOSED_STATUSES.has(lower)) return 'closed';
  return 'other';
}

function filterItemsForFieldDiscovery(items, { inProgressOnly = true } = {}) {
  if (!inProgressOnly) return items;
  return items.filter((item) => {
    const status = classifyItemStatus(extractProcessStatus(item));
    return status === 'open' || status === 'unknown';
  });
}

async function tryDiscoverProcesses({ baseUrl, accountId, keyId, secret, applicationId, processIds }) {
  const discovered = [];
  const warnings = [];

  const candidates = normalizeIdList(processIds);
  if (applicationId && !candidates.includes(applicationId)) {
    candidates.unshift(applicationId);
  }

  for (const processId of candidates.slice(0, 5)) {
    try {
      await kissflowFetch({
        baseUrl,
        accountId,
        keyId,
        secret,
        path: `/process/2/${encodeURIComponent(accountId)}/admin/${encodeURIComponent(processId)}/item`,
        query: { page_number: 1, page_size: 1, apply_preference: '1' },
      });
      discovered.push(processId);
    } catch (err) {
      warnings.push(`Process ${processId}: ${err.message}`);
    }
  }

  return { process_ids: discovered, warnings };
}

async function tryDiscoverOptionalResources({ baseUrl, accountId, keyId, secret }) {
  const result = { dataform_ids: [], board_ids: [], dataset_ids: [], warnings: [] };
  const attempts = [
    { key: 'dataform_ids', path: `/dataform/2/${encodeURIComponent(accountId)}/` },
    { key: 'board_ids', path: `/board/2/${encodeURIComponent(accountId)}/` },
    { key: 'dataset_ids', path: `/dataset/2/${encodeURIComponent(accountId)}/` },
  ];

  for (const attempt of attempts) {
    try {
      const data = await kissflowFetch({ baseUrl, accountId, keyId, secret, path: attempt.path });
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.Data)
          ? data.Data
          : Array.isArray(data?.items)
            ? data.items
            : [];
      result[attempt.key] = normalizeIdList(
        rows.map((row) => row._id || row.id || row.Id || row.name || row.Name),
      );
    } catch (err) {
      result.warnings.push(`${attempt.key}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Validate Kissflow credentials and optionally discover processes/resources.
 */
async function validateAndDiscoverRegistrationInput(input) {
  const environment = normalizeEnvironment(input.environment);
  const baseUrl = buildBaseUrl(input.subdomain, input.region);
  const accountId = input.kissflowAccountId;
  const keyId = input.accessKeyId;
  const secret = input.accessKeySecret;

  if (!accountId || !keyId || !secret) {
    const err = new Error('kissflow_account_id, access_key_id, and access_key_secret are required');
    err.code = 'VALIDATION_FAILED';
    throw err;
  }

  const warnings = [];
  let connectionOk = false;

  try {
    await kissflowFetch({
      baseUrl,
      accountId,
      keyId,
      secret,
      path: `/user/2/${encodeURIComponent(accountId)}/`,
      query: { page_number: 1, page_size: 1 },
    });
    connectionOk = true;
  } catch (userErr) {
    warnings.push(`User API probe: ${userErr.message}`);
    const probeProcess = normalizeIdList(input.processIds)[0] || input.applicationId;
    if (probeProcess) {
      await kissflowFetch({
        baseUrl,
        accountId,
        keyId,
        secret,
        path: `/process/2/${encodeURIComponent(accountId)}/admin/${encodeURIComponent(probeProcess)}/item`,
        query: { page_number: 1, page_size: 1, apply_preference: '1' },
      });
      connectionOk = true;
    } else {
      throw userErr;
    }
  }

  const processDiscovery = await tryDiscoverProcesses({
    baseUrl,
    accountId,
    keyId,
    secret,
    applicationId: input.applicationId,
    processIds: input.processIds,
  });
  warnings.push(...processDiscovery.warnings);

  const optional = await tryDiscoverOptionalResources({ baseUrl, accountId, keyId, secret });
  warnings.push(...optional.warnings);

  return {
    ok: connectionOk,
    environment,
    base_url: baseUrl,
    process_ids: mergeIds(input.processIds, processDiscovery.process_ids),
    dataform_ids: mergeIds(input.dataformIds, optional.dataform_ids),
    board_ids: mergeIds(input.boardIds, optional.board_ids),
    dataset_ids: mergeIds(input.datasetIds, optional.dataset_ids),
    warnings: warnings.filter(Boolean),
  };
}

module.exports = {
  buildBaseUrl,
  kissflowFetch,
  filterItemsForFieldDiscovery,
  classifyItemStatus,
  extractProcessStatus,
  mergeIds,
  normalizeIdList,
  validateAndDiscoverRegistrationInput,
};
