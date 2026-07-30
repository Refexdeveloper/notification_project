'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { normalizeEnvironment, kissflowGet, resolveKissflowCredentials } = require('../lib/kissflowClient');
const {
  extractFieldsFromItems,
  readFieldDiscovery,
  buildFieldDiscoveryPayload,
} = require('../lib/fieldDiscovery');
const {
  filterItemsForFieldDiscovery,
  classifyItemStatus,
  extractProcessStatus,
} = require('../lib/kissflowDiscovery');
const {
  buildResourceKey,
  getWatermark,
  setWatermark,
  filterItemsSinceWatermark,
} = require('../lib/syncWatermark');

const router = express.Router({ mergeParams: true });

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

router.get('/', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  if (!isDatabaseConfigured()) {
    return ok(res, req.correlationId, { fields: [], count: 0, warning: 'DATABASE_NOT_CONFIGURED' });
  }

  try {
    const { rows } = await getPool().query(PROCESS_QUERY, [
      environment,
      req.params.applicationId,
      req.params.processId,
    ]);
    if (!rows.length) {
      return fail(res, req.correlationId, 'PROCESS_NOT_FOUND', 'Process not found for this application', 404);
    }

    const discovery = readFieldDiscovery(rows[0].source_payload);
    const fields = discovery.fields.map(mapFieldRow);
    return ok(res, req.correlationId, {
      process_id: rows[0].process_id,
      application_id: rows[0].application_id,
      environment,
      fields,
      count: fields.length,
      item_count: discovery.itemCount,
      sampled: discovery.sampled,
      synced_at: discovery.syncedAt,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { fields: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'FIELDS_LIST_FAILED', err.message, 500, true);
  }
});

router.post('/sync', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required for field sync', 503);
  }

  const pageSize = Math.min(Math.max(Number(req.body?.page_size) || 500, 1), 1000);
  const inProgressOnly = req.body?.in_progress_only !== false;
  const incremental = req.body?.incremental !== false;

  try {
    const { rows } = await getPool().query(PROCESS_QUERY, [
      environment,
      req.params.applicationId,
      req.params.processId,
    ]);
    if (!rows.length) {
      return fail(res, req.correlationId, 'PROCESS_NOT_FOUND', 'Process not found for this application', 404);
    }

    const row = rows[0];
    const creds = await resolveKissflowCredentials(environment);
    const accountId = row.kissflow_account_id || creds.accountId;
    if (!accountId) {
      return fail(
        res,
        req.correlationId,
        'ACCOUNT_ID_MISSING',
        'Application is missing kissflow_account_id; set it during registration or configure Kissflow env.',
        400,
      );
    }

    const pool = getPool();
    const resourceKey = buildResourceKey(
      environment,
      row.application_id,
      row.process_id,
      'field_discovery',
    );
    const watermark = incremental ? await getWatermark(pool, resourceKey) : null;

    const { data } = await kissflowGet({
      environment,
      accountId,
      processId: row.process_id,
      pageNumber: 1,
      pageSize,
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
      [environment, row.process_id, row.application_id, JSON.stringify(fieldDiscovery)],
    );

    await setWatermark(pool, resourceKey, {
      lastSuccessAt: new Date(),
      watermarkValue: new Date(),
    });

    const fields = mergedFields.map(mapFieldRow);
    return ok(res, req.correlationId, {
      process_id: row.process_id,
      application_id: row.application_id,
      environment,
      fields,
      count: fields.length,
      item_count: extracted.itemCount,
      sampled: extracted.sampled,
      synced_at: fieldDiscovery.synced_at,
      status_counts: statusCounts,
      fetched_count: rawItems.length,
      filtered_count: items.length,
      incremental,
      in_progress_only: inProgressOnly,
    });
  } catch (err) {
    if (err.code === 'KISSFLOW_CREDENTIALS_MISSING') {
      return fail(res, req.correlationId, err.code, err.message, 503);
    }
    if (err.status === 401 || err.status === 403) {
      return fail(res, req.correlationId, 'KISSFLOW_AUTH_FAILED', err.message, err.status);
    }
    if (err.code === '42P01') {
      return fail(res, req.correlationId, 'SCHEMA_NOT_MIGRATED', 'Database schema not migrated', 503);
    }
    return fail(res, req.correlationId, 'FIELD_SYNC_FAILED', err.message, 500, true);
  }
});

module.exports = router;
