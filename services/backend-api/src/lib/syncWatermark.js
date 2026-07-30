'use strict';

/** Read/write sync_watermark rows for incremental Kissflow pulls. */

function buildResourceKey(environment, applicationId, processId, resourceType) {
  return `${environment}:${applicationId}:${processId}:${resourceType}`;
}

async function getWatermark(pool, resourceKey) {
  const { rows } = await pool.query(
    `SELECT resource_key, last_success_at, watermark_value, overlap_seconds, updated_at
     FROM engagement_reporting.sync_watermark
     WHERE resource_key = $1`,
    [resourceKey],
  );
  return rows[0] || null;
}

async function setWatermark(pool, resourceKey, { lastSuccessAt, watermarkValue }) {
  await pool.query(
    `INSERT INTO engagement_reporting.sync_watermark (resource_key, last_success_at, watermark_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (resource_key) DO UPDATE
       SET last_success_at = EXCLUDED.last_success_at,
           watermark_value = EXCLUDED.watermark_value,
           updated_at = now()`,
    [resourceKey, lastSuccessAt || new Date(), watermarkValue || lastSuccessAt || new Date()],
  );
}

function filterItemsSinceWatermark(items, watermark) {
  if (!watermark?.last_success_at) return items;
  const overlapMs = (Number(watermark.overlap_seconds) || 300) * 1000;
  const since = new Date(watermark.last_success_at).getTime() - overlapMs;
  return items.filter((item) => {
    const raw = item?._modified_at || item?._created_at;
    if (!raw) return true;
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) ? ts >= since : true;
  });
}

module.exports = { buildResourceKey, getWatermark, setWatermark, filterItemsSinceWatermark };
