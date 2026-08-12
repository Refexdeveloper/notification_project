'use strict';

/** Engagement payload cached on application.source_payload after live/bootstrap fetch. */

const ENGAGEMENT_CACHE_TTL_MS = Number(process.env.ENGAGEMENT_CACHE_TTL_MS || 1 * 60 * 60 * 1000);

function readEngagementCache(sourcePayload) {
  const cache = sourcePayload && typeof sourcePayload === 'object' ? sourcePayload.engagement_cache : null;
  if (!cache || typeof cache !== 'object') return null;
  if (!Array.isArray(cache.items)) return null;
  if (!cache.fetched_at) return null;
  return cache;
}

function cacheAgeMs(cache) {
  if (!cache?.fetched_at) return Number.POSITIVE_INFINITY;
  const t = new Date(cache.fetched_at).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

function isEngagementCacheFresh(cache, ttlMs = ENGAGEMENT_CACHE_TTL_MS) {
  return Boolean(cache) && cacheAgeMs(cache) < ttlMs;
}

async function saveEngagementCache(pool, { environment, applicationId, payload }) {
  const body = {
    fetched_at: payload.fetched_at || new Date().toISOString(),
    snapshot_at: payload.snapshot_at || payload.fetched_at || new Date().toISOString(),
    data_source: payload.data_source || 'live',
    items: payload.items || [],
    totals: payload.totals || {},
    count: Array.isArray(payload.items) ? payload.items.length : 0,
  };

  await pool.query(
    `UPDATE engagement_reporting.application
     SET source_payload = COALESCE(source_payload, '{}'::jsonb)
         || jsonb_build_object('engagement_cache', $3::jsonb),
         last_seen_at = now()
     WHERE environment = $1 AND application_id = $2 AND is_current = true`,
    [environment, applicationId, JSON.stringify(body)],
  );

  return body;
}

async function loadApplicationEngagementCache(pool, environment, applicationId) {
  const { rows } = await pool.query(
    `SELECT source_payload
     FROM engagement_reporting.application
     WHERE environment = $1 AND application_id = $2 AND is_current = true
     LIMIT 1`,
    [environment, applicationId],
  );
  if (!rows.length) return null;
  return readEngagementCache(rows[0].source_payload);
}

module.exports = {
  ENGAGEMENT_CACHE_TTL_MS,
  readEngagementCache,
  cacheAgeMs,
  isEngagementCacheFresh,
  saveEngagementCache,
  loadApplicationEngagementCache,
};
