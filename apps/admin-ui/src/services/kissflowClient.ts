import type { KissflowApplication } from '@/mocks/applications';

/**
 * Admin item APIs use the versioned process ID.
 * Registered short IDs (e.g. Lead_Trcaker_A00) map to Lead_tracker_1_A00 for /admin/... only.
 */
const ADMIN_PROCESS_ID_OVERRIDES: Record<string, string> = {
  Lead_Trcaker_A00: 'Lead_tracker_1_A00',
  Lead_Tracker_A00: 'Lead_tracker_1_A00',
  Lead_tracker_A00: 'Lead_tracker_1_A00',
};

export function resolveProcessIdForAdmin(resourceId: string): string {
  return ADMIN_PROCESS_ID_OVERRIDES[resourceId] ?? resourceId;
}

/** Default page size for Kissflow list APIs (users, process items, boards, forms). */
export const KISSFLOW_PAGE_SIZE = 1000;

export function kissflowPageQuery(page = 1, pageSize = KISSFLOW_PAGE_SIZE): string {
  return `page_number=${page}&page_size=${pageSize}`;
}

export function kissflowHost(app: KissflowApplication): string {
  return `https://${app.subdomain}.kissflow.${app.region}`;
}

export async function kissflowFetch(
  app: KissflowApplication,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const host = kissflowHost(app);
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const proxyUrl = `/api/kissflow-proxy${normalized}`;

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Kissflow-Host': host,
      'X-Access-Key-Id': app.accessKeyId,
      'X-Access-Key-Secret': app.accessKeySecret,
      ...(init.headers as Record<string, string> | undefined),
    };

    const res = await fetch(proxyUrl, { ...init, headers });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: typeof data === 'object' && data && 'message' in data
          ? String((data as { message: unknown }).message)
          : `HTTP ${res.status}`,
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['Data', 'data', 'Users', 'users', 'Items', 'items', 'Records', 'records', 'Result']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

export function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (typeof val === 'number') return String(val);
    if (val && typeof val === 'object') {
      const nested = val as Record<string, unknown>;
      // Kissflow datetime fields: { v: "2026-02-17T11:41:07Z", tz, ... }
      if (typeof nested.v === 'string' && nested.v.trim()) return nested.v.trim();
      const nestedId = pickString(nested, ['_id', 'Id', 'id', 'Email', 'Name', 'DisplayName']);
      if (nestedId) return nestedId;
    }
  }
  return '';
}

/** Prefer Kissflow nested date objects (LastLoggedInAt.v) then plain strings. */
export function pickDateTime(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (val && typeof val === 'object') {
      const nested = val as Record<string, unknown>;
      if (typeof nested.v === 'string' && nested.v.trim()) return nested.v.trim();
      if (typeof nested.dv === 'string' && nested.dv.trim()) return nested.dv.trim();
    }
  }
  return null;
}
