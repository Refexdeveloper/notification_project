/** Refex group companies — shared Entity + Company filter catalog. */

/** Default ITSM company when requester lookup Company_Name is blank. */
export const REFEX_DEFAULT_COMPANY_NAME = 'Refex Industries Limited';

export type RefexCompany = { id: string; label: string };
export type EntityBucket = 'refex' | 'extrovis' | 'venwind';

const RAW_LABELS = [
  '3i Medical Equipment Manufacturing Private Limited',
  '3i Medical Technologies Private Limited',
  'AJ Office',
  'Adonis Medical Systems Private Limited',
  'Athenese Energy Private Limited',
  'Engender Developers Private Limited',
  'Refex Airports Retail Private Limited',
  'Refex Airports Retail Srinagar Private Limited',
  'Refex Capital Advisors LLP',
  'Refex Green Energy Limited',
  'Refex Green Mobility Limited',
  'Refex Green Power Limited',
  'Refex Holding Private Limited',
  'Refex Industries Limited',
  'Refex Life Sciences Private Limited',
  'Refex Renewables & Infrastructure Limited',
  'Refex Shared Services Private Limited',
  'Refex Sustainability Solutions Private Limited',
  'Refex EV Fleet Services Private Limited',
  'STPL Horticulture Private Limited',
  'Scorch Solar Energy Private Limited',
  'Sherisha Solar Spv Two Private Limited',
  'Singe Solar Energy Private Limited',
  'Sourashakthi Energy Private Limited',
  'Spangle Energy Private Limited',
  'Sparzana Aviation Private Limited',
  'Torrid Solar Power Private Limited',
  'Venwind Refex Power Limited',
  'Vyzag Bio-Energy Fuel Private Limited',
] as const;

export function normalizeCompanyText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function companyIdFromLabel(label: string): string {
  return normalizeCompanyText(label).replace(/\s+/g, '-');
}

/** A–Z by label; names that start with a digit (e.g. 3i Medical) sort last. */
export function compareCompanyFilterLabel(a: string, b: string): number {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  const leftDigit = /^[0-9]/.test(left);
  const rightDigit = /^[0-9]/.test(right);
  if (leftDigit !== rightDigit) return leftDigit ? 1 : -1;
  return left.localeCompare(right, 'en', { sensitivity: 'base' });
}

export function sortCompanyFilterOptions<T extends { id: string; label: string }>(rows: T[]): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    if (row.id === 'all') pinned.push(row);
    else rest.push(row);
  }
  rest.sort((a, b) => compareCompanyFilterLabel(a.label, b.label));
  return [...pinned, ...rest];
}

export function isEntityBucketLabel(value: unknown): boolean {
  return /^(refex|extrovis|venwind|refex group)$/i.test(String(value || '').trim());
}

export const REFEX_COMPANIES: RefexCompany[] = RAW_LABELS.map((label) => ({
  id: companyIdFromLabel(label),
  label,
})).sort((a, b) => compareCompanyFilterLabel(a.label, b.label));

const BY_ID = new Map(REFEX_COMPANIES.map((c) => [c.id, c]));
const BY_NORM = REFEX_COMPANIES.map((c) => ({
  id: c.id,
  norm: normalizeCompanyText(c.label),
}));

/** Map free-text / short keys to an Entity bucket (Refex / Extrovis / Venwind). */
export function resolveEntityBucket(raw: unknown): EntityBucket | null {
  const norm = normalizeCompanyText(raw);
  if (!norm) return null;
  if (norm.includes('extrovis')) return 'extrovis';
  if (norm.includes('venwind')) return 'venwind';
  if (norm === 'refex' || norm.includes('refex') || norm === 'all') return 'refex';
  // Known catalog companies that are not Extrovis/Venwind roll into Refex group.
  if (resolveCompanyIdFromText(raw)) return 'refex';
  return null;
}

