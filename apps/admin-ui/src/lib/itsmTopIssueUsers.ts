import {
  isDisplayablePersonName,
  normalizeItsmPersonLabel,
  personDedupeKey,
} from '@/lib/personName';
import {
  getRequestTypeShort,
  isItsmSlaBreached,
  itsmIssueOccurrenceKey,
  itsmIssueOccurrenceLabel,
  itsmRequesterName,
} from '@/lib/itsmRecordDisplay';
import type { AppRecordRow } from '@/services/appRecordsApi';

export type ItsmIssueFace = {
  key: string;
  label: string;
  category: string;
  subCategory: string;
  count: number;
  open: number;
  closed: number;
  slaBreached: number;
};

export type ItsmTopIssueUser = {
  key: string;
  name: string;
  total: number;
  open: number;
  closed: number;
  slaBreached: number;
  issues: ItsmIssueFace[];
};

export type ItsmTicketKind = 'sr' | 'incident' | 'other';

type TicketLike = {
  requested_by?: string | null;
  category?: string | null;
  sub_category?: string | null;
  ticket_type?: string | null;
  status?: string | null;
  [key: string]: unknown;
};

function emptyIssueFace(
  key: string,
  label: string,
  category: string,
  subCategory: string,
): ItsmIssueFace {
  return {
    key,
    label,
    category,
    subCategory,
    count: 0,
    open: 0,
    closed: 0,
    slaBreached: 0,
  };
}

function bumpIssueStatus(face: ItsmIssueFace, row: TicketLike) {
  face.count += 1;
  const status = String(row.status || '').toLowerCase();
  // Closed card = Ticket Status closed only (rejected is separate, not in Closed).
  if (status === 'closed') face.closed += 1;
  else if (status !== 'rejected') face.open += 1;
  if (isItsmSlaBreached(row as AppRecordRow)) face.slaBreached += 1;
}

/** Classify Kissflow Request Type as Service Request / Incident / other. */
export function itsmTicketKind(row: TicketLike): ItsmTicketKind {
  const short = getRequestTypeShort(row.ticket_type);
  if (short === 'SR') return 'sr';
  if (short === 'IC') return 'incident';
  const raw = String(row.ticket_type || '').toLowerCase();
  if (/\bincident\b|\bic\b/.test(raw)) return 'incident';
  if (/service\s*request|\bsr\b/.test(raw)) return 'sr';
  return 'other';
}

export function filterItsmByTicketKind<T extends TicketLike>(
  records: T[],
  kind: Exclude<ItsmTicketKind, 'other'>,
): T[] {
  return (records || []).filter((row) => itsmTicketKind(row) === kind);
}

/**
 * Top requesters by ticket volume, each with Category · Sub Category
 * counts for the issues they raised (scoped inventory).
 */
