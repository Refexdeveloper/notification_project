'use strict';

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

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const obj = data;
  for (const key of ['Data', 'data', 'Items', 'items']) {
    if (Array.isArray(obj[key])) return obj[key];
  }
  return [];
}

function inferType(value) {
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
    const obj = value;
    if ('_id' in obj || 'Name' in obj || 'Email' in obj) return 'user_or_lookup';
    return 'object';
  }
  return typeof value;
}

function sampleValue(value) {
  if (value == null) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  }
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') {
    const obj = value;
    const label = obj.Name || obj.Email || obj._id || obj.Id;
    if (typeof label === 'string' || typeof label === 'number') return String(label);
    return '{…}';
  }
  return undefined;
}

function humanize(key) {
  return key
    .replace(/^_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractFieldsFromItems(data) {
  const items = asArray(data).filter(
    (row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );

  const totalHint =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Number(data.TotalCount ?? data.total_count)
      : NaN;
  const itemCount = Number.isFinite(totalHint) ? totalHint : items.length;
  const sampled = items.slice(0, Math.min(items.length, 50));

  const map = new Map();

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

function readFieldDiscovery(sourcePayload) {
  const payload = sourcePayload && typeof sourcePayload === 'object' ? sourcePayload : {};
  const discovery = payload.field_discovery && typeof payload.field_discovery === 'object'
    ? payload.field_discovery
    : null;
  if (!discovery) {
    return {
      fields: [],
      itemCount: 0,
      sampled: 0,
      syncedAt: null,
    };
  }
  return {
    fields: Array.isArray(discovery.fields) ? discovery.fields : [],
    itemCount: Number(discovery.item_count) || 0,
    sampled: Number(discovery.sampled) || 0,
    syncedAt: discovery.synced_at || null,
  };
}

function buildFieldDiscoveryPayload({ fields, itemCount, sampled }) {
  return {
    synced_at: new Date().toISOString(),
    item_count: itemCount,
    sampled,
    fields,
  };
}

module.exports = {
  extractFieldsFromItems,
  readFieldDiscovery,
  buildFieldDiscoveryPayload,
};
