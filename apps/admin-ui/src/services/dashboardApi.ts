import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type DashboardMetricLabels = {
  sign_in_today: string;
  sign_in_rate_overall: string;
  sign_in_rate_today: string;
  open_tickets: string;
  closed_tickets: string;
};

export type DashboardAppMetrics = {
  total_users: number;
  sign_in_today: number;
  sign_in_rate_overall: number;
  sign_in_rate_today: number;
  open_tickets: number;
  closed_tickets: number;
};

export type DashboardApplication = {
  environment: string;
  application_id: string;
  application_name: string;
  snapshot_at: string | null;
  fetched_at?: string | null;
  data_source?: 'live' | 'snapshot';
  snapshot_stale?: boolean;
  metrics: DashboardAppMetrics;
  metric_labels: DashboardMetricLabels;
};

export type DashboardSendRow = {
  id: string;
  application_id: string;
  application_name: string;
  status: string;
  sent_at: string;
};

export type DashboardData = {
  environment: string;
  applications: DashboardApplication[];
  recent_sends?: DashboardSendRow[];
  generated_at?: string;
  refresh_mode?: 'live' | 'snapshot';
  timezone?: string;
  warnings?: string[];
  warning?: string;
};

const DASHBOARD_CACHE_PREFIX = 'ne_dashboard_snapshot_v1';
const DASHBOARD_CACHE_TTL_MS = 2 * 60 * 1000;

type DashboardCacheEntry = {
  ts: number;
  data: DashboardData;
};

function cacheKey(environment: string) {
  return `${DASHBOARD_CACHE_PREFIX}:${environment}`;
}

export function readDashboardCache(environment: 'production' | 'development'): DashboardData | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(environment));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardCacheEntry;
    if (!parsed?.data || !Array.isArray(parsed.data.applications) || parsed.data.applications.length === 0) {
      sessionStorage.removeItem(cacheKey(environment));
      return null;
    }
    if (Date.now() - parsed.ts > DASHBOARD_CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey(environment));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeDashboardCache(environment: string, data: DashboardData) {
  try {
    const entry: DashboardCacheEntry = { ts: Date.now(), data };
    sessionStorage.setItem(cacheKey(environment), JSON.stringify(entry));
  } catch {
    /* ignore quota / private mode */
  }
}

export async function loadDashboard(
  environment: 'production' | 'development' = 'production',
  options?: { live?: boolean; skipCache?: boolean },
): Promise<{ ok: boolean; data?: DashboardData; error?: string; fromCache?: boolean }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const live = Boolean(options?.live);
  if (!live && !options?.skipCache) {
    const cached = readDashboardCache(environment);
    if (cached) {
      return { ok: true, data: cached, fromCache: true };
    }
  }

  const params = new URLSearchParams({ environment });
  if (live) {
    params.set('refresh', 'live');
    params.set('_', String(Date.now()));
  }

  const res = await apiV1Fetch<DashboardData>(`/dashboard?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to load dashboard' };
  }

  if (!live) {
    writeDashboardCache(environment, res.data);
  }

  return { ok: true, data: res.data };
}
