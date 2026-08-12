import type { KissflowApplication } from '@/mocks/applications';
import { resolveBackendApplicationId } from '@/services/applicationsApi';
import type { EngagementReport, UserEngagementRow } from '@/services/userAnalytics';
import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type BackendEngagementUserRow = {
  user_id: string;
  user_name: string | null;
  email: string | null;
  user_type: string | null;
  active_status: string | null;
  last_sign_in: string | null;
  ever_logged_in: boolean;
  assigned: number;
  open: number;
  completed: number;
  rejected: number;
  role_names?: string[];
  has_assignment?: boolean;
  has_app_role?: boolean;
  source_payload?: Record<string, unknown>;
};

export type EngagementListResponse = {
  items: BackendEngagementUserRow[];
  count: number;
  totals: {
    total_users: number;
    active_today: number;
    inactive: number;
    never_logged_in: number;
    total_assigned: number;
    with_assignments?: number;
    with_app_role?: number;
  };
  generated_at?: string;
  snapshot_at?: string | null;
  environment?: string;
  application_id?: string;
  scope?: string;
  warning?: string;
  hint?: string;
  data_source?: string;
  cache_ttl_ms?: number;
};

/** Client-side TTL — skip network if last successful load is fresher than 1 hour. */
export const ENGAGEMENT_CLIENT_CACHE_TTL_MS = 1 * 60 * 60 * 1000;

function cacheKey(appId: string): string {
  return `ne_engagement_backend_${appId}`;
}

function readClientCache(appId: string): EngagementLoadResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(appId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; result: EngagementLoadResult };
    if (!parsed?.ts || !parsed.result?.report) return null;
    if (Date.now() - parsed.ts > ENGAGEMENT_CLIENT_CACHE_TTL_MS) return null;
    return parsed.result;
  } catch {
    return null;
  }
}

function writeClientCache(appId: string, result: EngagementLoadResult) {
  try {
    localStorage.setItem(cacheKey(appId), JSON.stringify({ ts: Date.now(), result }));
  } catch {
    /* ignore quota */
  }
}

function toDbEnvironment(environment: KissflowApplication['environment']): string {
  return environment === 'Production' ? 'production' : 'development';
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isLoggedInToday(lastLogin: string | null): boolean {
  const d = parseDate(lastLogin);
  if (!d) return false;
  return d >= startOfToday();
}

function daysSinceLogin(lastLogin: string | null): number | null {
  const d = parseDate(lastLogin);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function pickPayloadString(payload: Record<string, unknown> | undefined, keys: string[]): string {
  if (!payload) return '';
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function mapRow(row: BackendEngagementUserRow): UserEngagementRow {
  const payload = row.source_payload;
  const lastLogin = row.last_sign_in;
  return {
    userId: row.user_id,
    email: row.email || '',
    name: row.user_name || row.email || row.user_id,
    role: row.user_type || pickPayloadString(payload, ['Role', 'role', 'User_Role']),
    department: pickPayloadString(payload, ['Department', 'department', 'Dept']),
    status: row.active_status || 'Active',
    lastLogin,
    loggedInToday: isLoggedInToday(lastLogin),
    daysSinceLogin: daysSinceLogin(lastLogin),
    kissflowRaw: payload,
    assigned: row.assigned,
    open: row.open,
    pending: 0,
    closed: 0,
    completed: row.completed,
    rejected: row.rejected,
    other: 0,
    byResource: [],
    appRoleNames: row.role_names || [],
    hasAssignment: row.has_assignment,
    hasAppRole: row.has_app_role,
  };
}

export type EngagementLoadResult = {
  report: EngagementReport | null;
  error?: string;
  warning?: string;
  fromClientCache?: boolean;
};

/** Load user engagement from backend-api (snapshot / 2h cache / live). */
export async function loadEngagementFromBackend(
  app: KissflowApplication,
  options?: { live?: boolean; forceNetwork?: boolean },
): Promise<EngagementLoadResult> {
  if (!isBackendApiMode()) {
    return { report: null };
  }

  const applicationId = resolveBackendApplicationId(app);
  const live = Boolean(options?.live);
  const forceNetwork = Boolean(options?.forceNetwork) || live;

  if (!forceNetwork) {
    const cached = readClientCache(applicationId);
    if (cached?.report?.users.length) {
      return {
        ...cached,
        fromClientCache: true,
        warning:
          cached.warning ||
          'Showing cached engagement (< 1h). Click Refresh for a live Kissflow pull.',
      };
    }
  }

  const environment = toDbEnvironment(app.environment);
  const params = new URLSearchParams({
    environment,
    _: String(Date.now()),
  });
  if (live) {
    params.set('refresh', 'live');
  }
  const path = `/applications/${encodeURIComponent(applicationId)}/engagement?${params.toString()}`;
  const res = await apiV1Fetch<EngagementListResponse & { data_source?: string }>(path, {
    cache: 'no-store',
  });

  if (!res.ok || !res.data) {
    return {
      report: null,
      error: res.error || 'Failed to load engagement data',
    };
  }

  const users = res.data.items.map(mapRow);
  const source = res.data.data_source;
  const liveNote =
    source === 'live' || source === 'live_bootstrap' || source === 'live_stale_refresh'
      ? 'Live data from Kissflow (related users only; Asia/Kolkata for sign-in today).'
      : source === 'cache' || source === 'cache_stale'
        ? res.data.hint || 'Cached engagement (< 1h).'
        : undefined;

  const result: EngagementLoadResult = {
    report: {
      applicationId: app.id,
      generatedAt: res.data.generated_at || new Date().toISOString(),
      users,
      totals: {
        totalUsers: res.data.totals.total_users,
        activeToday: res.data.totals.active_today,
        inactive: res.data.totals.inactive,
        neverLoggedIn: res.data.totals.never_logged_in,
        totalAssigned: res.data.totals.total_assigned,
      },
      errors: res.data.warning ? [res.data.warning] : [],
      source: source === 'live' || source?.startsWith('live') ? 'live' : 'cache',
    },
    warning: liveNote || res.data.warning || res.data.hint,
  };

  if (result.report?.users.length) {
    writeClientCache(applicationId, result);
  }

  return result;
}