export function buildItsmTopIssueUsers(
  records: TicketLike[],
  limit = 10,
): ItsmTopIssueUser[] {
  type Acc = {
    name: string;
    total: number;
    open: number;
    closed: number;
    slaBreached: number;
    issues: Map<string, ItsmIssueFace>;
  };
  const byUser = new Map<string, Acc>();

  for (const row of records || []) {
    // Top users = Requester Name (same field as Records / expand “Requester Name”).
    const name = itsmRequesterName(row as AppRecordRow)
      || normalizeItsmPersonLabel(String(row.requested_by || row.requester_name || '').trim());
    if (!isDisplayablePersonName(name)) continue;
    const userKey = personDedupeKey(name);
    if (!userKey) continue;

    const issueKey = itsmIssueOccurrenceKey(row);
    const category = String(row.category || '').trim() || '—';
    const subCategory = String(row.sub_category || '').trim() || '—';
    const label = itsmIssueOccurrenceLabel(row);

    let acc = byUser.get(userKey);
    if (!acc) {
      acc = { name, total: 0, open: 0, closed: 0, slaBreached: 0, issues: new Map() };
      byUser.set(userKey, acc);
    } else if (name.length > acc.name.length) {
      acc.name = name;
    }
    acc.total += 1;
    const status = String(row.status || '').toLowerCase();
    // Closed card = Ticket Status closed only (rejected is separate, not in Closed).
    if (status === 'closed') acc.closed += 1;
    else if (status !== 'rejected') acc.open += 1;
    if (isItsmSlaBreached(row as AppRecordRow)) acc.slaBreached += 1;

    let face = acc.issues.get(issueKey);
    if (!face) {
      face = emptyIssueFace(issueKey, label, category, subCategory);
      acc.issues.set(issueKey, face);
    }
    bumpIssueStatus(face, row);
  }

  return [...byUser.values()]
    .map((acc) => ({
      key: personDedupeKey(acc.name),
      name: acc.name,
      total: acc.total,
      open: acc.open,
      closed: acc.closed,
      slaBreached: acc.slaBreached,
      issues: [...acc.issues.values()].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Top Category · Sub Category issue types by ticket volume (scoped inventory).
 */
export function buildItsmTopTickets(
  records: TicketLike[],
  limit = 10,
): ItsmIssueFace[] {
  const byIssue = new Map<string, ItsmIssueFace>();
  for (const row of records || []) {
    const key = itsmIssueOccurrenceKey(row);
    const category = String(row.category || '').trim() || '—';
    const subCategory = String(row.sub_category || '').trim() || '—';
    const label = itsmIssueOccurrenceLabel(row);
    let face = byIssue.get(key);
    if (!face) {
      face = emptyIssueFace(key, label, category, subCategory);
      byIssue.set(key, face);
    }
    bumpIssueStatus(face, row);
  }
  return [...byIssue.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Recurring Category · Sub Category types (raised at least `minCount` times).
 * Ranked by volume; includes Open / Closed / SLA Breached per type.
 */
export function buildItsmRecurringIssues(
  records: TicketLike[],
  limit = 10,
  minCount = 2,
): ItsmIssueFace[] {
  const floor = Math.max(2, minCount);
  return buildItsmTopTickets(records, Number.MAX_SAFE_INTEGER)
    .filter((issue) => issue.count >= floor)
    .slice(0, Math.max(0, limit));
}

export type ItsmRecurringMonth = {
  /** YYYY-MM (IST) */
  key: string;
  label: string;
  from: string;
  to: string;
  issues: ItsmIssueFace[];
};

/** One requester + issue type that recurred (2+) inside a calendar month. */
export type ItsmRecurringTableRow = {
  key: string;
  monthKey: string;
  monthLabel: string;
  from: string;
  to: string;
  userKey: string;
  userName: string;
  issue: ItsmIssueFace;
};

export type ItsmRecurringTable = {
  /** Up to 5 newest months (oldest → newest for column order). */
  months: Array<{ key: string; label: string; shortLabel: string; from: string; to: string }>;
  rows: ItsmRecurringTableRow[];
};

function ticketCreatedMonthKey(row: TicketLike): string | null {
  const raw = String(row.created_at || '').trim();
  if (!raw) return null;
  try {
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(raw));
    return ymd.slice(0, 7);
  } catch {
    const fallback = raw.slice(0, 7);
    return /^\d{4}-\d{2}$/.test(fallback) ? fallback : null;
  }
}

function monthKeyLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return monthKey;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'long',
      year: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)));
  } catch {
    return monthKey;
  }
}

function monthKeyBounds(monthKey: string): { from: string; to: string } {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return { from: '', to: '' };
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const m = String(month).padStart(2, '0');
  return {
    from: `${year}-${m}-01`,
    to: `${year}-${m}-${String(lastDay).padStart(2, '0')}`,
  };
}

function monthKeyShortLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return monthKey;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      year: '2-digit',
    }).format(new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)));
  } catch {
    return monthKey;
  }
}

/**
 * Recurring issue types grouped by calendar month (IST created_at).
 * An issue type is recurring only when it appears 2+ times inside the same month.
 */
