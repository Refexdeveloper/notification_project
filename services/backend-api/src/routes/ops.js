'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { resolveSession } = require('../lib/session');
const { normalizeEnvironment } = require('../lib/kissflowClient');
const { runIncrementalSyncAll } = require('../lib/incrementalSync');
const { syncScheduleCloudJob, resolveLegacySchedulerId } = require('../lib/cloudSchedulerSync');
const { dispatchScheduleRunnerAsync } = require('../lib/scheduleRunnerClient');

const router = express.Router();

const INCREMENTAL_SYNC_COOLDOWN_MS = 45 * 60 * 1000;
let incrementalSyncInFlight = null;
let incrementalSyncLastFinishedAt = 0;

function authorizeCronOrSession(req) {
  const cronToken = process.env.INCREMENTAL_SYNC_TOKEN || '';
  const headerToken = String(req.headers['x-sync-token'] || req.query.token || '').trim();
  if (cronToken && headerToken && headerToken === cronToken) {
    return { ok: true, source: 'cron_token' };
  }
  return null;
}

/**
 * POST /api/v1/ops/incremental-sync
 * Hourly job: sync in-progress + newly modified fields; refresh stale engagement caches.
 */
router.post('/incremental-sync', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const cronAuth = authorizeCronOrSession(req);
  if (!cronAuth) {
    try {
      const session = await resolveSession(req);
      if (!session) {
        return fail(res, req.correlationId, 'UNAUTHENTICATED', 'Session or sync token required', 401);
      }
    } catch (err) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', err.message, 401);
    }
  }

  const environment = normalizeEnvironment(
    req.query.environment || req.body?.environment || 'production',
  );
  const refreshEngagement = req.body?.refresh_engagement !== false;
  const force = req.body?.force === true || String(req.query.force || '') === 'true';

  if (!force && incrementalSyncInFlight) {
    return ok(res, req.correlationId, {
      skipped: true,
      reason: 'sync_in_progress',
      environment,
    });
  }
  if (
    !force
    && incrementalSyncLastFinishedAt > 0
    && Date.now() - incrementalSyncLastFinishedAt < INCREMENTAL_SYNC_COOLDOWN_MS
  ) {
    return ok(res, req.correlationId, {
      skipped: true,
      reason: 'recently_completed',
      environment,
      last_finished_at: new Date(incrementalSyncLastFinishedAt).toISOString(),
    });
  }

  try {
    incrementalSyncInFlight = runIncrementalSyncAll({ environment, refreshEngagement, force })
      .catch((err) => {
        console.error('[incremental-sync]', err.message || err);
      })
      .finally(() => {
        incrementalSyncLastFinishedAt = Date.now();
        incrementalSyncInFlight = null;
      });

    // Return immediately — sync runs in background (Cloud Scheduler / cron callers).
    res.status(202);
    return ok(res, req.correlationId, {
      accepted: true,
      environment,
      refresh_engagement: refreshEngagement,
      message: 'Incremental sync started in background',
    });
  } catch (err) {
    return fail(res, req.correlationId, 'INCREMENTAL_SYNC_FAILED', err.message, 500, true);
  }
});

/**
 * POST /api/v1/ops/sync-cloud-schedulers
 * Reconcile Cloud Scheduler jobs with active PostgreSQL report_schedule rows.
 */
router.post('/sync-cloud-schedulers', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const cronAuth = authorizeCronOrSession(req);
  if (!cronAuth) {
    try {
      const session = await resolveSession(req);
      if (!session) {
        return fail(res, req.correlationId, 'UNAUTHENTICATED', 'Session or sync token required', 401);
      }
    } catch (err) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', err.message, 401);
    }
  }

  const environment = normalizeEnvironment(
    req.query.environment || req.body?.environment || 'production',
  );
  const applicationId = String(req.query.application_id || req.body?.application_id || '').trim();

  try {
    const pool = getPool();
    const params = [environment];
    let appFilter = '';
    if (applicationId) {
      params.push(applicationId);
      appFilter = `AND rdv.config->>'application_id' = $2`;
    }

    const { rows } = await pool.query(
      `SELECT
         rs.report_schedule_id::text AS id,
         rs.cron_expression,
         rs.timezone,
         rs.is_active,
         rdv.config->>'legacy_scheduler_id' AS legacy_scheduler_id
       FROM engagement_reporting.report_schedule rs
       JOIN engagement_reporting.report_definition_version rdv
         ON rdv.report_definition_version_id = rs.report_definition_version_id
       JOIN engagement_reporting.report_definition rd ON rd.report_definition_id = rdv.report_definition_id
       JOIN engagement_reporting.account a ON a.account_id = rd.account_id
       WHERE a.environment = $1
         ${appFilter}
       ORDER BY rs.created_at`,
      params,
    );

    const results = [];
    for (const row of rows) {
      let legacyId = row.legacy_scheduler_id;
      if (!legacyId) {
        const { rows: cfgRows } = await pool.query(
          `SELECT rdv.config->>'application_id' AS application_id,
                  rdv.config->>'entity_filter' AS entity_filter
           FROM engagement_reporting.report_schedule rs
           JOIN engagement_reporting.report_definition_version rdv
             ON rdv.report_definition_version_id = rs.report_definition_version_id
           WHERE rs.report_schedule_id = $1::uuid`,
          [row.id],
        );
        const cfg = cfgRows[0] || {};
        legacyId = resolveLegacySchedulerId(cfg.application_id, cfg.entity_filter);
        if (legacyId) {
          await pool.query(
            `UPDATE engagement_reporting.report_definition_version rdv
             SET config = COALESCE(config, '{}'::jsonb) || $2::jsonb
             FROM engagement_reporting.report_schedule rs
             WHERE rs.report_definition_version_id = rdv.report_definition_version_id
               AND rs.report_schedule_id = $1::uuid`,
            [row.id, JSON.stringify({ legacy_scheduler_id: legacyId })],
          );
          row.legacy_scheduler_id = legacyId;
        }
      }

      try {
        const sync = await syncScheduleCloudJob(row);
        results.push({ schedule_id: row.id, ok: true, ...sync });
      } catch (syncErr) {
        results.push({ schedule_id: row.id, ok: false, error: syncErr.message });
      }
    }

    return ok(res, req.correlationId, {
      environment,
      application_id: applicationId || null,
      synced: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    return fail(res, req.correlationId, 'SCHEDULER_SYNC_FAILED', err.message, 500, true);
  }
});