/** Resolve free-text Entity / Company field to a catalog company id (never bare "refex"). */
export function resolveCompanyIdFromText(raw: unknown): string | null {
  const norm = normalizeCompanyText(raw);
  if (!norm) return null;

  // Extrovis is an entity bucket, not a catalog legal entity.
  if (norm === 'extrovis' || norm.includes('extrovis')) return null;

  // Bare / short "refex" is an entity bucket — do not force Industries.
  if (norm === 'refex' || norm === 'refex group') return null;

  if (norm.includes('venwind')) {
    const hit = BY_NORM.find((c) => c.norm.includes('venwind'));
    return hit?.id || 'venwind-refex-power-limited';
  }

  let best: string | null = null;
  let bestLen = 0;
  for (const row of BY_NORM) {
    if (norm === row.norm || norm.includes(row.norm) || row.norm.includes(norm)) {
      if (row.norm.length > bestLen) {
        best = row.id;
        bestLen = row.norm.length;
      }
    }
  }
  return best;
}

export function companyLabel(id: string): string {
  if (id === 'all') return 'All companies';
  if (id === 'extrovis') return 'Extrovis';
  if (id === 'refex') return 'Refex';
  if (id === 'venwind') return 'Venwind';
  return BY_ID.get(id)?.label || id.replace(/-/g, ' ');
}

export function entityBucketLabel(id: string): string {
  if (id === 'all') return 'All entities';
  if (id === 'extrovis') return 'Extrovis';
  if (id === 'venwind') return 'Venwind';
  if (id === 'refex') return 'Refex';
  return companyLabel(id);
}

/** Companies belonging to an entity bucket. */
export function companiesForEntityBucket(entity: string): RefexCompany[] {
  const bucket = String(entity || 'all').toLowerCase();
  if (!bucket || bucket === 'all') return REFEX_COMPANIES;
  if (bucket === 'extrovis') return []; // Extrovis is not in the 29 legal-entity list
  if (bucket === 'venwind') {
    return REFEX_COMPANIES.filter((c) => c.id.includes('venwind'));
  }
  // Refex group = everything except Venwind
  return REFEX_COMPANIES.filter((c) => !c.id.includes('venwind'));
}

export function buildEntityBucketOptions(
  counts: Record<string, number> = {},
  {
    mode = 'refex_extrovis',
    includeAll = true,
    allLabel = 'All entities',
  }: {
    mode?: 'refex_extrovis' | 'refex_venwind' | 'all_buckets';
    includeAll?: boolean;
    allLabel?: string;
  } = {},
): Array<{ id: string; label: string; count?: number }> {
  const buckets: Array<{ id: string; label: string }> =
    mode === 'refex_venwind'
      ? [
          { id: 'refex', label: 'Refex' },
          { id: 'venwind', label: 'Venwind' },
        ]
      : mode === 'all_buckets'
        ? [
            { id: 'refex', label: 'Refex' },
            { id: 'extrovis', label: 'Extrovis' },
            { id: 'venwind', label: 'Venwind' },
          ]
        : [
            { id: 'refex', label: 'Refex' },
            { id: 'extrovis', label: 'Extrovis' },
          ];

  const rows = buckets.map((b) => ({
    id: b.id,
    label: b.label,
    count: Number(counts[b.id] || 0),
  }));
  if (!includeAll) return rows;
  return [{ id: 'all', label: allLabel, count: 0 }, ...rows];
}

export function buildRefexCompanyOptions(
  counts: Record<string, number> = {},
  {
    includeAll = true,
    allLabel = 'All companies',
    entity = 'all',
  }: { includeAll?: boolean; allLabel?: string; entity?: string } = {},
): Array<{ id: string; label: string; count?: number }> {
  const scoped = companiesForEntityBucket(entity);
  const rows = sortCompanyFilterOptions(scoped.map((c) => ({
    id: c.id,
    label: c.label,
    count: Number(counts[c.id] || 0),
  })));
  if (!includeAll) return rows;
  return [{ id: 'all', label: allLabel, count: 0 }, ...rows];
}

