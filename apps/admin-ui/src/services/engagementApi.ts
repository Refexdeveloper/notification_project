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
};

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
};

/** Load user engagement from backend-api PostgreSQL snapshot. */
export async function loadEngagementFromBackend(app: KissflowApplication): Promise<EngagementLoadResult> {
  if (!isBackendApiMode()) {
    return { report: null };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/engagement?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<EngagementListResponse>(path);

  if (!res.ok || !res.data) {
    return {
      report: null,
      error: res.error || 'Failed to load engagement data',
    };
  }

  const users = res.data.items.map(mapRow);
  return {
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
      source: 'live',
    },
    warning: res.data.warning || res.data.hint,
  };
}
