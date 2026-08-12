'use strict';

const { getPool } = require('./db');
const { syncAllProcessFields } = require('./fieldSyncService');
const { fetchLiveAppMetrics } = require('./kissflowLiveMetrics');
const { normalizeEnvironment } = require('./kissflowClient');
const { ensureConnectReportArtifacts } = require('./connectReportArtifacts');

/**
 * First-time (or manual) bootstrap after Connect:
 * 1) Sync field catalogs for all processes
 * 2) Live-fetch related users + items once and cache on application (2h TTL reads)
 * 3) Ensure one draft HTML template + one paused schedule (idempotent)
 */
async function bootstrapApplication({ environment, applicationId }) {
  const env = normalizeEnvironment(environment);
  const pool = getPool();

  const fieldSync = await syncAllProcessFields(pool, {
    environment: env,
    applicationId,
    options: {
      // First connect: sample open items for fields; later syncs stay incremental.
      incremental: false,
      inProgressOnly: true,
      pageSize: 500,
    },
  });

  let engagement = null;
  let engagementError = null;
  try {
    engagement = await fetchLiveAppMetrics(env, applicationId, { persistCache: true });
  } catch (err) {
    engagementError = {
      code: err.code || 'ENGAGEMENT_BOOTSTRAP_FAILED',
      message: err.message,
    };
  }

  let reportArtifacts = null;
  let reportArtifactsError = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    reportArtifacts = await ensureConnectReportArtifacts(client, {
      environment: env,
      applicationId,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    reportArtifactsError = {
      code: err.code || 'CONNECT_REPORT_ARTIFACTS_FAILED',
      message: err.message,
    };
  } finally {
    client.release();
  }

  return {
    application_id: applicationId,
    environment: env,
    field_sync: fieldSync,
    fields_synced: fieldSync.filter((r) => r.ok).length,
    fields_failed: fieldSync.filter((r) => !r.ok).length,
    engagement: engagement
      ? {
          user_count: engagement.live_user_count,
          related_user_count: engagement.related_user_count,
          item_count: engagement.item_count,
          open_tickets: engagement.metrics?.open_tickets,
          closed_tickets: engagement.metrics?.closed_tickets,
          fetched_at: engagement.fetched_at,
        }
      : null,
    engagement_error: engagementError,
    report_artifacts: reportArtifacts,
    report_artifacts_error: reportArtifactsError,
    bootstrapped_at: new Date().toISOString(),
  };
}

module.exports = {
  bootstrapApplication,
};
