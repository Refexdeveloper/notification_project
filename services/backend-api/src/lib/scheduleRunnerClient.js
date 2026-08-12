'use strict';

async function getCloudRunIdToken(audience) {
  const metadataBase = 'http://metadata.google.internal/computeMetadata/v1';
  const url = `${metadataBase}/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) {
    const err = new Error(`Failed to obtain Cloud Run ID token: HTTP ${res.status}`);
    err.code = 'SCHEDULE_RUNNER_AUTH_FAILED';
    throw err;
  }
  return res.text();
}

/**
 * Invoke refex-schedule-runner for a PostgreSQL schedule_id.
 * Requires SCHEDULE_RUNNER_URL (Cloud Run service root, no trailing path).
 */
async function invokeScheduleRunner(scheduleId, options = {}) {
  const baseUrl = String(process.env.SCHEDULE_RUNNER_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    const err = new Error(
      'SCHEDULE_RUNNER_URL is not configured on backend-api. Set it to the refex-schedule-runner Cloud Run URL.',
    );
    err.code = 'SCHEDULE_RUNNER_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const url = new URL(baseUrl);
  url.searchParams.set('schedule_id', String(scheduleId));
  if (options.testRecipient) {
    url.searchParams.set('test_recipient', String(options.testRecipient).trim().toLowerCase());
  }

  const headers = { Accept: 'text/plain' };
  if (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT) {
    headers.Authorization = `Bearer ${await getCloudRunIdToken(baseUrl)}`;
  }

  const timeoutMs = Number(process.env.SCHEDULE_RUNNER_TIMEOUT_MS || 900000);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await res.text();
  const looksLikeFailure =
    !res.ok ||
    /\bSTOP:/i.test(body) ||
    /runbook execution timed out/i.test(body) ||
    /unexpected error/i.test(body);
  const looksLikeSuccess =
    /Email sent successfully/i.test(body) ||
    /test send completed/i.test(body) ||
    /ingest-render-send completed/i.test(body) ||
    /render-and-send completed/i.test(body);
  // Never treat HTML report content as the failure message (REPORT_FILE_PATH responses).
  const bodyIsHtml = /^\s*</.test(body) || /<!DOCTYPE html/i.test(body);

  return {
    ok: !looksLikeFailure && (looksLikeSuccess || (res.ok && bodyIsHtml)),
    status: res.status,
    body: bodyIsHtml ? '[schedule-runner returned HTML report body]' : body.slice(0, 8000),
    schedule_id: scheduleId,
    test_recipient: options.testRecipient || null,
  };
}

/** Fire schedule-runner without blocking the HTTP request (for test-send from Admin UI). */
function dispatchScheduleRunnerAsync(scheduleId, options = {}) {
  void invokeScheduleRunner(scheduleId, options)
    .then((result) => {
      const label = result.ok ? 'completed' : 'finished-with-warnings';
      console.log(
        `[schedule-runner] ${scheduleId} ${label} HTTP ${result.status}${options.testRecipient ? ` test=${options.testRecipient}` : ''}`,
      );
      if (!result.ok && result.body) {
        console.log(`[schedule-runner] ${scheduleId} log: ${result.body.slice(0, 500)}`);
      }
    })
    .catch((err) => {
      console.error(`[schedule-runner] ${scheduleId} failed: ${err.message}`);
    });
}

module.exports = {
  invokeScheduleRunner,
  dispatchScheduleRunnerAsync,
};
