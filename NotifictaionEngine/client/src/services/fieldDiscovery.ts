import type { DiscoveredField, KissflowApplication } from '@/mocks/applications';
import { asArray, kissflowFetch, kissflowPageQuery, KISSFLOW_PAGE_SIZE } from './kissflowClient';

export type { DiscoveredField };

export interface FieldSyncResult {
  ok: boolean;
  fields: DiscoveredField[];
  itemCount: number;
  sampled: number;
  error?: string;
  status?: number;
}

const SYSTEMISH = new Set([
  '_id',
  '_created_at',
  '_created_by',
  '_modified_at',
  '_modified_by',
  '_flow_name',
  '_activity_instance_id',
  '_activity_id',
  '_root_process_instance',
]);

function inferType(value: unknown): string {
  if (value == null) return 'unknown';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (value.includes('@') && value.includes('.')) return 'email';
    return 'string';
  }
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('_id' in obj || 'Name' in obj || 'Email' in obj) return 'user_or_lookup';
    return 'object';
  }
  return typeof value;
}

function sampleValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  }
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const label = obj.Name || obj.Email || obj._id || obj.Id;
    if (typeof label === 'string' || typeof label === 'number') return String(label);
    return '{…}';
  }
  return undefined;
}

function humanize(key: string): string {
  return key
    .replace(/^_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Infer unique fields from admin Get-all-items payload. */
export function extractFieldsFromItems(data: unknown): {
  fields: DiscoveredField[];
  itemCount: number;
  sampled: number;
} {
  const items = asArray(data).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );

  const totalHint =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Number((data as Record<string, unknown>).TotalCount ?? (data as Record<string, unknown>).total_count)
      : NaN;
  const itemCount = Number.isFinite(totalHint) ? totalHint : items.length;
  const sampled = items.slice(0, Math.min(items.length, 50));

  const map = new Map<
    string,
    { type: string; sample?: string; occurrences: number; system: boolean }
  >();

  for (const item of sampled) {
    for (const [key, value] of Object.entries(item)) {
      if (!key) continue;
      const existing = map.get(key);
      const type = inferType(value);
      const sample = sampleValue(value);
      if (existing) {
        existing.occurrences += 1;
        if (!existing.sample && sample) existing.sample = sample;
        if (existing.type === 'unknown' && type !== 'unknown') existing.type = type;
      } else {
        map.set(key, {
          type,
          sample,
          occurrences: 1,
          system: key.startsWith('_') || SYSTEMISH.has(key),
        });
      }
    }
  }

  const fields = [...map.entries()]
    .map(([name, meta]) => ({
      id: name,
      name,
      label: humanize(name),
      type: meta.type,
      sample: meta.sample,
      occurrences: meta.occurrences,
    }))
    .sort((a, b) => {
      const aSys = a.name.startsWith('_') ? 1 : 0;
      const bSys = b.name.startsWith('_') ? 1 : 0;
      if (aSys !== bSys) return aSys - bSys;
      return a.name.localeCompare(b.name);
    });

  return { fields, itemCount, sampled: sampled.length };
}

/**
 * Hit Kissflow admin Get-all-items, then derive field metadata from items.
 * Uses processId override, else application App ID.
 */
export async function syncFieldsFromAdminItems(
  app: KissflowApplication,
  options?: { processId?: string },
): Promise<FieldSyncResult> {
  const appId = (options?.processId || app.appId || '').trim();
  if (!appId) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      error: 'App ID is required. Set it under Settings, then sync again.',
    };
  }
  if (!app.accountId?.trim()) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      error: 'Account ID is required.',
    };
  }
  if (!app.accessKeyId || !app.accessKeySecret) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      error: 'Access Key ID and Secret are required.',
    };
  }

  const account = encodeURIComponent(app.accountId.trim());
  const processId = encodeURIComponent(appId);
  const path = `/process/2/${account}/admin/${processId}/item?${kissflowPageQuery(1, KISSFLOW_PAGE_SIZE)}&apply_preference=1`;

  const res = await kissflowFetch(app, path);
  if (!res.ok) {
    return {
      ok: false,
      fields: [],
      itemCount: 0,
      sampled: 0,
      status: res.status,
      error:
        res.status === 403
          ? '403 Forbidden: Admin Access Key required for Get all items (Admin).'
          : res.status === 401
            ? '401 Unauthorized: check Access Key ID / Secret.'
            : res.error || `HTTP ${res.status}`,
    };
  }

  const extracted = extractFieldsFromItems(res.data);
  return {
    ok: true,
    fields: extracted.fields,
    itemCount: extracted.itemCount,
    sampled: extracted.sampled,
  };
}
