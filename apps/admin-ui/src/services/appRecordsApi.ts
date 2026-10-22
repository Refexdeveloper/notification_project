import { apiV1Fetch, isBackendApiMode } from './backendApi';
import type { KissflowApplication } from '@/mocks/applications';

export type AppRecordColumn = { id: string; label: string };

export type AppRecordRow = {
  id: string;
  request_id?: string;
  subject?: string;
  assigned_to?: string;
  requested_by?: string;
  status?: string;
  status_raw?: string;
  entity?: string;
  current_step?: string;
  process_id?: string;
  created_at?: string | null;
  amount?: number | null;
  [key: string]: unknown;
};

export type AppRecordsResponse = {
  application_id: string;
  environment: string;
  data_source?: string;
  total: number;
  limit: number;
  offset: number;
  columns: AppRecordColumn[];
  items: AppRecordRow[];
  generated_at?: string;
  summary?: { total: number; open: number; closed: number; rejected: number };
  inventory_summary?: { total: number; open: number; closed: number; rejected: number };
  filter_options?: {
    entities?: Array<{ id: string; label: string; count?: number }>;
    assignees?: string[];
    requesters?: string[];
    show_assigned?: boolean;
    show_requester?: boolean;
    show_entity?: boolean;
  };
};

const APP_RECORDS_CACHE_PREFIX = 'refex:app-records:v17';
const APP_RECORDS_CACHE_STALE_MS = 5 * 60 * 1000;
const APP_RECORDS_CACHE_MAX_MS = 30 * 60 * 1000;

type AppRecordsCacheEntry = { ts: number; data: AppRecordsResponse };

function toDbEnvironment(environment: KissflowApplication['environment'] | string): string {
  const e = String(environment || 'Production');
  return e === 'Production' || e.toLowerCase() === 'production' ? 'production' : 'development';
}

function buildRecordsQueryKey(opts: {
  environment?: string;
  entity?: string;
  status?: string;
  search?: string;
  assigned?: string;
  requester?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}) {
  return [
    opts.environment || 'production',
    opts.entity || 'all',
    opts.status || 'all',
    opts.search || '',
    opts.assigned || '',
    opts.requester || '',
    opts.dateFrom || '',
    opts.dateTo || '',
    opts.limit ?? 50,
    opts.offset ?? 0,
  ].join('|');
}

function recordsCacheKey(applicationId: string, queryKey: string) {
  return `${APP_RECORDS_CACHE_PREFIX}:${applicationId}:${queryKey}`;
}