function rowHaystack(
  row: {
    entity?: unknown;
    entity_key?: unknown;
    assignee_company_key?: unknown;
    assignee_company?: unknown;
    company?: unknown;
    company_name?: unknown;
  },
  itsmCompanyMode: boolean,
): string {
  // ITSM: entity_key / entity (process bucket) must win over legal company names
  // like "Refex Industries…" which would otherwise force bucket=refex.
  const parts = itsmCompanyMode
    ? [
      row.entity_key,
      row.entity,
      row.assignee_company_key,
      row.assignee_company,
      row.company_name,
      row.company,
    ]
    : [
      row.company_name,
      row.assignee_company,
      row.entity_key,
      row.entity,
      row.company,
      row.assignee_company_key,
    ];
  return normalizeCompanyText(parts.filter(Boolean).join(' '));
}

/** Match Entity bucket (refex / extrovis / venwind). */
export function recordMatchesEntityBucket(
  row: {
    entity?: unknown;
    entity_key?: unknown;
    assignee_company_key?: unknown;
    assignee_company?: unknown;
    company?: unknown;
    company_name?: unknown;
  },
  filterId: string,
  itsmCompanyMode = false,
): boolean {
  const filter = String(filterId || 'all').trim().toLowerCase();
  if (!filter || filter === 'all') return true;

  // ITSM Refex vs Extrovis is process/entity_key — never infer from legal company text.
  const bucket = itsmCompanyMode
    ? (
      resolveEntityBucket(row.entity_key)
      || resolveEntityBucket(row.entity)
      || resolveEntityBucket(row.assignee_company_key)
      || 'refex'
    )
    : (
      resolveEntityBucket(row.entity_key)
      || resolveEntityBucket(row.entity)
      || resolveEntityBucket(row.assignee_company_key)
      || resolveEntityBucket(rowHaystack(row, false))
      || 'refex'
    );

  if (filter === 'extrovis') return bucket === 'extrovis';
  if (filter === 'venwind') return bucket === 'venwind';
  if (filter === 'refex') {
    if (itsmCompanyMode) {
      // aasik: Refex entity tab excludes Venwind legal companies.
      const companyHay = normalizeCompanyText(
        [row.company_name, row.company, row.assignee_company].filter(Boolean).join(' '),
      );
      if (companyHay.includes('venwind')) return false;
    }
    return bucket === 'refex';
  }
  const hay = rowHaystack(row, itsmCompanyMode);
  return bucket === filter || hay.includes(filter);
}

/** Match a specific company from the 29-company catalog. */
export function recordMatchesCompany(
  row: {
    entity?: unknown;
    entity_key?: unknown;
    assignee_company_key?: unknown;
    assignee_company?: unknown;
    company?: unknown;
    company_name?: unknown;
    company_key?: unknown;
  },
  filterId: string,
  itsmCompanyMode = false,
): boolean {
  const filter = String(filterId || 'all').trim().toLowerCase();
  if (!filter || filter === 'all') return true;

  // Bucket ids still accepted for backwards compatibility.
  if (filter === 'extrovis' || filter === 'refex' || filter === 'venwind') {
    return recordMatchesEntityBucket(row, filter, itsmCompanyMode);
  }

  // Legal company only — never haystack Entity ("refex") into Industries Limited.
  const resolved = itsmCompanyMode
    ? (
      resolveCompanyIdFromText(row.company_name)
      || resolveCompanyIdFromText(row.company)
      || resolveCompanyIdFromText(row.company_key)
    )
    : (
      resolveCompanyIdFromText(row.company_name)
      || resolveCompanyIdFromText(row.assignee_company)
      || resolveCompanyIdFromText(row.company)
      || resolveCompanyIdFromText(row.company_key)
    );

  if (itsmCompanyMode) {
    if (resolved) return resolved === filter;
    const text = String(row.company_name || row.company || '').trim();
    if (text && !isEntityBucketLabel(text)) return false;
    return companyIdFromLabel(REFEX_DEFAULT_COMPANY_NAME) === filter;
  }

  if (resolved) return resolved === filter;

  const fallback =
    resolveCompanyIdFromText(row.entity)
    || resolveCompanyIdFromText(row.entity_key)
    || resolveCompanyIdFromText(row.assignee_company_key);
  return fallback === filter;
}
