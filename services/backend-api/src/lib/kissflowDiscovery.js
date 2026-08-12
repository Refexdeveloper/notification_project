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

function normalizeKissflowSubdomain(raw) {
  let value = String(raw || '').trim().toLowerCase();
  if (!value) return '';

  // Accept pasted URLs / hostnames:
  //   https://refexgroup.kissflow.com
  //   refexgroup.kissflow.com
  //   refexgroup.kissflow.eu/
  value = value.replace(/^https?:\/\//, '');
  value = value.split('/')[0];
  value = value.split('?')[0];

  const hostMatch = value.match(/^([a-z0-9][a-z0-9.-]*)\.kissflow\.(com|eu)$/i);
  if (hostMatch) {
    return { subdomain: hostMatch[1], region: hostMatch[2].toLowerCase() };
  }

  // Strip accidental trailing ".kissflow.com" / ".kissflow.eu"
  value = value.replace(/\.kissflow\.(com|eu)$/i, '');
  value = value.replace(/\.+$/, '');
  return { subdomain: value, region: null };
}

function buildBaseUrl(subdomain, region) {
  const normalized =
    typeof subdomain === 'object' && subdomain
      ? subdomain
      : normalizeKissflowSubdomain(subdomain);
  const sub =
    (normalized && normalized.subdomain) ||
    (typeof subdomain === 'string' ? String(subdomain).trim() : '') ||
    'refexgroup';
  const reg =
    String(region || (normalized && normalized.region) || 'com')
      .trim()
      .toLowerCase() || 'com';
  return `https://${sub}.kissflow.${reg}`;
}

async function kissflowFetch({ baseUrl, accountId, keyId, secret, path, query = {} }) {
  const params = new URLSearchParams(query);
  const url = `${baseUrl}${path}${params.toString() ? `?${params}` : ''}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'X-Access-Key-Id': keyId,
        'X-Access-Key-Secret': secret,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    const detail = err && err.message ? err.message : 'network error';
    const wrapped = new Error(
      `Cannot reach Kissflow at ${baseUrl} (${detail}). Use subdomain only (e.g. refexgroup), not the full host.`,
    );
    wrapped.status = 0;
    wrapped.code = 'KISSFLOW_NETWORK_ERROR';
    throw wrapped;
  }
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

  // Prefer explicit process IDs. Application ID is often NOT a process
  // (e.g. Expense_and_Travel_Management_A00 vs Travel_Management_A02).
  const candidates = normalizeIdList(processIds);
  if (candidates.length === 0 && applicationId) {
    candidates.push(applicationId);
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
      const status = err && err.status;
      if (status === 403) {
        warnings.push(
          `Process ${processId}: Admin Access Key required (403). Use a Kissflow Admin API key with access to this process.`,
        );
      } else if (status === 404) {
        warnings.push(`Process ${processId}: not found (404). Check the Process ID.`);
      } else {
        warnings.push(`Process ${processId}: ${err.message}`);
      }
    }
  }

  if (candidates.length === 0) {
    warnings.push('No process IDs provided — add at least one process (e.g. Travel_Management_A02).');
  }

  return { process_ids: discovered, warnings };
}

async function tryDiscoverOptionalResources({ baseUrl, accountId, keyId, secret }) {
  const result = { dataform_ids: [], board_ids: [], dataset_ids: [], warnings: [] };
  const attempts = [
    { key: 'dataform_ids', label: 'Dataforms', path: `/dataform/2/${encodeURIComponent(accountId)}/` },
    { key: 'board_ids', label: 'Boards', path: `/board/2/${encodeURIComponent(accountId)}/` },
    { key: 'dataset_ids', label: 'Datasets', path: `/dataset/2/${encodeURIComponent(accountId)}/` },
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
      // Optional resources — 404/403 are common and non-blocking for process apps.
      const status = err && err.status;
      if (status === 404 || status === 403) {
        continue;
      }
      result.warnings.push(`${attempt.label}: ${err.message}`);
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
    // User list probe often needs different scopes — fall back to process Admin API.
    const probeCandidates = normalizeIdList(input.processIds || []);
    if (probeCandidates.length === 0 && input.applicationId) {
      probeCandidates.push(input.applicationId);
    }
    let probed = false;
    let lastProbeErr = userErr;
    for (const probeProcess of probeCandidates.slice(0, 5)) {
      try {
        await kissflowFetch({
          baseUrl,
          accountId,
          keyId,
          secret,
          path: `/process/2/${encodeURIComponent(accountId)}/admin/${encodeURIComponent(probeProcess)}/item`,
          query: { page_number: 1, page_size: 1, apply_preference: '1' },
        });
        connectionOk = true;
        probed = true;
        break;
      } catch (probeErr) {
        lastProbeErr = probeErr;
      }
    }
    if (!probed) {
      throw lastProbeErr;
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

  const requestedProcesses = normalizeIdList(input.processIds);
  if (requestedProcesses.length > 0 && processDiscovery.process_ids.length === 0) {
    const err = new Error(
      `Could not access process Admin API for: ${requestedProcesses.join(', ')}. ` +
        'Use a Kissflow Admin Access Key that can call Admin Get-all-items for this process.',
    );
    err.code = 'KISSFLOW_VALIDATION_FAILED';
    err.status = 403;
    throw err;
  }

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
  normalizeKissflowSubdomain,
  kissflowFetch,
  filterItemsForFieldDiscovery,
  classifyItemStatus,
  extractProcessStatus,
  mergeIds,
  normalizeIdList,
  tryDiscoverProcesses,
  tryDiscoverOptionalResources,
  validateAndDiscoverRegistrationInput,
};
