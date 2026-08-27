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
  rejected?: number;
  total_items?: number;
  opened_today?: number;
  closed_today?: number;
  in_progress?: number;
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

const DASHBOARD_CACHE_PREFIX = 'ne_dashboard_snapshot_v4';
/** Landing reuse window — skip network if fresher than this (user request: 5 min). */
export const DASHBOARD_CACHE_STALE_MS = 5 * 60 * 1000;

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
    if (Date.now() - parsed.ts > DASHBOARD_CACHE_STALE_MS) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/** Soft paint — returns last snapshot even when older than 5 minutes. */
export function readDashboardCacheSoft(environment: 'production' | 'development'): DashboardData | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(environment));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardCacheEntry;
    if (!parsed?.data || !Array.isArray(parsed.data.applications) || parsed.data.applications.length === 0) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function isDashboardCacheFresh(
  environment: 'production' | 'development',
  maxAgeMs = DASHBOARD_CACHE_STALE_MS,
): boolean {
  try {
    const raw = sessionStorage.getItem(cacheKey(environment));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as DashboardCacheEntry;
    return Boolean(parsed?.ts && Date.now() - parsed.ts <= maxAgeMs);
  } catch {
    return false;
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
  }, { timeoutMs: 20000 });

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to load dashboard' };
  }

  if (!live) {
    writeDashboardCache(environment, res.data);
  }

  return { ok: true, data: res.data };
}

/** Soft live refresh: related app users + live item counts (no full directory). */
export async function refreshDashboardLive(
  environment: 'production' | 'development' = 'production',
  options?: { applicationId?: string },
): Promise<{ ok: boolean; data?: DashboardData & { warnings?: string[]; refreshed_at?: string }; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }
  const params = new URLSearchParams({ environment });
  if (options?.applicationId) params.set('application_id', options.applicationId);

  const res = await apiV1Fetch<DashboardData & { warnings?: string[]; refreshed_at?: string; applications?: DashboardApplication[] }>(
    `/dashboard/refresh?${params.toString()}`,
    { method: 'POST', body: '{}', cache: 'no-store' },
    { timeoutMs: 120000 },
  );

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to refresh dashboard' };
  }

  // refresh endpoint returns applications on the payload
  const apps = (res.data as { applications?: DashboardApplication[] }).applications;
  if (apps && Array.isArray(apps)) {
    const data: DashboardData = {
      environment,
      applications: apps,
      generated_at: (res.data as { refreshed_at?: string }).refreshed_at || new Date().toISOString(),
      refresh_mode: 'live',
      warnings: res.data.warnings,
    };
    writeDashboardCache(environment, data);
    return { ok: true, data };
  }

  return { ok: true, data: res.data as DashboardData };
}