export function buildItsmRecurringIssuesByMonth(
  records: TicketLike[],
  limitPerMonth = 10,
  minCount = 2,
  monthLimit = 5,
): ItsmRecurringMonth[] {
  const byMonth = new Map<string, TicketLike[]>();
  for (const row of records || []) {
    const monthKey = ticketCreatedMonthKey(row);
    if (!monthKey) continue;
    let list = byMonth.get(monthKey);
    if (!list) {
      list = [];
      byMonth.set(monthKey, list);
    }
    list.push(row);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, Math.max(0, monthLimit))
    .map(([key, rows]) => {
      const bounds = monthKeyBounds(key);
      return {
        key,
        label: monthKeyLabel(key),
        from: bounds.from,
        to: bounds.to,
        issues: buildItsmRecurringIssues(rows, limitPerMonth, minCount),
      };
    })
    .filter((month) => month.issues.length > 0);
}

/**
 * Last 5 months of recurring requester + issue-type rows (2+ tickets in that month).
 * Flat table source: Month · User · Issue · Open / Closed / SLA Breached.
 */
export function buildItsmRecurringUserTable(
  records: TicketLike[],
  monthLimit = 5,
  minCount = 2,
): ItsmRecurringTable {
  const floor = Math.max(2, minCount);
  type Acc = {
    monthKey: string;
    userKey: string;
    userName: string;
    face: ItsmIssueFace;
  };
  const byMonthUserIssue = new Map<string, Acc>();
  const monthKeys = new Set<string>();

  for (const row of records || []) {
    const monthKey = ticketCreatedMonthKey(row);
    if (!monthKey) continue;
    const name = itsmRequesterName(row as AppRecordRow)
      || normalizeItsmPersonLabel(String(row.requested_by || row.requester_name || '').trim());
    if (!isDisplayablePersonName(name)) continue;
    const userKey = personDedupeKey(name);
    if (!userKey) continue;

    const issueKey = itsmIssueOccurrenceKey(row);
    const category = String(row.category || '').trim() || '—';
    const subCategory = String(row.sub_category || '').trim() || '—';
    const label = itsmIssueOccurrenceLabel(row);
    const composite = `${monthKey}::${userKey}::${issueKey}`;

    monthKeys.add(monthKey);
    let acc = byMonthUserIssue.get(composite);
    if (!acc) {
      acc = {
        monthKey,
        userKey,
        userName: name,
        face: emptyIssueFace(issueKey, label, category, subCategory),
      };
      byMonthUserIssue.set(composite, acc);
    } else if (name.length > acc.userName.length) {
      acc.userName = name;
    }
    bumpIssueStatus(acc.face, row);
  }

  const newestMonths = [...monthKeys].sort((a, b) => b.localeCompare(a)).slice(0, Math.max(0, monthLimit));
  const monthSet = new Set(newestMonths);
  const monthsAsc = [...newestMonths].sort((a, b) => a.localeCompare(b)).map((key) => {
    const bounds = monthKeyBounds(key);
    return {
      key,
      label: monthKeyLabel(key),
      shortLabel: monthKeyShortLabel(key),
      from: bounds.from,
      to: bounds.to,
    };
  });

  const rows = [...byMonthUserIssue.values()]
    .filter((acc) => monthSet.has(acc.monthKey) && acc.face.count >= floor)
    .map((acc) => {
      const bounds = monthKeyBounds(acc.monthKey);
      return {
        key: `${acc.monthKey}::${acc.userKey}::${acc.face.key}`,
        monthKey: acc.monthKey,
        monthLabel: monthKeyLabel(acc.monthKey),
        from: bounds.from,
        to: bounds.to,
        userKey: acc.userKey,
        userName: acc.userName,
        issue: acc.face,
      } satisfies ItsmRecurringTableRow;
    })
    .sort((a, b) => {
      if (a.monthKey !== b.monthKey) return b.monthKey.localeCompare(a.monthKey);
      if (b.issue.count !== a.issue.count) return b.issue.count - a.issue.count;
      if (a.userName !== b.userName) return a.userName.localeCompare(b.userName);
      return a.issue.label.localeCompare(b.issue.label);
    });

  return { months: monthsAsc, rows };
}
