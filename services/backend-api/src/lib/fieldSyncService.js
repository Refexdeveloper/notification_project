'use strict';

const { kissflowGet, resolveKissflowCredentials, normalizeEnvironment } = require('./kissflowClient');
const {
  extractFieldsFromItems,
  readFieldDiscovery,
  buildFieldDiscoveryPayload,
} = require('./fieldDiscovery');
const {
  filterItemsForFieldDiscovery,
  classifyItemStatus,
  extractProcessStatus,
} = require('./kissflowDiscovery');
const {
  buildResourceKey,
  getWatermark,
  setWatermark,
  filterItemsSinceWatermark,
} = require('./syncWatermark');

function mapFieldRow(field) {
  return {
    id: field.id || field.name,
    name: field.name,
    label: field.label || field.name,
    type: field.type || 'unknown',
    sample: field.sample || null,
    occurrences: Number(field.occurrences) || 0,
  };
}

function mergeFieldCatalog(priorFields, newFields) {
  const map = new Map();
  for (const field of priorFields || []) {
    if (!field?.name) continue;
    map.set(field.name, { ...field });
  }
  for (const field of newFields || []) {
    if (!field?.name) continue;
    const existing = map.get(field.name);
    if (existing) {
      map.set(field.name, {
        ...existing,
        ...field,
        occurrences: Math.max(Number(existing.occurrences) || 0, Number(field.occurrences) || 0),
        sample: field.sample || existing.sample,
      });
    } else {
      map.set(field.name, field);
    }
  }
  return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const PROCESS_QUERY = `
SELECT
  p.environment,
  p.process_id,
  p.application_id,
  p.process_name,
  p.source_payload,
  a.source_payload->>'kissflow_account_id' AS kissflow_account_id,
  a.source_payload->>'subdomain' AS subdomain
FROM engagement_reporting.process p
JOIN engagement_reporting.application a
  ON a.environment = p.environment AND a.application_id = p.application_id
WHERE p.environment = $1
  AND p.application_id = $2
  AND p.process_id = $3
  AND p.is_current = true
LIMIT 1
`;

/**
 * Sync field catalog for one process (same behavior as POST .../fields/sync).
 */
async function syncProcessFields(pool, {
  environment,
  applicationId,
  processId,
  pageSize = 500,
  inProgressOnly = true,
  incremental = true,
}) {
  const env = normalizeEnvironment(environment);
  const { rows } = await pool.query(PROCESS_QUERY, [env, applicationId, processId]);
  if (!rows.length) {
    const err = new Error('Process not found for this application');
    err.code = 'PROCESS_NOT_FOUND';
    throw err;
  }

  const row = rows[0];
  const creds = await resolveKissflowCredentials(env);
  const accountId = row.kissflow_account_id || creds.accountId;
  if (!accountId) {
    const err = new Error(
      'Application is missing kissflow_account_id; set it during registration or configure Kissflow env.',
    );
    err.code = 'ACCOUNT_ID_MISSING';
    throw err;
  }

  const resourceKey = buildResourceKey(env, row.application_id, row.process_id, 'field_discovery');
  const watermark = incremental ? await getWatermark(pool, resourceKey) : null;

  const { data } = await kissflowGet({
    environment: env,
    accountId,
    processId: row.process_id,
    pageNumber: 1,
    pageSize: Math.min(Math.max(Number(pageSize) || 500, 1), 1000),
  });

  const rawItems = Array.isArray(data)
    ? data
    : Array.isArray(data?.Data)
      ? data.Data
      : Array.isArray(data?.items)
        ? data.items
        : [];

  let items = rawItems;
  if (incremental && watermark) {
    items = filterItemsSinceWatermark(items, watermark);
  }
  if (inProgressOnly) {
    items = filterItemsForFieldDiscovery(items, { inProgressOnly: true });
  }

  const statusCounts = { open: 0, closed: 0, other: 0, unknown: 0 };
  for (const item of rawItems) {
    const bucket = classifyItemStatus(extractProcessStatus(item));
    statusCounts[bucket] = (statusCounts[bucket] || 0) + 1;
  }

  const priorDiscovery = readFieldDiscovery(row.source_payload);
  const extracted = extractFieldsFromItems(items.length ? items : rawItems.slice(0, 50));
  const mergedFields = mergeFieldCatalog(priorDiscovery.fields, extracted.fields);
  const fieldDiscovery = {
    ...buildFieldDiscoveryPayload({
      fields: mergedFields,
      itemCount: extracted.itemCount,
      sampled: extracted.sampled,
    }),
    in_progress_only: inProgressOnly,
    incremental,
    status_counts: statusCounts,
    fetched_count: rawItems.length,
    filtered_count: items.length,
    watermark_before: watermark?.last_success_at || null,
  };

  await pool.query(
    `UPDATE engagement_reporting.process
     SET source_payload = COALESCE(source_payload, '{}'::jsonb) || jsonb_build_object('field_discovery', $4::jsonb),
         last_seen_at = now()
     WHERE environment = $1 AND process_id = $2 AND application_id = $3`,
    [env, row.process_id, row.application_id, JSON.stringify(fieldDiscovery)],
  );

  await setWatermark(pool, resourceKey, {
    lastSuccessAt: new Date(),
    watermarkValue: new Date(),
  });

  return {
    process_id: row.process_id,
    application_id: row.application_id,
    environment: env,
    fields: mergedFields.map(mapFieldRow),
    count: mergedFields.length,
    item_count: extracted.itemCount,
    sampled: extracted.sampled,
    synced_at: fieldDiscovery.synced_at,
    status_counts: statusCounts,
    fetched_count: rawItems.length,
    filtered_count: items.length,
    incremental,
    in_progress_only: inProgressOnly,
  };
}

async function syncAllProcessFields(pool, { environment, applicationId, options = {} }) {
  const env = normalizeEnvironment(environment);
  const { rows } = await pool.query(
    `SELECT process_id
     FROM engagement_reporting.process
     WHERE environment = $1 AND application_id = $2 AND is_current = true
     ORDER BY process_name`,
    [env, applicationId],
  );

  const results = [];
  for (const row of rows) {
    try {
      const synced = await syncProcessFields(pool, {
        environment: env,
        applicationId,
        processId: row.process_id,
        ...options,
      });
      results.push({ ok: true, ...synced });
    } catch (err) {
      results.push({
        ok: false,
        process_id: row.process_id,
        error: err.message,
        code: err.code || 'FIELD_SYNC_FAILED',
      });
    }
  }
  return results;
}

module.exports = {
  syncProcessFields,
  syncAllProcessFields,
  mapFieldRow,
  mergeFieldCatalog,
  PROCESS_QUERY,
};
