'use strict';

/**
 * Shared snapshot_run selection for dashboards.
 * Prefer the fullest completed run in the last 14 days, then newest timestamp.
 * Match by application_id OR registered process_id (ingest rows sometimes omit application_id).
 */

function latestRunsCte({ environmentParam = '$1', applicationIdParam = null, alias = 'latest_runs' } = {}) {
  const appFilter = applicationIdParam
    ? `(
        sr.application_id = ${applicationIdParam}
        OR sr.process_id IN (
          SELECT process_id FROM engagement_reporting.process
          WHERE environment = ${environmentParam}
            AND application_id = ${applicationIdParam}
            AND is_current = true
        )
      )`
    : `(
        sr.application_id IN (SELECT application_id FROM apps)
        OR sr.process_id IN (SELECT process_id FROM procs)
      )`;

  return `${alias} AS (
  SELECT DISTINCT ON (sr.process_id)
    sr.process_id,
    sr.snapshot_run_id,
    COALESCE(sr.item_record_count, 0)::int AS item_record_count,
    COALESCE(sr.load_completed_at, sr.extraction_completed_at, sr.created_at) AS snapshot_at
  FROM engagement_reporting.snapshot_run sr
  WHERE sr.environment = ${environmentParam}
    AND sr.status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
    AND ${appFilter}
  ORDER BY sr.process_id,
    CASE
      WHEN COALESCE(sr.load_completed_at, sr.extraction_completed_at, sr.created_at)
           > now() - interval '14 days'
        THEN COALESCE(sr.item_record_count, 0)
      ELSE -1
    END DESC,
    COALESCE(sr.load_completed_at, sr.extraction_completed_at, sr.created_at) DESC,
    sr.created_at DESC
)`;
}

/** Newest completed snapshot timestamp for an application (ingest / schedule-runner). */
async function latestApplicationSnapshotAt(pool, environment, applicationId) {
  const { rows } = await pool.query(
    `SELECT max(COALESCE(sr.load_completed_at, sr.extraction_completed_at, sr.created_at)) AS snapshot_at
     FROM engagement_reporting.snapshot_run sr
     WHERE sr.environment = $1
       AND sr.status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
       AND (
         sr.application_id = $2
         OR sr.process_id IN (
           SELECT process_id FROM engagement_reporting.process
           WHERE environment = $1 AND application_id = $2 AND is_current = true
         )
       )`,
    [environment, applicationId],
  );
  const at = rows[0]?.snapshot_at;
  return at ? new Date(at) : null;
}

module.exports = {
  latestRunsCte,
  latestApplicationSnapshotAt,
};
