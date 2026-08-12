import type { DiscoveredField, KissflowApplication } from '@/mocks/applications';
import { apiV1Fetch, isBackendApiMode } from './backendApi';
import { resolveBackendApplicationId, toDbEnvironment } from './applicationsApi';

export type BackendFieldRow = {
  id: string;
  name: string;
  label: string;
  type: string;
  sample?: string | null;
  occurrences: number;
};

export type FieldsListResponse = {
  process_id: string;
  application_id: string;
  environment: string;
  fields: BackendFieldRow[];
  count: number;
  item_count: number;
  sampled: number;
  synced_at: string | null;
  warning?: string;
};

export type FieldSyncResult = {
  ok: boolean;
  fields: DiscoveredField[];
  itemCount: number;
  sampled: number;
  syncedAt?: string;
  error?: string;
};

function mapField(row: BackendFieldRow): DiscoveredField {
  return {
    id: row.id || row.name,
    name: row.name,
    label: row.label || row.name,
    type: row.type || 'unknown',
    sample: row.sample || undefined,
    occurrences: row.occurrences || 0,
  };
}

function primaryProcessId(app: KissflowApplication): string {
  return (app.processIds || [])[0] || app.appId;
}

export async function loadFieldsFromBackend(
  app: KissflowApplication,
  processId?: string,
): Promise<FieldSyncResult & { fields: DiscoveredField[] }> {
  if (!isBackendApiMode()) {
    return { ok: false, fields: [], itemCount: 0, sampled: 0, error: 'Backend API mode is not enabled' };
  }

  const applicationId = resolveBackendApplicationId(app);
  const pid = processId || primaryProcessId(app);
  const environment = toDbEnvironment(app.environment);
  const path = `/applications/${encodeURIComponent(applicationId)}/processes/${encodeURIComponent(pid)}/fields?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<FieldsListResponse>(path);

  if (!res.ok || !res.data) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      error: res.error || 'Failed to load fields',
    };
  }

  return {
    ok: true,
    fields: res.data.fields.map(mapField),
    itemCount: res.data.item_count,
    sampled: res.data.sampled,
    syncedAt: res.data.synced_at || undefined,
  };
}

export async function syncFieldsOnBackend(
  app: KissflowApplication,
  processId?: string,
): Promise<FieldSyncResult> {
  if (!isBackendApiMode()) {
    return { ok: false, fields: [], itemCount: 0, sampled: 0, error: 'Backend API mode is not enabled' };
  }

  const applicationId = resolveBackendApplicationId(app);
  const pid = processId || primaryProcessId(app);
  const environment = toDbEnvironment(app.environment);
  const path = `/applications/${encodeURIComponent(applicationId)}/processes/${encodeURIComponent(pid)}/fields/sync?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<FieldsListResponse>(path, { method: 'POST', body: JSON.stringify({}) });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      error: res.error || 'Field sync failed',
    };
  }

  return {
    ok: true,
    fields: res.data.fields.map(mapField),
    itemCount: res.data.item_count,
    sampled: res.data.sampled,
    syncedAt: res.data.synced_at || undefined,
  };
}

/** Sync field catalogs for every registered process on the application. */
export async function syncAllFieldsOnBackend(
  app: KissflowApplication,
): Promise<FieldSyncResult & { syncedProcesses?: number; failedProcesses?: string[] }> {
  const processIds = (app.processIds || []).map((id) => id.trim()).filter(Boolean);
  if (!processIds.length) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      error: 'No processes registered on this application yet',
    };
  }

  const failed: string[] = [];
  let lastOk: FieldSyncResult | null = null;
  for (const processId of processIds) {
    const result = await syncFieldsOnBackend(app, processId);
    if (!result.ok) {
      failed.push(`${processId}: ${result.error || 'failed'}`);
      continue;
    }
    lastOk = result;
  }

  if (!lastOk) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      error: failed.join('; ') || 'Field sync failed',
      failedProcesses: failed,
    };
  }

  return {
    ...lastOk,
    ok: true,
    syncedProcesses: processIds.length - failed.length,
    failedProcesses: failed,
  };
}
