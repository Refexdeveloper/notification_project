'use strict';

const { getPool } = require('./db');
const { syncAllProcessFields } = require('./fieldSyncService');
const { fetchLiveAppMetrics } = require('./kissflowLiveMetrics');
const {
  ENGAGEMENT_CACHE_TTL_MS,
  isEngagementCacheFresh,
  loadApplicationEngagementCache,
} = require('./engagementCache');

/** Weekdays Mon–Fri, hours 9–18 inclusive, Asia/Kolkata. */
function isWeekdayBusinessHoursIst(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  const hourRaw = parts.find((p) => p.type === 'hour')?.value || '0';
  const hour = Number(hourRaw === '24' ? '0' : hourRaw);
  const isWeekday = weekday !== 'Sat' && weekday !== 'Sun';
  return isWeekday && hour >= 9 && hour <= 18;
}

/**
 * Hourly incremental sync for all current apps:
 * - Field discovery: in-progress + newly modified items only (ignore completed bulk)
 * - Engagement cache: refresh when older than TTL (related users only)
 */
async function runIncrementalSyncAll({
  environment = 'production',
  refreshEngagement = true,
  force = false,
} = {}) {
  if (!force && !isWeekdayBusinessHoursIst()) {
    return {
      environment,
      synced_at: new Date().toISOString(),
      application_count: 0,
      cache_ttl_ms: ENGAGEMENT_CACHE_TTL_MS,
      mode: 'in_progress_and_newly_modified',
      skipped: true,
      skip_reason: 'outside_weekday_business_hours_ist',
      window: 'Mon–Fri 09:00–18:00 Asia/Kolkata',
      results: [],
    };
  }

  const pool = getPool();
  const { rows: apps } = await pool.query(
    `SELECT application_id, application_name
     FROM engagement_reporting.application
     WHERE environment = $1 AND is_current = true
     ORDER BY application_name`,
    [environment],
  );

  const results = [];
  for (const app of apps) {
    const entry = {
      application_id: app.application_id,
      application_name: app.application_name,
      field_sync: [],
      engagement: null,
      engagement_skipped: false,
      errors: [],
    };

    try {
      entry.field_sync = await syncAllProcessFields(pool, {
        environment,
        applicationId: app.application_id,
        options: {
          incremental: true,
          inProgressOnly: true,
          pageSize: 500,
        },
      });
    } catch (err) {
      entry.errors.push({ stage: 'field_sync', message: err.message, code: err.code });
    }

    if (refreshEngagement) {
      try {
        const cached = await loadApplicationEngagementCache(pool, environment, app.application_id);
        if (isEngagementCacheFresh(cached, ENGAGEMENT_CACHE_TTL_MS)) {
          entry.engagement_skipped = true;
          entry.engagement = {
            skipped: true,
            reason: 'cache_fresh',
            fetched_at: cached.fetched_at,
            user_count: cached.items?.length || 0,
          };
        } else {
          const live = await fetchLiveAppMetrics(environment, app.application_id, {
            persistCache: true,
          });
          entry.engagement = {
            skipped: false,
            user_count: live.live_user_count,
            item_count: live.item_count,
            open_tickets: live.metrics?.open_tickets,
            closed_tickets: live.metrics?.closed_tickets,
            fetched_at: live.fetched_at,
          };
        }
      } catch (err) {
        entry.errors.push({ stage: 'engagement', message: err.message, code: err.code });
      }
    }

    results.push(entry);
  }

  return {
    environment,
    synced_at: new Date().toISOString(),
    application_count: apps.length,
    cache_ttl_ms: ENGAGEMENT_CACHE_TTL_MS,
    mode: 'in_progress_and_newly_modified',
    results,
  };
}

module.exports = {
  runIncrementalSyncAll,
  isWeekdayBusinessHoursIst,
};
