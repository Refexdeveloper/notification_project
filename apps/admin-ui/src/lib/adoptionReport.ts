/**
 * Adoption report (app roster) — opened from the Adoption / Users / Signed in today cards.
 * Status uses the same IST "today" as the Signed in today card.
 */

import { normalizeCompanyText, recordMatchesCompany } from '@/lib/refexCompanies';
import { personDedupeKey } from '@/lib/personName';

export type AdoptionFocus = 'all' | 'today' | 'ever' | 'never';
export type AdoptionStatus = 'today' | 'earlier' | 'never';

export type AdoptionUser = {
  user_id?: string | null;
  user_name?: string | null;
  email?: string | null;
  company?: string | null;
  company_key?: string | null;
  last_sign_in?: string | null;
  ever_logged_in?: boolean | null;
};

function istYmd(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function adoptionStatus(user: AdoptionUser, now: Date = new Date()): AdoptionStatus {
  const last = user?.last_sign_in;
  if (last && istYmd(last) && istYmd(last) === istYmd(now)) return 'today';
  if (last || user?.ever_logged_in === true) return 'earlier';
  return 'never';
}

export function adoptionMatchesFocus(status: AdoptionStatus, focus: AdoptionFocus): boolean {
  if (focus === 'today') return status === 'today';
  if (focus === 'ever') return status !== 'never';
  if (focus === 'never') return status === 'never';
  return true;
}

export function adoptionCounts(users: AdoptionUser[], now: Date = new Date()) {
  const counts = { all: 0, today: 0, ever: 0, never: 0 };
  for (const u of users || []) {
    const status = adoptionStatus(u, now);
    counts.all += 1;
    if (status === 'today') counts.today += 1;
    if (status !== 'never') counts.ever += 1;
    if (status === 'never') counts.never += 1;
  }
  return counts;
}

/** Today first (latest sign-in), then earlier sign-ins, then never — names A→Z within ties. */
export function adoptionRows(users: AdoptionUser[], focus: AdoptionFocus, now: Date = new Date()) {
  const rank: Record<AdoptionStatus, number> = { today: 0, earlier: 1, never: 2 };
  return (users || [])
    .map((user) => ({ user, status: adoptionStatus(user, now) }))
    .filter((row) => adoptionMatchesFocus(row.status, focus))
    .sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      const at = Date.parse(String(a.user.last_sign_in || '')) || 0;
      const bt = Date.parse(String(b.user.last_sign_in || '')) || 0;
      if (at !== bt) return bt - at;
      return String(a.user.user_name || '').localeCompare(String(b.user.user_name || ''));
    });
}

function adoptionUserKeys(user: AdoptionUser): string[] {
  return [
    String(user.user_id || '').trim().toLowerCase(),
    personDedupeKey(user.user_name),
    String(user.email || '').trim().toLowerCase(),
  ].filter(Boolean);
}

function userMatchesCompanyFilter(
  user: AdoptionUser,
  company: string,
  opts: { itsmCompanyMode?: boolean; leadWebsiteMode?: boolean } = {},
): boolean {
  const stamped = String(user.company || user.company_key || '').trim();
  // Roster rows without a company stamp are not defaulted to RIL (ticket rule).
  // They only enter via ticketKeys when they own company-scoped tickets.
  if (!stamped) return false;
  if (opts.leadWebsiteMode) {
    const hay = normalizeCompanyText([user.company, user.company_key].filter(Boolean).join(' '));
    const want = normalizeCompanyText(company);
    return Boolean(want) && hay.includes(want);
  }
  return recordMatchesCompany(
    {
      company: user.company,
      company_name: user.company,
      company_key: user.company_key,
    },
    company,
    opts.itsmCompanyMode,
  );
}

/**
 * Restrict the Kissflow app roster to the active Company filter.
 * When `ticketKeys` is provided (assignees already in company-scoped tickets),
 * those roster members stay even if their profile company stamp is blank.
 */
export function scopeAdoptionUsers(
  users: AdoptionUser[],
  opts: {
    company?: string | null;
    itsmCompanyMode?: boolean;
    leadWebsiteMode?: boolean;
    /** Compact keys (id / name / email) of assignees in company-scoped tickets */
    ticketKeys?: Iterable<string> | null;
  } = {},
): AdoptionUser[] {
  const company = String(opts.company || 'all').trim();
  if (!company || company === 'all') return users || [];

  const ticketKeySet = new Set(
    [...(opts.ticketKeys || [])].map((k) => String(k || '').trim().toLowerCase()).filter(Boolean),
  );
  const out: AdoptionUser[] = [];
  const seen = new Set<string>();

  for (const user of users || []) {
    const keys = adoptionUserKeys(user);
    const dedupe = keys[0] || keys.join('|');
    if (!dedupe || seen.has(dedupe)) continue;
    const profileMatch = userMatchesCompanyFilter(user, company, opts);
    const ticketMatch = keys.some((k) => ticketKeySet.has(k));
    if (!profileMatch && !ticketMatch) continue;
    seen.add(dedupe);
    out.push(user);
  }
  return out;
}

/** Match Adoption roster rows to the dashboard User filter (id / name / email). */
export function adoptionUserMatchesFilter(
  user: AdoptionUser,
  userFilter: string | null | undefined,
): boolean {
  if (!userFilter || userFilter === 'all') return true;
  const sel = String(userFilter).trim().toLowerCase();
  if (!sel) return true;
  const id = String(user.user_id || user.user_name || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  const have = personDedupeKey(user.user_name);
  const want = personDedupeKey(userFilter);
  if (have && want && (have === want || have.includes(want) || want.includes(have))) return true;
  if (email && (email === sel || email.includes(sel) || sel.includes(email))) return true;
  return id === sel || id.includes(sel) || sel.includes(id);
}

/** Restrict Adoption roster / Users card to the selected User filter. */
export function filterAdoptionUsersByUser(
  users: AdoptionUser[],
  userFilter: string | null | undefined,
): AdoptionUser[] {
  if (!userFilter || userFilter === 'all') return users || [];
  return (users || []).filter((u) => adoptionUserMatchesFilter(u, userFilter));
}

/** Client adoption KPIs from a (possibly company-scoped) roster. */
export function adoptionKpisFromUsers(users: AdoptionUser[], now: Date = new Date()) {
  const counts = adoptionCounts(users, now);
  const denom = counts.all || 0;
  const pct = (n: number) => (denom > 0 ? Math.round((n / denom) * 1000) / 10 : 0);
  return {
    usersCard: denom,
    signedInToday: counts.today,
    adoptionOverall: pct(counts.ever),
    adoptionToday: pct(counts.today),
    counts,
  };
}