function readRecordsCache(applicationId: string, queryKey: string, allowStale = false): AppRecordsResponse | null {
  try {
    const raw = sessionStorage.getItem(recordsCacheKey(applicationId, queryKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppRecordsCacheEntry;
    if (!parsed?.data?.application_id) return null;
    const age = Date.now() - parsed.ts;
    if (age > APP_RECORDS_CACHE_MAX_MS) return null;
    if (!allowStale && age > APP_RECORDS_CACHE_STALE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeRecordsCache(applicationId: string, queryKey: string, data: AppRecordsResponse) {
  try {
    const entry: AppRecordsCacheEntry = { ts: Date.now(), data };
    sessionStorage.setItem(recordsCacheKey(applicationId, queryKey), JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export async function loadApplicationRecords(opts: {
  applicationId: string;
  environment: KissflowApplication['environment'] | string;
  entity?: string;
  status?: string;
  search?: string;
  assigned?: string;
  requester?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  skipCache?: boolean;
  forceLive?: boolean;
}): Promise<{ ok: true; data: AppRecordsResponse; fromCache?: boolean } | { ok: false; error: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode required' };
  }
  const appId = String(opts.applicationId || '').trim();
  const queryKey = buildRecordsQueryKey(opts);

  if (!opts.skipCache) {
    const cached = readRecordsCache(appId, queryKey);
    if (cached) return { ok: true, data: cached, fromCache: true };
  }

  const params = new URLSearchParams();
  params.set('environment', toDbEnvironment(opts.environment));
  if (opts.entity && opts.entity !== 'all') params.set('entity', opts.entity);
  if (opts.status && opts.status !== 'all') params.set('status', opts.status);
  if (opts.search) params.set('search', opts.search);
  if (opts.assigned) params.set('assigned', opts.assigned);
  if (opts.requester) params.set('requester', opts.requester);
  if (opts.dateFrom) params.set('date_from', opts.dateFrom);
  if (opts.dateTo) params.set('date_to', opts.dateTo);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  if (opts.forceLive) params.set('force_live', '1');

  const path = `/dashboard/application/${encodeURIComponent(appId)}/records?${params.toString()}`;
  const result = await apiV1Fetch<AppRecordsResponse>(path, { cache: 'no-store' }, { timeoutMs: 45000 });
  if (!result.ok || !result.data) {
    return { ok: false, error: result.error || 'Failed to load records' };
  }
  writeRecordsCache(appId, queryKey, result.data);
  return { ok: true, data: result.data };
}

const INVENTORY_PAGE = 2000;

function inventoryCacheKey(environment: KissflowApplication['environment'] | string) {
  return `${buildRecordsQueryKey({
    environment: toDbEnvironment(environment),
    limit: INVENTORY_PAGE,
    offset: 0,
  })}|inventory`;
}

/** Paint last good inventory immediately while a live refresh is in flight. */
export function peekApplicationRecordInventory(opts: {
  applicationId: string;
  environment: KissflowApplication['environment'] | string;
}): { items: AppRecordRow[]; columns: AppRecordColumn[]; dataSource?: string } | null {
  const appId = String(opts.applicationId || '').trim();
  if (!appId) return null;
  const cached = readRecordsCache(appId, inventoryCacheKey(opts.environment), true);
  if (!cached?.items?.length) return null;
  return {
    items: cached.items,
    columns: cached.columns || [],
    dataSource: cached.data_source,
  };
}

/** One-time full inventory for client-side dashboard filters (single request from engagement cache). */
export async function loadApplicationRecordInventory(opts: {
  applicationId: string;
  environment: KissflowApplication['environment'] | string;
  skipCache?: boolean;
  forceLive?: boolean;
}): Promise<
  | { ok: true; items: AppRecordRow[]; columns: AppRecordColumn[]; dataSource?: string }
  | { ok: false; error: string }
> {
  const appId = String(opts.applicationId || '').trim();
  const inventoryKey = inventoryCacheKey(opts.environment);

  if (!opts.skipCache) {
    const cached = readRecordsCache(appId, inventoryKey, false);
    if (cached?.items?.length) {
      return {
        ok: true,
        items: cached.items,
        columns: cached.columns || [],
        dataSource: cached.data_source,
      };
    }
  }

  const all: AppRecordRow[] = [];
  let columns: AppRecordColumn[] = [];
  let dataSource: string | undefined;
  let lastError = 'Failed to load records';

  const params = new URLSearchParams();
  params.set('environment', toDbEnvironment(opts.environment));
  params.set('inventory', '1');
  if (opts.forceLive) params.set('force_live', '1');
  const inventoryPath = `/dashboard/application/${encodeURIComponent(appId)}/records?${params.toString()}`;
  const inventoryResult = await apiV1Fetch<AppRecordsResponse>(
    inventoryPath,
    { cache: 'no-store' },
    { timeoutMs: 45000 },
  );
  if (inventoryResult.ok && inventoryResult.data?.items?.length) {
    all.push(...inventoryResult.data.items);
    columns = inventoryResult.data.columns || [];
    dataSource = inventoryResult.data.data_source;
    const reportedTotal = Number(inventoryResult.data.total || all.length);
    // P2P inventory=1 can return a single page (50) with a larger total.
    if (all.length < reportedTotal) {
      let offset = all.length;
      let total = reportedTotal;
      while (offset < total) {
        const page = await loadApplicationRecords({
          applicationId: appId,
          environment: opts.environment,
          limit: INVENTORY_PAGE,
          offset,
          skipCache: opts.skipCache || opts.forceLive,
        });
        if (!page.ok) {
          lastError = page.error;
          break;
        }
        columns = page.data.columns?.length ? page.data.columns : columns;
        dataSource = page.data.data_source || dataSource;
        all.push(...(page.data.items || []));
        total = Number(page.data.total || total);
        offset += INVENTORY_PAGE;
        if (!page.data.items?.length) break;
      }
    }
  } else {
    lastError = inventoryResult.error || lastError;
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await loadApplicationRecords({
        applicationId: appId,
        environment: opts.environment,
        limit: INVENTORY_PAGE,
        offset,
        skipCache: opts.skipCache || opts.forceLive,
        forceLive: opts.forceLive && offset === 0,
      });
      if (!page.ok) {
        lastError = page.error;
        break;
      }
      columns = page.data.columns?.length ? page.data.columns : columns;
      dataSource = page.data.data_source;
      all.push(...(page.data.items || []));
      total = Number(page.data.total || all.length);
      offset += INVENTORY_PAGE;
      if (!page.data.items?.length) break;
    }
  }

  if (!all.length) {
    const stale = readRecordsCache(appId, inventoryKey, true);
    if (stale?.items?.length) {
      return {
        ok: true,
        items: stale.items,
        columns: stale.columns || [],
        dataSource: stale.data_source,
      };
    }
    return { ok: false, error: lastError };
  }

  const payload: AppRecordsResponse = {
    application_id: appId,
    environment: toDbEnvironment(opts.environment),
    data_source: dataSource,
    total: all.length,
    limit: all.length,
    offset: 0,
    columns,
    items: all,
  };
  writeRecordsCache(appId, inventoryKey, payload);
  return { ok: true, items: all, columns, dataSource };
}
