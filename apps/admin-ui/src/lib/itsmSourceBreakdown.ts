export const ITSM_SOURCE_CHANNELS = [
  { id: 'Email', tone: '#3b82f6' },
  { id: 'WhatsApp', tone: '#22c55e' },
  { id: 'Mobile', tone: '#f59e0b' },
  { id: 'Web', tone: '#8b5cf6' },
] as const;

export type ItsmSourceId = (typeof ITSM_SOURCE_CHANNELS)[number]['id'];

export type ItsmSourceCounts = Record<ItsmSourceId, number> & { Other: number };

export type SourceBreakdownRow = { name?: string; count?: number };

export function emptyItsmSourceCounts(): ItsmSourceCounts {
  return { Email: 0, WhatsApp: 0, Mobile: 0, Web: 0, Other: 0 };
}

/** Always return Email / WhatsApp / Mobile / Web (zeros stay visible, like the email HTML). */
export function sourceCountsFromBreakdown(rows?: SourceBreakdownRow[] | null): ItsmSourceCounts {
  const out = emptyItsmSourceCounts();
  for (const row of rows || []) {
    const name = String(row?.name || '').trim();
    const count = Number(row?.count || 0);
    if (name === 'Email' || name === 'WhatsApp' || name === 'Mobile' || name === 'Web' || name === 'Other') {
      out[name] = count;
    }
  }
  return out;
}

export function sourceChannelTotal(counts: ItsmSourceCounts): number {
  return counts.Email + counts.WhatsApp + counts.Mobile + counts.Web;
}

export function breakdownFromCounts(counts: ItsmSourceCounts): SourceBreakdownRow[] {
  return [...ITSM_SOURCE_CHANNELS.map((c) => ({ name: c.id, count: counts[c.id] })), { name: 'Other', count: counts.Other }];
}

/** Same rules as email / backend classifyTicketSource. */
export function classifyTicketSource(rawOrText: unknown): ItsmSourceId | 'Other' {
  const sourceRaw = typeof rawOrText === 'string'
    ? rawOrText
    : (rawOrText && typeof rawOrText === 'object'
      ? String((rawOrText as { source?: unknown; source_channel?: unknown }).source
        || (rawOrText as { source_channel?: unknown }).source_channel
        || '')
      : '');
  const s = String(sourceRaw || '').toLowerCase().trim();
  if (!s) return 'Other';
  if (s.includes('whats')) return 'WhatsApp';
  if (s.includes('email') || s.includes('e-mail') || s.includes('e mail') || s === 'mail') return 'Email';
  if (s.includes('mobile') || s.includes('android') || s.includes('ios') || s.includes('phone') || s.includes('sms') || /\bapp\b/.test(s)) {
    return 'Mobile';
  }
  if (s.includes('web') || s.includes('portal') || s.includes('browser') || s.includes('desktop') || s.includes('kissflow')) {
    return 'Web';
  }
  if (s === 'other') return 'Other';
  if (s === 'email' || s === 'whatsapp' || s === 'mobile' || s === 'web') {
    return (s.charAt(0).toUpperCase() + s.slice(1)) as ItsmSourceId;
  }
  return 'Other';
}

function recordSourceChannel(row: { source?: unknown; source_channel?: unknown }): ItsmSourceId | 'Other' {
  const raw = row.source || row.source_channel;
  if (!raw) return 'Other';
  const text = String(raw).trim();
  if (text === 'Email' || text === 'WhatsApp' || text === 'Mobile' || text === 'Web' || text === 'Other') {
    return text;
  }
  return classifyTicketSource(text);
}

export function recordsHaveSource(
  rows?: Array<{ source?: unknown; source_channel?: unknown }> | null,
): boolean {
  return (rows || []).some((row) => Boolean(row.source || row.source_channel));
}

/**
 * Source panels always follow the same filtered ticket set as the KPI cards.
 * Empty filter → zeros. Never keep an unfiltered API mix.
 */
export function itsmSourceFromFilteredRecords(
  rows: Array<{
    source?: unknown;
    source_channel?: unknown;
    status?: unknown;
    created_at?: unknown;
  }> | null | undefined,
  todayYmd: string,
): { all: SourceBreakdownRow[]; today: SourceBreakdownRow[] } {
  return {
    all: breakdownFromCounts(sourceCountsFromRecords(rows)),
    today: breakdownFromCounts(todayOpenSourceCounts(rows, todayYmd)),
  };
}

export function sourceCountsFromRecords(
  rows?: Array<{ source?: unknown; source_channel?: unknown }> | null,
): ItsmSourceCounts {
  const out = emptyItsmSourceCounts();
  for (const row of rows || []) {
    out[recordSourceChannel(row)] += 1;
  }
  return out;
}

/** Email HTML right panel: created today IST and still Open. */
export function todayOpenSourceCounts(
  rows: Array<{
    source?: unknown;
    source_channel?: unknown;
    status?: unknown;
    created_at?: unknown;
  }> | null | undefined,
  todayYmd: string,
): ItsmSourceCounts {
  const out = emptyItsmSourceCounts();
  for (const row of rows || []) {
    if (String(row.status || '').toLowerCase() !== 'open') continue;
    const created = String(row.created_at || '');
    if (!created) continue;
    let day = created.slice(0, 10);
    try {
      day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(created));
    } catch {
      /* keep slice */
    }
    if (day !== todayYmd) continue;
    out[recordSourceChannel(row)] += 1;
  }
  return out;
}
