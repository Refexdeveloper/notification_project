'use strict';

function gcpProject() {
  return (
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'master-diorama-489103-u2'
  );
}

function gcpRegion() {
  return process.env.GCP_REGION || process.env.CLOUD_RUN_REGION || 'asia-south1';
}

async function getMetadataAccessToken() {
  const metadataBase = 'http://metadata.google.internal/computeMetadata/v1';
  const tokenRes = await fetch(`${metadataBase}/instance/service-accounts/default/token`, {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!tokenRes.ok) {
    const err = new Error(`Metadata token failed: HTTP ${tokenRes.status}`);
    err.code = 'GCP_METADATA_TOKEN_FAILED';
    throw err;
  }
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    const err = new Error('Metadata token missing access_token');
    err.code = 'GCP_METADATA_TOKEN_FAILED';
    throw err;
  }
  return tokenJson.access_token;
}

/**
 * Read latest secret payload from Secret Manager (metadata SA → gcloud CLI fallback).
 */
async function readGcpSecret(secretName) {
  const project = gcpProject();

  try {
    const accessToken = await getMetadataAccessToken();
    const url = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
    const secretRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (secretRes.ok) {
      const secretJson = await secretRes.json();
      if (secretJson.payload?.data) {
        return Buffer.from(secretJson.payload.data, 'base64').toString('utf8').trim();
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const { execSync } = require('child_process');
    return String(
      execSync(
        `gcloud secrets versions access latest --secret=${secretName} --project=${project}`,
        { stdio: ['ignore', 'pipe', 'ignore'] },
      ),
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Add a new secret version. Returns version name (e.g. projects/.../secrets/.../versions/3).
 */
async function addGcpSecretVersion(secretName, plaintext) {
  const project = gcpProject();
  const value = String(plaintext || '');
  if (!value) {
    const err = new Error('Secret value cannot be empty');
    err.code = 'SECRET_VALUE_EMPTY';
    err.status = 400;
    throw err;
  }

  try {
    const accessToken = await getMetadataAccessToken();
    const url = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${encodeURIComponent(secretName)}:addVersion`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payload: { data: Buffer.from(value, 'utf8').toString('base64') },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error?.message || `Secret Manager addVersion failed: HTTP ${res.status}`);
      err.code = 'SECRET_WRITE_FAILED';
      err.status = res.status === 403 ? 403 : 502;
      throw err;
    }
    return {
      name: json.name || '',
      secret: secretName,
    };
  } catch (err) {
    if (err.code === 'SECRET_WRITE_FAILED' || err.code === 'SECRET_VALUE_EMPTY') throw err;

    // Local / Cloud Shell fallback
    try {
      const { execSync } = require('child_process');
      const { writeFileSync, unlinkSync } = require('fs');
      const { tmpdir } = require('os');
      const { join } = require('path');
      const tmp = join(tmpdir(), `smtp-secret-${Date.now()}.txt`);
      writeFileSync(tmp, value, { mode: 0o600 });
      try {
        const out = String(
          execSync(
            `gcloud secrets versions add ${secretName} --project=${project} --data-file=${tmp}`,
            { stdio: ['ignore', 'pipe', 'pipe'] },
          ),
        ).trim();
        return { name: out, secret: secretName };
      } finally {
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
    } catch (cliErr) {
      const err2 = new Error(
        err.message || cliErr.message || 'Unable to write secret (need Secret Manager addVersion + metadata or gcloud)',
      );
      err2.code = 'SECRET_WRITE_FAILED';
      err2.status = 502;
      throw err2;
    }
  }
}

/**
 * Force schedule-runner to pick up :latest SMTP secrets by bumping a revision annotation.
 */
async function refreshScheduleRunnerSecrets() {
  const project = gcpProject();
  const region = gcpRegion();
  const service = process.env.SCHEDULE_RUNNER_SERVICE || 'refex-schedule-runner';
  const name = `projects/${project}/locations/${region}/services/${service}`;

  try {
    const accessToken = await getMetadataAccessToken();
    const getUrl = `https://run.googleapis.com/v2/${name}`;
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!getRes.ok) {
      return {
        refreshed: false,
        warning: `Could not load ${service} for secret refresh (HTTP ${getRes.status})`,
      };
    }
    const current = await getRes.json();
    const annotations = {
      ...(current.template?.annotations || {}),
      'refex.com/smtp-secret-refresh': new Date().toISOString(),
    };
    // Only patch annotations so we do not rewrite containers / secret mounts.
    const patchRes = await fetch(`${getUrl}?updateMask=template.annotations`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template: { annotations },
      }),
    });
    if (!patchRes.ok) {
      const body = await patchRes.text();
      return {
        refreshed: false,
        warning: `Secret saved, but schedule-runner refresh failed (HTTP ${patchRes.status}). Redeploy schedule-runner or update secrets mount manually. ${body.slice(0, 200)}`,
      };
    }
    return { refreshed: true, service };
  } catch (err) {
    return {
      refreshed: false,
      warning: `Secret saved, but schedule-runner refresh skipped: ${err.message}`,
    };
  }
}

module.exports = {
  gcpProject,
  gcpRegion,
  readGcpSecret,
  addGcpSecretVersion,
  refreshScheduleRunnerSecrets,
};
