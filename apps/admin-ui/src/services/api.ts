const TOKEN_KEY = 'ne_access_token';
const REFRESH_KEY = 'ne_refresh_token';
const USER_KEY = 'ne_auth_user';

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthSession(tokens: {
  accessToken: string;
  refreshToken?: string;
  user: { name: string; email: string; role: string; id?: number };
}) {
  localStorage.setItem(TOKEN_KEY, tokens.accessToken);
  if (tokens.refreshToken) localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(tokens.user));
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T; error?: string }> {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';
  const normalizedPath = path.startsWith('/api') ? path : `/api${path}`;
  const url = apiBase ? `${apiBase}${normalizedPath.replace(/^\/api/, '')}` : normalizedPath;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, {
      ...init,
      headers,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message =
        data && typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: data as T, error: message };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null as T,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ApiUser = {
  id: number;
  name: string;
  email: string;
  role_id: number;
  is_active: boolean;
  role?: { id: number; name: string };
  createdAt?: string;
  updatedAt?: string;
};

export type ApiRole = { id: number; name: string; description?: string };
