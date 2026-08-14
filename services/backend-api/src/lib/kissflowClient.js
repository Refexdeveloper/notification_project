'use strict';

const fs = require('fs');
const path = require('path');

function repoRoot() {
  return path.resolve(__dirname, '../../../..');
}

function readEnvFileVar(key, filePath) {
  if (!fs.existsSync(filePath)) return '';
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    if (name !== key) continue;
    let value = trimmed.slice(eq + 1);
    value = value.replace(/^["']|["']$/g, '');
    return value.trim();
  }
  return '';
}

function normalizeEnvironment(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower;
}

async function readGcpSecret(secretName) {
  const project =
    process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'master-diorama-489103-u2';

  if (process.env.KISSFLOW_KEY && secretName.includes('key-id')) {
    return process.env.KISSFLOW_KEY;
  }
  if (process.env.KISSFLOW_SECRET && secretName.includes('key-secret')) {
    return process.env.KISSFLOW_SECRET;
  }

  try {
    const metadataBase = 'http://metadata.google.internal/computeMetadata/v1';
    const tokenRes = await fetch(`${metadataBase}/instance/service-accounts/default/token`, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (tokenRes.ok) {
      const tokenJson = await tokenRes.json();
      const accessToken = tokenJson.access_token;
      if (accessToken) {
        const url = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${secretName}/versions/latest:access`;
        const secretRes = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (secretRes.ok) {
          const secretJson = await secretRes.json();
          if (secretJson.payload?.data) {
            return Buffer.from(secretJson.payload.data, 'base64').toString('utf8').trim();
          }
        }
      }
    }
  } catch {
    /* fall through to gcloud CLI for local dev */
  }

  try {
    const { execSync } = require('child_process');
    return String(
      execSync(`gcloud secrets versions access latest --secret=${secretName} --project=${project}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Resolve Kissflow credentials for pipeline/API calls.
 * Priority: env vars > apps/admin-ui/.env.local > GCP Secret Manager
 */
async function resolveKissflowCredentials(environment) {
  const env = normalizeEnvironment(environment);
  const isProd = env === 'production';
  const envFile = process.env.KISSFLOW_ENV_FILE || path.join(repoRoot(), 'apps/admin-ui/.env.local');

  let accountId = process.env.KISSFLOW_ACCOUNT_ID || '';
  let keyId = process.env.KISSFLOW_KEY || process.env.KISSFLOW_ACCESS_KEY_ID || '';
  let secret = process.env.KISSFLOW_SECRET || process.env.KISSFLOW_ACCESS_KEY_SECRET || '';

  if (isProd) {
    accountId =
      accountId ||
      readEnvFileVar('VITE_KISSFLOW_PROD_ACCOUNT_ID', envFile) ||
      'AcCMptlq60zH';
    keyId = keyId || readEnvFileVar('VITE_KISSFLOW_PROD_ACCESS_KEY_ID', envFile);
    secret = secret || readEnvFileVar('VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET', envFile);
  } else {
    accountId =
      accountId ||
      readEnvFileVar('VITE_KISSFLOW_DEV_ACCOUNT_ID', envFile) ||
      'AcCMptp3yqcn';
    keyId = keyId || readEnvFileVar('VITE_KISSFLOW_DEV_ACCESS_KEY_ID', envFile);
    secret = secret || readEnvFileVar('VITE_KISSFLOW_DEV_ACCESS_KEY_SECRET', envFile);
  }

  if (!keyId || !secret) {
    keyId =
      keyId ||
      (await readGcpSecret('engagement-report-kissflow-key-id')) ||
      (await readGcpSecret('kissflow-developer-key-id'));
    secret =
      secret ||
      (await readGcpSecret('engagement-report-kissflow-key-secret')) ||
      (await readGcpSecret('kissflow-developer-key-secret'));
  }

  const subdomain =
    process.env.KISSFLOW_SUBDOMAIN ||
    (isProd ? 'refexgroup' : 'development-refexgroup');

  return {
    accountId,
    keyId,
    secret,
    subdomain,
    baseUrl: process.env.KISSFLOW_BASE_URL || `https://${subdomain}.kissflow.com`,
  };
}

async function kissflowGet({
  environment,
  accountId,
  processId,
  pageNumber = 1,
  pageSize = 1000,
  applyPreference = true,
  credentials,
}) {
  const creds = credentials || (await resolveKissflowCredentials(environment));
  const account = accountId || creds.accountId;
  if (!account || !creds.keyId || !creds.secret) {
    const err = new Error(
      'Kissflow credentials not configured. Run ops/runbooks/sync-kissflow-env-local.sh or set GCP secrets.',
    );
    err.code = 'KISSFLOW_CREDENTIALS_MISSING';
    throw err;
  }

  const pref = applyPreference ? '1' : 'false';
  const url = `${creds.baseUrl}/process/2/${encodeURIComponent(account)}/admin/${encodeURIComponent(processId)}/item?page_number=${pageNumber}&page_size=${pageSize}&apply_preference=${pref}`;

  const res = await fetch(url, {
    headers: {
      'X-Access-Key-Id': creds.keyId,
      'X-Access-Key-Secret': creds.secret,
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
        ? '403 Forbidden: Admin Access Key required for Get all items.'
        : res.status === 401
          ? '401 Unauthorized: check Access Key ID / Secret.'
          : `Kissflow request failed: HTTP ${res.status}`,
    );
    err.status = res.status;
    throw err;
  }

  return { data, accountId: account, subdomain: creds.subdomain };
}

function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['Data', 'data', 'Users', 'users', 'Items', 'items', 'Result']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

async function kissflowGetUrl({ environment, urlPath, credentials }) {
  const creds = credentials || (await resolveKissflowCredentials(environment));
  if (!creds.keyId || !creds.secret) {
    const err = new Error('Kissflow credentials not configured');
    err.code = 'KISSFLOW_CREDENTIALS_MISSING';
    throw err;
  }
  const url = `${creds.baseUrl}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
  const res = await fetch(url, {
    headers: {
      'X-Access-Key-Id': creds.keyId,
      'X-Access-Key-Secret': creds.secret,
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
    const err = new Error(`Kissflow request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { data, credentials: creds };
}

async function fetchAllKissflowUsers({ environment, accountId, credentials }) {
  const pageSize = 500;
  const all = [];
  for (let page = 1; page <= 50; page += 1) {
    const qs = new URLSearchParams({
      page_number: String(page),
      page_size: String(pageSize),
      user_type: 'User',
      invited_user: 'false',
    });
    const { data } = await kissflowGetUrl({
      environment,
      credentials,
      urlPath: `/user/2/${encodeURIComponent(accountId)}/?${qs.toString()}`,
    });
    const batch = extractArray(data);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}

async function fetchKissflowUserDetail({ environment, accountId, userId, credentials }) {
  const { data } = await kissflowGetUrl({
    environment,
    credentials,
    urlPath: `/user/2/${encodeURIComponent(accountId)}/${encodeURIComponent(userId)}`,
  });
  return data && typeof data === 'object' ? data : {};
}

async function enrichKissflowUsersWithDetails({
  environment,
  accountId,
  rawUsers,
  credentials,
  concurrency = 8,
}) {
  const enriched = [];
  for (let i = 0; i < rawUsers.length; i += concurrency) {
    const chunk = rawUsers.slice(i, i + concurrency);
    const batch = await Promise.all(
      chunk.map(async (raw) => {
        const userId = pickString(raw, ['_id', 'Id', 'id', 'UserId']);
        if (!userId) return raw;
        try {
          const detail = await fetchKissflowUserDetail({
            environment,
            accountId,
            userId,
            credentials,
          });
          return { ...raw, ...detail, _id: userId };
        } catch {
          return raw;
        }
      }),
    );
    enriched.push(...batch);
  }
  return enriched;
}

async function fetchAllProcessItems({ environment, accountId, processId, credentials }) {
  const pageSize = 500;
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data } = await kissflowGet({
      environment,
      accountId,
      processId,
      pageNumber: page,
      pageSize,
      applyPreference: false,
      credentials,
    });
    const batch = extractArray(data);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}

function pickString(obj, keys) {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return '';
}

function coerceKissflowDate(val) {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    const ms = val > 1e12 ? val : val * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof val === 'object') {
    return coerceKissflowDate(val.v || val.dv || val.Date || val.date || null);
  }
  if (typeof val !== 'string') return null;
  const t = val.trim();
  if (!t || !/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  if (/Z$|[+-]\d{2}(:?\d{2})?$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const withIst = /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00+05:30` : `${t}+05:30`;
  const d = new Date(withIst);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pickDateTime(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const parsed = coerceKissflowDate(obj[key]);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeProcessStatus(raw) {
  const value = String(
    raw?._status ||
      raw?.Status ||
      raw?.status ||
      raw?.Process_Status ||
      raw?.process_status ||
      '',
  ).trim();
  const lower = value.toLowerCase();
  if (lower.includes('progress') || lower === 'open' || lower === 'pending') return 'InProgress';
  if (lower.includes('complete') || lower === 'closed' || lower === 'done') return 'Completed';
  if (lower.includes('withdraw') || lower.includes('reject')) return 'Withdrawn';
  return value || 'other';
}

/** Current workflow step name from a Kissflow process item. */
function pickCurrentStep(raw) {
  if (!raw || typeof raw !== 'object') return '';
  if (typeof raw.current_step === 'string' && raw.current_step.trim()) return raw.current_step.trim();
  return pickString(raw, ['_current_step', 'Current_Step', 'current_step', 'Step', 'Step_Name']);
}

/**
 * ITSM business-closed: Completed, or InProgress parked on step "IT Tech Reopen".
 * Those reopen-step tickets must not count as Open.
 */
function isItsmBusinessClosed(raw) {
  const status = normalizeProcessStatus(raw);
  if (status === 'Completed') return true;
  if (status === 'InProgress') {
    const step = pickCurrentStep(raw).toLowerCase();
    return step === 'it tech reopen' || step.includes('it tech reopen');
  }
  return false;
}

function isItsmBusinessOpen(raw) {
  return normalizeProcessStatus(raw) === 'InProgress' && !isItsmBusinessClosed(raw);
}

module.exports = {
  normalizeEnvironment,
  resolveKissflowCredentials,
  kissflowGet,
  kissflowGetUrl,
  fetchAllKissflowUsers,
  fetchKissflowUserDetail,
  enrichKissflowUsersWithDetails,
  fetchAllProcessItems,
  extractArray,
  pickString,
  pickDateTime,
  coerceKissflowDate,
  normalizeProcessStatus,
  pickCurrentStep,
  isItsmBusinessClosed,
  isItsmBusinessOpen,
};
