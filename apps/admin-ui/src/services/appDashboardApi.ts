import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type AppDashboardProcess = {
  process_id: string;
  process_name?: string;
  process_label?: string;
  sort_order?: number;
  total: number;
  pending: number;
  completed: number;
  closed?: number;
  rejected?: number;
  open_count?: number;
  in_progress?: number;
  amount_total?: number;
  amount_open?: number;
};

export type AppDashboardEntityRow = {
  entity_id: string;
  entity_label: string;
  total: number;
  open: number;
  closed: number;
  rejected: number;
  closure_ratio?: number;
};

export type AppDashboardBreakdown = {
  name: string;
  count: number;
};

export type AppDashboardUser = {
  user_id?: string;
  user_name: string;
  total: number;
  pending?: number;
  completed?: number;
  open?: number;
  closed?: number;
  rejected?: number;
  last_sign_in?: string | null;
};

export type AppDashboardEntity = {
  id: string;
  label: string;
  count: number;
};

export type AppDashboardData = {
  environment: string;
  application_id: string;
  application_name: string;
  snapshot_at: string | null;
  data_source?: string;
  filters: {
    entity: string;
    process_id: string;
    resource_type?: string;
    resource_id?: string;
    period: string;
    date_from?: string | null;
    date_to?: string | null;
    supports_entity_filter: boolean;
    supports_period_filter?: boolean;
    supports_resource_filter?: boolean;
  };
  entities?: AppDashboardEntity[];
  processes: Array<{ process_id: string; process_name: string }>;
  boards?: Array<{ board_id: string; board_name?: string; resource_type?: string }>;
  resource_options?: Array<{ resource_type: string; resource_id: string; resource_name: string }>;
  resources?: { processes: number; boards: number; dataforms: number; datasets: number };
  metrics: {
    total: number;
    pending: number;
    completed: number;
    closed?: number;
    rejected: number;
    open?: number;
    in_progress?: number;
    projects?: number;
    total_users?: number;
    signed_in_today?: number;
    sign_in_rate_overall?: number;
    sign_in_rate_today?: number;
    user_adoption_pct?: number;
    never_logged_in?: number;
    inactive_users?: number;
    amount_total?: number;
    amount_open?: number;
    status_model?: 'open_closed' | 'open_in_progress_closed';
  };
  amounts?: {
    total?: number;
    open?: number;
  };
  by_entity?: AppDashboardEntityRow[];
  by_process: AppDashboardProcess[];
  by_source?: AppDashboardBreakdown[];
  by_category?: AppDashboardBreakdown[];
  portfolio?: {
    projects_total: number;
    projects_open: number;
    projects_closed: number;
    tasks_total: number;
    tasks_open: number;
    tasks_closed: number;
    linked_tasks: number;
    individual_total: number;
    individual_open: number;
    individual_closed: number;
    subtasks_total: number;
    subtasks_open: number;
    subtasks_closed: number;
  };
  users: AppDashboardUser[];
  board_filter_note?: string;
  report_layout?: {
    kind: string;
    rows: string[];
    note?: string;
    entity_reports?: string[];
    kpi_labels?: { total?: string; open?: string; closed?: string; rejected?: string };
  };
  generated_at?: string;
  warning?: string;
};

const APP_DASHBOARD_CACHE_PREFIX = 'ne_app_dashboard_v8';
const APP_DASHBOARD_CACHE_STALE_MS = 15 * 60 * 1000;

type AppDashboardCacheEntry = {
  ts: number;
  data: AppDashboardData;
};

function appDashboardCacheKey(applicationId: string, queryKey: string) {
  return `${APP_DASHBOARD_CACHE_PREFIX}:${applicationId}:${queryKey}`;
}

