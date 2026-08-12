import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type PlatformUser = {
  id: string;
  identity_subject: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at?: string;
  roles: string[];
  has_password?: boolean;
};

export type PlatformUsersListResult = {
  users: PlatformUser[];
  canManage: boolean;
  currentUserRole?: string;
  warning?: string;
  error?: string;
};

export async function loadPlatformUsers(): Promise<PlatformUsersListResult> {
  if (!isBackendApiMode()) {
    return { users: [], canManage: false, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<{
    items: PlatformUser[];
    warning?: string;
    can_manage?: boolean;
    current_user_role?: string;
  }>('/platform-users');
  if (!res.ok || !res.data) {
    return { users: [], canManage: false, error: res.error || 'Failed to load platform users' };
  }

  return {
    users: res.data.items.map((row) => ({
      ...row,
      roles: Array.isArray(row.roles) ? row.roles : [],
    })),
    canManage: Boolean(res.data.can_manage),
    currentUserRole: res.data.current_user_role,
    warning: res.data.warning,
  };
}

export async function createPlatformUser(payload: {
  email: string;
  display_name: string;
  role?: string;
  password: string;
  identity_subject?: string;
  is_active?: boolean;
}): Promise<{ ok: boolean; user?: PlatformUser; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<{ item: PlatformUser }>('/platform-users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to create platform user' };
  }

  return { ok: true, user: res.data.item };
}

export async function updatePlatformUser(
  userId: string,
  payload: { display_name?: string; role?: string; is_active?: boolean; password?: string },
): Promise<{ ok: boolean; user?: PlatformUser; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<{ item: PlatformUser }>(`/platform-users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to update platform user' };
  }

  return { ok: true, user: res.data.item };
}

export async function deactivatePlatformUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<{ deleted: boolean }>(`/platform-users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    return { ok: false, error: res.error || 'Failed to deactivate platform user' };
  }

  return { ok: true };
}

export const PLATFORM_ROLES = ['ADMIN', 'VIEWER'] as const;
