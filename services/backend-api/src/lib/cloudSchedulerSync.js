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

/**
 * Live Cloud Scheduler job names keyed by PostgreSQL schedule UUID.
 * Admin UI sync must update these jobs — never create a second ne-schedule-* twin.
 */
const SCHEDULE_CLOUD_JOB_NAMES = {
  '55555555-5555-4555-8555-555555555555': 'sch-refex-itsm-daily',
  '18e6c3a0-df09-473e-9c52-8993b7b1ea9b': 'ne-schedule-18e6c3a0-df09-473e-9c52-8993b7b1ea9b',
  '99999999-9999-4999-8999-999999999999': 'sch-refex-pm-daily',
  '409a2a2b-499c-4222-9750-4bfe13a741cc': 'ne-schedule-409a2a2b-499c-4222-9750-4bfe13a741cc',
  'e7a22909-59b9-422a-84fc-95ad5a49b8d6': 'ne-schedule-e7a22909-59b9-422a-84fc-95ad5a49b8d6',
  'd4cc8f6d-c3da-4bc2-9f9b-ca0ae159fffe': 'sch-refex-travel-daily',
  'c5c3cc0c-2702-4018-a9eb-10fea3bde379': 'sch-refex-travel-daily-refex',
  'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4': 'sch-ril-rmc-travel-daily',
  'c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4': 'sch-ril-rmc-expense-daily',
  'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4': 'sch-ril-rmc-pm-daily',
  'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4': 'sch-rmc-lead-daily',
  '3475b0d0-f9d6-472f-b1e6-387e82066cb3': 'ne-schedule-3475b0d0-f9d6-472f-b1e6-387e82066cb3',
  'dddd1111-1111-4111-8111-111111111001': 'sch-refex-lead-prod-3i',
  'dddd1111-1111-4111-8111-111111111002': 'sch-refex-lead-prod-modepro',
  'dddd1111-1111-4111-8111-111111111003': 'sch-refex-lead-prod-adonis',
  'dddd1111-1111-4111-8111-111111111004': 'sch-refex-lead-prod-refex-mobility',
};

function knownCloudJobName(scheduleId) {
  return SCHEDULE_CLOUD_JOB_NAMES[String(scheduleId || '').toLowerCase()] || null;
}

function jobNameFor(scheduleId, legacySchedulerId) {
  const known = knownCloudJobName(scheduleId);
  if (known) return known;
  if (legacySchedulerId && legacySchedulerId !== 'null') {
    return legacySchedulerId;
  }
  return `ne-schedule-${String(scheduleId).toLowerCase().slice(0, 36)}`;
}

/** Stable Cloud Scheduler job names for apps created before PostgreSQL schedule IDs. */
function resolveLegacySchedulerId(applicationId, entityFilter) {
  const app = String(applicationId || '');
  const entity = String(entityFilter || '').trim().toLowerCase();
  if (app === 'Expense_and_Travel_Management_A00') {
    if (entity === 'ril_rmc' || entity === 'rilrmc') return 'sch-ril-rmc-travel-daily';
    if (entity === 'refex') return 'sch-refex-travel-daily-refex';
    if (entity === 'venwind' || !entity || entity === 'all') return 'sch-refex-travel-daily';
  }
  if (app === 'IT_Service_Management_A00') {
    if (entity === 'extrovis') return 'ne-schedule-18e6c3a0-df09-473e-9c52-8993b7b1ea9b';
    if (!entity) return 'sch-refex-itsm-daily';
    return null;
  }
  if (app === 'Project_Management_Tracker_A00') {
    if (entity === 'ril_rmc' || entity === 'rilrmc') return 'sch-ril-rmc-pm-daily';
    return 'sch-refex-pm-daily';
  }
  if (app === 'EMS_001_A00') {
    if (entity === 'ril_rmc' || entity === 'rilrmc') return 'sch-ril-rmc-expense-daily';
    return 'ne-schedule-e7a22909-59b9-422a-84fc-95ad5a49b8d6';
  }
  if (app === 'Lead_Trcaker_A00') {
    if (entity === 'ril_rmc' || entity === 'rilrmc' || entity === 'rmc') return 'sch-rmc-lead-daily';
    if (entity === '3imedtech' || entity === '3i') return 'sch-refex-lead-prod-3i';
    if (entity === 'modepro') return 'sch-refex-lead-prod-modepro';
    if (entity === 'adonis') return 'sch-refex-lead-prod-adonis';
    if (entity === 'refex mobility' || entity === 'refexmobility') return 'sch-refex-lead-prod-refex-mobility';
    if (entity === 'venwind') return 'ne-schedule-3475b0d0-f9d6-472f-b1e6-387e82066cb3';
  }
  return null;
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
    // Ingest+render can exceed the 180s default; align with schedule-runner timeout.
    attemptDeadline: '1800s',
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
    await schedulerFetch(
      `${jobResource}?updateMask=schedule,timeZone,httpTarget,attemptDeadline`,
      {
        method: 'PATCH',
        body: jobBody,
        token,
      },
    );
  } catch (err) {
    if (err.status === 404) {
      // Job id comes from body.name (.../jobs/{jobId}). Do not pass ?jobId= —
      // Cloud Scheduler v1 rejects that query parameter.
      await schedulerFetch(`${parent}/jobs`, {
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
  knownCloudJobName,
  resolveLegacySchedulerId,
  SCHEDULE_CLOUD_JOB_NAMES,
};
