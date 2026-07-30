import type { RefexEnvironment } from '@/seeds/refexAppCatalog';
import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type BackendUserRow = {
  user_id: string;
  user_name: string | null;
  email: string | null;
  user_type: string | null;
  active_status: string | null;
  last_sign_in: string | null;
  ever_logged_in: boolean;
  source_payload?: Record<string, unknown>;
};

export type UsersListResponse = {
  items: BackendUserRow[];
  count: number;
  totals: {
    total_users: number;
    active_today: number;
    inactive: number;
    never_logged_in: number;
  };
  generated_at?: string;
  snapshot_at?: string | null;
  environment?: string;
  scope?: string;
  warning?: string;
  hint?: string;
};

export type WorkspaceUser = {
  userId: string;
  name: string;
  email: string;
  status: string;
  userType: string;
  lastLogin: string | null;
  loggedInToday: boolean;
  everLoggedIn: boolean;
  kissflowRaw?: Record<string, unknown>;
};

export type UsersLoadResult = {
  users: WorkspaceUser[];
  totals: UsersListResponse['totals'];
  generatedAt?: string;
  error?: string;
  warning?: string;
};

function toDbEnvironment(environment: RefexEnvironment): string {
  return environment === 'Production' ? 'production' : 'development';
}

function isLoggedInToday(lastLogin: string | null): boolean {
  if (!lastLogin) return false;
  const d = new Date(lastLogin);
  if (Number.isNaN(d.getTime())) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return d >= start;
}

function mapRow(row: BackendUserRow): WorkspaceUser {
  return {
    userId: row.user_id,
    name: row.user_name || row.email || row.user_id,
    email: row.email || '',
    status: row.active_status || 'Active',
    userType: row.user_type || '',
    lastLogin: row.last_sign_in,
    loggedInToday: isLoggedInToday(row.last_sign_in),
    everLoggedIn: row.ever_logged_in,
    kissflowRaw: row.source_payload,
  };
}

export async function loadWorkspaceUsers(environment: RefexEnvironment): Promise<UsersLoadResult> {
  if (!isBackendApiMode()) {
    return {
      users: [],
      totals: { total_users: 0, active_today: 0, inactive: 0, never_logged_in: 0 },
      error: 'Backend API mode is disabled',
    };
  }

  const env = toDbEnvironment(environment);
  const res = await apiV1Fetch<UsersListResponse>(`/users?environment=${encodeURIComponent(env)}`);
  if (!res.ok || !res.data) {
    return {
      users: [],
      totals: { total_users: 0, active_today: 0, inactive: 0, never_logged_in: 0 },
      error: res.error || 'Failed to load users',
    };
  }

  return {
    users: res.data.items.map(mapRow),
    totals: res.data.totals,
    generatedAt: res.data.generated_at,
    warning: res.data.warning || res.data.hint,
  };
}
