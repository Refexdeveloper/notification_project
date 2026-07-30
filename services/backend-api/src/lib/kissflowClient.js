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
  if (typeof fetch !== 'function') return '';
  const project =
    process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'master-diorama-489103-u2';
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

module.exports = {
  normalizeEnvironment,
  resolveKissflowCredentials,
  kissflowGet,
};