const TRAVEL_APP_ID = 'Expense_and_Travel_Management_A00';
const TRAVEL_TEST_SCHEDULES = {
  venwind: 'd4cc8f6d-c3da-4bc2-9f9b-ca0ae159fffe',
  refex: 'c5c3cc0c-2702-4018-a9eb-10fea3bde379',
};

/**
 * POST /api/v1/ops/travel-full-test-send
 * Full-ingest test send for Venwind + Refex Travel reports (one email each).
 */
router.post('/travel-full-test-send', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const cronAuth = authorizeCronOrSession(req);
  if (!cronAuth) {
    try {
      const session = await resolveSession(req);
      if (!session) {
        return fail(res, req.correlationId, 'UNAUTHENTICATED', 'Session or sync token required', 401);
      }
    } catch (err) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', err.message, 401);
    }
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const testRecipient = String(body.test_recipient || body.testRecipient || 'mohamedaasik.m@refex.co.in')
    .trim()
    .toLowerCase();
  const fullIngest = body.full_ingest !== false && body.fullIngest !== false;

  const results = [];
  for (const [entity, scheduleId] of Object.entries(TRAVEL_TEST_SCHEDULES)) {
    try {
      dispatchScheduleRunnerAsync(scheduleId, { testRecipient, fullIngest });
      results.push({
        entity,
        schedule_id: scheduleId,
        ok: true,
        async: true,
        status: 'queued',
      });
    } catch (err) {
      results.push({
        entity,
        schedule_id: scheduleId,
        ok: false,
        error: err.message,
      });
    }
  }

  return ok(res, req.correlationId, {
    application_id: TRAVEL_APP_ID,
    test_recipient: testRecipient,
    full_ingest: fullIngest,
    queued: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    message: 'Both Travel reports queued on schedule-runner. Check inbox in 5–15 minutes.',
  }, 202);
});

/**
 * POST /api/v1/ops/travel-live-send
 * Production send for Venwind + Refex Travel schedules (To + Cc from Admin UI; no test override).
 */
router.post('/travel-live-send', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const cronAuth = authorizeCronOrSession(req);
  if (!cronAuth) {
    try {
      const session = await resolveSession(req);
      if (!session) {
        return fail(res, req.correlationId, 'UNAUTHENTICATED', 'Session or sync token required', 401);
      }
    } catch (err) {
      return fail(res, req.correlationId, 'UNAUTHENTICATED', err.message, 401);
    }
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const fullIngest = body.full_ingest === true || body.fullIngest === true;
  const pool = getPool();

  const results = [];
  for (const [entity, scheduleId] of Object.entries(TRAVEL_TEST_SCHEDULES)) {
    try {
      const { rows } = await pool.query(
        `SELECT
           COALESCE(json_agg(DISTINCT rr.recipient_email) FILTER (WHERE rr.recipient_type = 'TO'), '[]'::json) AS recipients_to,
           COALESCE(json_agg(DISTINCT rr.recipient_email) FILTER (WHERE rr.recipient_type = 'CC'), '[]'::json) AS recipients_cc,
           MAX(rdv.config->>'from_email') AS from_email
         FROM engagement_reporting.report_schedule rs
         JOIN engagement_reporting.report_definition_version rdv
           ON rdv.report_definition_version_id = rs.report_definition_version_id
         LEFT JOIN engagement_reporting.report_recipient rr
           ON rr.report_schedule_id = rs.report_schedule_id
         WHERE rs.report_schedule_id = $1::uuid
         GROUP BY rs.report_schedule_id`,
        [scheduleId],
      );
      const sched = rows[0] || {};
      dispatchScheduleRunnerAsync(scheduleId, { fullIngest });
      results.push({
        entity,
        schedule_id: scheduleId,
        ok: true,
        async: true,
        status: 'queued',
        recipients_to: sched.recipients_to || [],
        recipients_cc: sched.recipients_cc || [],
        from_email: sched.from_email || null,
      });
    } catch (err) {
      results.push({
        entity,
        schedule_id: scheduleId,
        ok: false,
        error: err.message,
      });
    }
  }

  return ok(res, req.correlationId, {
    application_id: TRAVEL_APP_ID,
    mode: 'live_schedule_recipients',
    full_ingest: fullIngest,
    queued: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    message: 'Both Travel reports queued to schedule To/Cc recipients. Delivery in 5–15 minutes.',
  }, 202);
});

module.exports = router;
