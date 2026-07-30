'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { APP_ENGAGEMENT_QUERY, buildEngagementTotals } = require('../lib/engagementSummary');
const { fetchLiveAppMetrics } = require('../lib/kissflowLiveMetrics');
const { snapshotAgeHours, DEFAULT_REPORT_TIMEZONE } = require('../lib/reportTimezone');

const router = express.Router();

const APPLICATIONS_QUERY = `
SELECT environment, application_id, application_name
FROM engagement_reporting.application
WHERE is_current = true AND environment = $1
ORDER BY application_name
`;

const RECENT_SENDS_QUERY = `
SELECT
  rr.report_run_id,
  rr.application_id,
  rr.status AS run_status,
  rr.scheduled_at,
  rr.completed_at,
  a.application_name
FROM engagement_reporting.report_run rr
LEFT JOIN engagement_reporting.application a
  ON a.environment = rr.environment
 AND a.application_id = rr.application_id
 AND a.is_current = true
WHERE rr.environment = $1
ORDER BY COALESCE(rr.completed_at, rr.scheduled_at) DESC NULLS LAST
LIMIT 20
`;

function normalizeEnvironment(value) {
  const lower = String(value || 'production').toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower;
}

function mapSendStatus(runStatus) {
  const upper = String(runStatus || '').toUpperCase();
  if (upper === 'COMPLETED') return 'delivered';
  if (upper === 'FAILED') return 'failed';
  return 'pending';
}

function isItsmLikeApplication(applicationId, applicationName) {
  const id = String(applicationId || '').toLowerCase();
  const name = String(applicationName || '').toLowerCase();
  return id.includes('itsm') || id.includes('service') || name.includes('itsm') || name.includes('service');
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, {
      applications: [],
      recent_sends: [],
      warning: 'DATABASE_NOT_CONFIGURED',
    });
  }

  const environment = normalizeEnvironment(req.query.environment);
  const liveRefresh = String(req.query.refresh || '').toLowerCase() === 'live';

  try {
    const pool = getPool();
    const { rows: apps } = await pool.query(APPLICATIONS_QUERY, [environment]);

    const applications = [];
    const refreshWarnings = [];

    for (const app of apps) {
      if (liveRefresh) {
        try {
          const live = await fetchLiveAppMetrics(environment, app.application_id);
          applications.push({
            environment: app.environment,
            application_id: app.application_id,
            application_name: app.application_name,
            snapshot_at: live.snapshot_at,
            fetched_at: live.fetched_at,
            data_source: 'live',
            metrics: live.metrics,
            metric_labels: isItsmLikeApplication(app.application_id, app.application_name)
              ? {
                  sign_in_today: 'Signed in today',
                  sign_in_rate_overall: 'Sign-in rate (overall)',
                  sign_in_rate_today: 'Sign-in rate today',
                  open_tickets: 'Open tickets',
                  closed_tickets: 'Closed tickets',
                }
              : {
                  sign_in_today: 'Active today',
                  sign_in_rate_overall: 'Login rate (overall)',
                  sign_in_rate_today: 'Login rate today',
                  open_tickets: 'Open items',
                  closed_tickets: 'Completed items',
                },
          });
          continue;
        } catch (liveErr) {
          refreshWarnings.push(
            `${app.application_name}: live refresh failed (${liveErr.message || liveErr.code || 'error'}) — showing cached snapshot`,
          );
        }
      }

      const { rows } = await pool.query(APP_ENGAGEMENT_QUERY, [environment, app.application_id]);
      const totals = buildEngagementTotals(rows);
      const snapshotAt = rows[0]?.snapshot_at || null;
      const ageHours = snapshotAgeHours(snapshotAt);
      applications.push({
        environment: app.environment,
        application_id: app.application_id,
        application_name: app.application_name,
        snapshot_at: snapshotAt,
        fetched_at: null,
        data_source: 'snapshot',
        snapshot_stale: ageHours != null && ageHours > 24,
        metrics: {
          total_users: totals.total_users,
          sign_in_today: totals.active_today,
          sign_in_rate_overall: totals.sign_in_rate_overall,
          sign_in_rate_today: totals.sign_in_rate_today,
          open_tickets: totals.open_tickets,
          closed_tickets: totals.closed_tickets,
        },
        metric_labels: isItsmLikeApplication(app.application_id, app.application_name)
          ? {
              sign_in_today: 'Signed in today',
              sign_in_rate_overall: 'Sign-in rate (overall)',
              sign_in_rate_today: 'Sign-in rate today',
              open_tickets: 'Open tickets',
              closed_tickets: 'Closed tickets',
            }
          : {
              sign_in_today: 'Active today',
              sign_in_rate_overall: 'Login rate (overall)',
              sign_in_rate_today: 'Login rate today',
              open_tickets: 'Open items',
              closed_tickets: 'Completed items',
            },
      });
    }

    const sendsResult = await pool.query(RECENT_SENDS_QUERY, [environment]);
    const recentSends = sendsResult.rows.map((row) => ({
      id: row.report_run_id,
      application_id: row.application_id,
      application_name: row.application_name || row.application_id,
      status: mapSendStatus(row.run_status),
      sent_at: row.completed_at || row.scheduled_at,
    }));

    return ok(res, req.correlationId, {
      environment,
      applications,
      recent_sends: recentSends,
      generated_at: new Date().toISOString(),
      refresh_mode: liveRefresh ? 'live' : 'snapshot',
      timezone: DEFAULT_REPORT_TIMEZONE,
      warnings: refreshWarnings.length ? refreshWarnings : undefined,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { applications: [], recent_sends: [], warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'DASHBOARD_FAILED', err.message, 500, true);
  }
});

module.exports = router;
