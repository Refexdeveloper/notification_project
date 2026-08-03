import { getAccessToken } from './api';

/** True when Admin UI should use backend-api (OpenAPI v1) instead of prototype MySQL API. */
export function isBackendApiMode(): boolean {
  const flag = import.meta.env.VITE_USE_BACKEND_API as string | undefined;
  if (flag === 'true' || flag === '1') return true;
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return Boolean(base?.includes('/api/v1'));
}

export type ApiEnvelope<T> = {
  success: boolean;
  correlation_id: string;
  data?: T;
  error?: { code: string; message: string; retryable?: boolean };
};

function correlationId(): string {
  return crypto.randomUUID();
}

function resolveV1Url(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (base) {
    return `${base}${normalized}`;
  }
  return `/api/v1${normalized}`;
}

/** Fetch backend-api v1 with standard envelope and correlation header. */
export async function apiV1Fetch<T>(
  path: string,
  init: RequestInit = {},
  options?: { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; data: T | null; error?: string; errorCode?: string; correlationId?: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Correlation-Id': correlationId(),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAccessToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const signal =
    options?.timeoutMs && options.timeoutMs > 0
      ? AbortSignal.timeout(options.timeoutMs)
      : init.signal;

  try {
    const res = await fetch(resolveV1Url(path), { ...init, headers, credentials: 'include', signal });
    const json = (await res.json()) as ApiEnvelope<T>;
    const cid = json.correlation_id;
    if (!res.ok || !json.success) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: json.error?.message || `HTTP ${res.status}`,
        errorCode: json.error?.code,
        correlationId: cid,
      };
    }
    return { ok: true, status: res.status, data: (json.data ?? null) as T, correlationId: cid };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error:
        err instanceof Error && err.message === 'Failed to fetch'
          ? 'Network error — check API URL and CORS (Admin UI must reach backend-api).'
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

export type SessionContext = {
  subject: string;
  email: string;
  display_name: string;
  role: string;
  source: 'iap' | 'dev_stub' | 'platform';
  admin_user_id?: string;
};

export type BackendApplicationRow = {
  environment: string;
  application_id: string;
  application_name: string;
  last_seen_at: string;
  is_current: boolean;
  kissflow_account_id?: string | null;
  subdomain?: string | null;
  region?: string | null;
  description?: string | null;
};

export type ApplicationsListResponse = {
  items: BackendApplicationRow[];
  count: number;
  warning?: string;
  hint?: string;
};

export type BackendProcessRow = {
  environment: string;
  process_id: string;
  application_id: string;
  process_name: string;
  last_seen_at: string;
  is_current: boolean;
  field_sync_at?: string | null;
  field_item_count?: number;
  field_count?: number;
};

export type ProcessesListResponse = {
  items: BackendProcessRow[];
  count: number;
  warning?: string;
  hint?: string;
};
