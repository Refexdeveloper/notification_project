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

function toDbEnvironment(environment: KissflowApplication['environment'] | string): string {
  const e = String(environment || 'Production');
  return e === 'Production' || e.toLowerCase() === 'production' ? 'production' : 'development';
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
}): Promise<{ ok: true; data: AppRecordsResponse } | { ok: false; error: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode required' };
  }
  const appId = String(opts.applicationId || '').trim();
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

  const path = `/dashboard/application/${encodeURIComponent(appId)}/records?${params.toString()}`;
  const result = await apiV1Fetch<AppRecordsResponse>(path, { cache: 'no-store' }, { timeoutMs: 90000 });
  if (!result.ok || !result.data) {
    return { ok: false, error: result.error || 'Failed to load records' };
  }
  return { ok: true, data: result.data };
}
