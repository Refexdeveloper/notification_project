'use strict';

/** Engagement payload cached on application.source_payload after live/bootstrap fetch. */

const ENGAGEMENT_CACHE_TTL_MS = Number(process.env.ENGAGEMENT_CACHE_TTL_MS || 1 * 60 * 60 * 1000);
/** ITSM tickets change constantly — 1h live cache looks like “old data” vs Kissflow. */
const ENGAGEMENT_CACHE_ITSM_TTL_MS = Number(process.env.ENGAGEMENT_CACHE_ITSM_TTL_MS || 10 * 60 * 1000);
/** Bump when record mapping changes (Assigned to / Company) so stale cache.records are not served. */
const ENGAGEMENT_RECORDS_SCHEMA_VERSION = 10;

function isItsmApplicationId(applicationId) {
  const id = String(applicationId || '').toLowerCase();
  return id.includes('itsm') || id.includes('service_management');
}

function ttlForApplication(applicationId, fallbackMs = ENGAGEMENT_CACHE_TTL_MS) {
  if (isItsmApplicationId(applicationId)) return ENGAGEMENT_CACHE_ITSM_TTL_MS;
  return fallbackMs;
}

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

function engagementCacheFetchedAt(cache) {
  if (!cache?.fetched_at) return null;
  const t = new Date(cache.fetched_at);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Prefer engagement_cache only when fresh and not older than the latest PostgreSQL snapshot.
 * Schedule ingest updates snapshots but not engagement_cache — stale cache must not win.
 */
function shouldPreferEngagementCache(cache, {
  ttlMs = ENGAGEMENT_CACHE_TTL_MS,
  snapshotAt = null,
  applicationId = '',
} = {}) {
  if (!cache || !Array.isArray(cache.records) || !cache.records.length) return false;
  if (Number(cache.records_schema_version || 0) < ENGAGEMENT_RECORDS_SCHEMA_VERSION) return false;
  const ttl = ttlMs === ENGAGEMENT_CACHE_TTL_MS ? ttlForApplication(applicationId, ttlMs) : ttlMs;
  if (!isEngagementCacheFresh(cache, ttl)) return false;
  const fetchedAt = engagementCacheFetchedAt(cache);
  if (snapshotAt && fetchedAt && snapshotAt > fetchedAt) return false;
  return true;
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
  if (Array.isArray(payload.records)) {
    body.records = payload.records;
    body.records_schema_version = ENGAGEMENT_RECORDS_SCHEMA_VERSION;
  } else {
    // Preserve previously cached live records when a caller omits them.
    try {
      const prev = await loadApplicationEngagementCache(pool, environment, applicationId);
      if (Array.isArray(prev?.records) && prev.records.length) {
        body.records = prev.records;
        body.records_schema_version = Number(prev.records_schema_version || 0);
      }
    } catch {
      /* ignore */
    }
  }

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
  ENGAGEMENT_CACHE_ITSM_TTL_MS,
  ENGAGEMENT_RECORDS_SCHEMA_VERSION,
  ttlForApplication,
  readEngagementCache,
  cacheAgeMs,
  engagementCacheFetchedAt,
  isEngagementCacheFresh,
  shouldPreferEngagementCache,
  saveEngagementCache,
  loadApplicationEngagementCache,
};