function buildQueryKey(opts: {
  environment?: string;
  entity?: string;
  processId?: string;
  resourceType?: string;
  resourceId?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return [
    opts.environment || 'production',
    opts.entity || 'all',
    opts.resourceType || 'all',
    opts.resourceId || opts.processId || 'all',
    opts.period || 'all',
    opts.dateFrom || '',
    opts.dateTo || '',
  ].join('|');
}

export function appDashboardQueryKey(opts: {
  environment?: string;
  entity?: string;
  processId?: string;
  resourceType?: string;
  resourceId?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return buildQueryKey(opts);
}

export function readAppDashboardCache(
  applicationId: string,
  queryKey: string,
): AppDashboardData | null {
  try {
    const raw = sessionStorage.getItem(appDashboardCacheKey(applicationId, queryKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppDashboardCacheEntry;
    if (!parsed?.data?.application_id) {
      sessionStorage.removeItem(appDashboardCacheKey(applicationId, queryKey));
      return null;
    }
    if (Date.now() - parsed.ts > APP_DASHBOARD_CACHE_STALE_MS) {
      sessionStorage.removeItem(appDashboardCacheKey(applicationId, queryKey));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeAppDashboardCache(applicationId: string, queryKey: string, data: AppDashboardData) {
  try {
    const entry: AppDashboardCacheEntry = { ts: Date.now(), data };
    sessionStorage.setItem(appDashboardCacheKey(applicationId, queryKey), JSON.stringify(entry));
  } catch {
    /* ignore quota / private mode */
  }
}

export async function loadApplicationDashboard(opts: {
  applicationId: string;
  environment?: 'production' | 'development';
  entity?: string;
  processId?: string;
  resourceType?: string;
  resourceId?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  skipCache?: boolean;
}): Promise<{ data: AppDashboardData; fromCache?: boolean }> {
  if (!isBackendApiMode()) {
    throw new Error('Backend API mode is required for the live application dashboard.');
  }

  const queryKey = buildQueryKey(opts);
  if (!opts.skipCache) {
    const cached = readAppDashboardCache(opts.applicationId, queryKey);
    if (cached) {
      return { data: cached, fromCache: true };
    }
  }

  const params = new URLSearchParams();
  params.set('environment', opts.environment || 'production');
  if (opts.entity && opts.entity !== 'all') params.set('entity', opts.entity);
  if (opts.resourceType && opts.resourceType !== 'all' && opts.resourceId && opts.resourceId !== 'all') {
    params.set('resource_type', opts.resourceType);
    params.set('resource_id', opts.resourceId);
  } else if (opts.processId && opts.processId !== 'all') {
    params.set('process_id', opts.processId);
  }
  if (opts.period && opts.period !== 'all') params.set('period', opts.period);
  if (opts.dateFrom) params.set('date_from', opts.dateFrom);
  if (opts.dateTo) params.set('date_to', opts.dateTo);

  const path = `/dashboard/application/${encodeURIComponent(opts.applicationId)}?${params.toString()}`;
  const res = await apiV1Fetch<AppDashboardData>(path, { cache: 'no-store' }, { timeoutMs: 20000 });

  if (!res.ok || !res.data) {
    throw new Error(res.error || `Dashboard failed (${res.status || 'network'})`);
  }

  writeAppDashboardCache(opts.applicationId, queryKey, res.data);
  return { data: res.data };
}

export async function refreshApplicationDashboardLive(opts: {
  applicationId: string;
  environment?: 'production' | 'development';
}): Promise<AppDashboardData> {
  const params = new URLSearchParams({
    environment: opts.environment || 'production',
    application_id: opts.applicationId,
  });
  const res = await apiV1Fetch<{ application_dashboard?: AppDashboardData; warnings?: string[] }>(
    `/dashboard/refresh?${params.toString()}`,
    { method: 'POST', body: '{}', cache: 'no-store' },
    { timeoutMs: 120000 },
  );
  if (!res.ok || !res.data?.application_dashboard) {
    throw new Error(res.error || 'Live refresh failed');
  }
  const data = res.data.application_dashboard;
  writeAppDashboardCache(
    opts.applicationId,
    buildQueryKey({ environment: opts.environment, entity: 'all', processId: 'all', period: 'all' }),
    data,
  );
  return data;
}
