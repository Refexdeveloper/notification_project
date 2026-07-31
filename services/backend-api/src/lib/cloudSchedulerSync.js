'use strict';

const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'master-diorama-489103-u2';
const GCP_REGION = process.env.GCP_REGION || 'asia-south1';
const SCHEDULE_RUNNER_URL = String(process.env.SCHEDULE_RUNNER_URL || '').trim().replace(/\/$/, '');
const SCHEDULER_SA =
  process.env.SCHEDULER_SA || 'aasik-refex-report-scheduler@master-diorama-489103-u2.iam.gserviceaccount.com';

async function getAccessToken() {
  if (!process.env.K_SERVICE && !process.env.GOOGLE_CLOUD_PROJECT) {
    return null;
  }
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) {
    throw new Error(`Metadata token failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

function jobNameFor(scheduleId, legacySchedulerId) {
  if (legacySchedulerId && legacySchedulerId !== 'null') {
    return legacySchedulerId;
  }
  return `ne-schedule-${String(scheduleId).toLowerCase().slice(0, 36)}`;
}

async function schedulerFetch(path, { method = 'GET', body, token }) {
  const res = await fetch(`https://cloudscheduler.googleapis.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error?.message || text || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.error?.status || 'SCHEDULER_API_ERROR';
    throw err;
  }
  return data;
}

async function syncScheduleCloudJob(row) {
  if (!SCHEDULE_RUNNER_URL) {
    return {
      ok: false,
      skipped: true,
      reason: 'SCHEDULE_RUNNER_URL not configured on backend-api',
    };
  }

  const token = await getAccessToken();
  if (!token) {
    return {
      ok: false,
      skipped: true,
      reason: 'Not running on GCP — run ops/runbooks/32-provision-schedulers-from-postgresql.sh sync locally',
    };
  }

  const scheduleId = row.id;
  const cron = row.cron_expression;
  const timezone = row.timezone || 'Asia/Kolkata';
  const isActive = Boolean(row.is_active);
  const legacyId = row.legacy_scheduler_id || null;
  const jobName = jobNameFor(scheduleId, legacyId);
  const parent = `projects/${GCP_PROJECT}/locations/${GCP_REGION}`;
  const jobResource = `${parent}/jobs/${jobName}`;
  const uri = `${SCHEDULE_RUNNER_URL}/?schedule_id=${encodeURIComponent(scheduleId)}`;

  const jobBody = {
    name: jobResource,
    schedule: cron,
    timeZone: timezone,
    httpTarget: {
      uri,
      httpMethod: 'GET',
      oidcToken: {
        serviceAccountEmail: SCHEDULER_SA,
        audience: SCHEDULE_RUNNER_URL,
      },
    },
  };

  let action = 'updated';
  try {
    await schedulerFetch(`${jobResource}`, { method: 'GET', token });
    await schedulerFetch(`${jobResource}?updateMask=schedule,timeZone,httpTarget`, {
      method: 'PATCH',
      body: jobBody,
      token,
    });
  } catch (err) {
    if (err.status === 404) {
      await schedulerFetch(`${parent}/jobs?jobId=${encodeURIComponent(jobName)}`, {
        method: 'POST',
        body: jobBody,
        token,
      });
      action = 'created';
    } else {
      throw err;
    }
  }

  if (isActive) {
    await schedulerFetch(`${jobResource}:resume`, { method: 'POST', body: {}, token });
  } else {
    await schedulerFetch(`${jobResource}:pause`, { method: 'POST', body: {}, token });
  }

  return {
    ok: true,
    job_name: jobName,
    action,
    state: isActive ? 'ENABLED' : 'PAUSED',
    schedule: cron,
    timezone,
  };
}

module.exports = {
  syncScheduleCloudJob,
  jobNameFor,
};
