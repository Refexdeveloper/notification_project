import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type DatabaseAppRow = {
  application_id: string;
  application_name: string;
  schema: string;
  table_name: string;
  item_count: number;
  process_count: number;
  snapshot_at?: string | null;
  last_seen_at?: string | null;
  snapshot_count?: number;
  cache_count?: number;
  data_source?: string;
};

export type DatabaseColumn = { id: string; label: string; value_count?: number };

export type DatabaseItemRow = {
  environment?: string;
  process_id?: string;
  process_name?: string;
  instance_id?: string;
  request_id?: string;
  process_status?: string;
  current_step?: string;
  stage?: string;
  entity?: string;
  requester_email?: string;
  criticality?: string;
  request_number?: number | null;
  snapshot_at?: string | null;
  snapshot_run_id?: string;
  source_payload?: unknown;
  row_source?: string;
};

export type DatabaseProcessOption = {
  process_id: string;
  process_name: string;
  item_count: number;
};

export type DatabaseItemsPage = {
  schema: string;
  table_name: string;
  environment: string;
  application_id: string;
  application_name: string;
  columns: DatabaseColumn[];
  items: DatabaseItemRow[];
  processes: DatabaseProcessOption[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
  process_id?: string | null;
  search?: string | null;
  query_ms?: number;
  warning?: string;
  data_source?: string;
  snapshot_count?: number;
  cache_count?: number;
  available_fields?: DatabaseColumn[];
  default_columns?: string[];
  filter_options?: {
    statuses?: string[];
    entities?: string[];
    sources?: string[];
  };
};

export async function loadDatabaseApplications(environment = 'production'): Promise<{
  items: DatabaseAppRow[];
  warning?: string;
  error?: string;
}> {
  if (!isBackendApiMode()) {
    return { items: [], error: 'Backend API mode is not enabled' };
  }
  const res = await apiV1Fetch<{
    items: DatabaseAppRow[];
    warning?: string;
  }>(`/database/applications?environment=${encodeURIComponent(environment)}`, {}, { timeoutMs: 20000 });
  if (!res.ok || !res.data) {
    return { items: [], error: res.error || 'Failed to load database catalog' };
  }
  return { items: res.data.items || [], warning: res.data.warning };
}

export async function loadDatabaseItems(opts: {
  applicationId: string;
  environment?: string;
  page?: number;
  pageSize?: number;
  processId?: string;
  search?: string;
  status?: string;
  entity?: string;
  source?: string;
}): Promise<{ page: DatabaseItemsPage | null; error?: string }> {
  if (!isBackendApiMode()) {
    return { page: null, error: 'Backend API mode is not enabled' };
  }
  const params = new URLSearchParams();
  params.set('environment', opts.environment || 'production');
  params.set('page', String(opts.page || 1));
  params.set('page_size', String(opts.pageSize || 25));
  if (opts.processId) params.set('process_id', opts.processId);
  if (opts.search) params.set('q', opts.search);
  if (opts.status) params.set('status', opts.status);
  if (opts.entity) params.set('entity', opts.entity);
  if (opts.source) params.set('source', opts.source);
  const res = await apiV1Fetch<DatabaseItemsPage>(
    `/database/applications/${encodeURIComponent(opts.applicationId)}/items?${params.toString()}`,
    {},
    { timeoutMs: 25000 },
  );
  if (!res.ok || !res.data) {
    return { page: null, error: res.error || 'Failed to load database rows' };
  }
  return { page: res.data };
}
