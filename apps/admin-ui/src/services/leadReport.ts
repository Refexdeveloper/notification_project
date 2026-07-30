/**
 * Lead Tracker report: fetch all process items → filter by Website → aggregate per sales person.
 */

import type { KissflowApplication } from '@/mocks/applications';
import {
  asArray,
  kissflowFetch,
  kissflowPageQuery,
  KISSFLOW_PAGE_SIZE,
  pickString,
  resolveProcessIdForAdmin,
} from './kissflowClient';
import { bucketStatus } from './userAnalytics';
import { fetchAllKissflowUsers, fetchKissflowUserDetail, type KissflowUserRecord } from './kissflowUsers';

const REPORT_TZ = 'Asia/Kolkata';

/** Lead Tracker sales teams — leads filtered by Kissflow `Website_and_form`. */
export const LEAD_TRACKER_SALES_GROUPS = [
  {
    groupName: '3i Sales Team',
    websiteFilter: '3iMedtech',
    slug: '3i',
  },
  {
    groupName: 'Sales Team Modepro',
    websiteFilter: 'Modepro',
    slug: 'modepro',
  },
  {
    groupName: 'Sales Team Adonis',
    websiteFilter: 'Adonis',
    slug: 'adonis',
  },
  {
    groupName: 'Sales Team Refex Mobility',
    websiteFilter: 'Refex Mobility',
    slug: 'refex-mobility',
  },
] as const;

export const LEAD_TRACKER_TEST_RECIPIENTS = [
  'raghul.je@refex.co.in',
  'murugesh.k@refex.co.in',
  'pravinkumar.raja@refex.co.in',
];

export interface LeadReportRow {
  email: string;
  name: string;
  openLeads: number;
  closedLeads: number;
  loggedInToday: boolean;
  lastSignedIn: string | null;
}

export interface LeadReport {
  applicationId: string;
  websiteFilter: string | null;
  userGroupFilter: string | null;
  generatedAt: string;
  rows: LeadReportRow[];
  totals: {
    totalLeads: number;
    openLeads: number;
    closedLeads: number;
    salesPersons: number;
    signedInToday: number;
  };
  errors: string[];
  source: 'live' | 'cache';
}

const CACHE_PREFIX = 'ne_lead_report_';

function istDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: REPORT_TZ });
}

function isLoggedInToday(lastLogin: string | null): boolean {
  if (!lastLogin) return false;
  const d = new Date(lastLogin);
  if (Number.isNaN(d.getTime())) return false;
  return istDateKey(d) === istDateKey(new Date());
}

function formatLoginIST(value: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', {
    timeZone: REPORT_TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function enrichRowsWithFreshLogin(
  app: KissflowApplication,
  rows: LeadReportRow[],
  userByEmail: Map<string, KissflowUserRecord>,
  userByName: Map<string, KissflowUserRecord>,
  userById: Map<string, KissflowUserRecord>,
): Promise<void> {
  for (const row of rows) {
    let userId =
      userByEmail.get(row.email.toLowerCase())?.userId ||
      userByName.get(row.name.toLowerCase())?.userId;
    if (!userId) {
      for (const u of userById.values()) {
        if (u.email && u.email.toLowerCase() === row.email.toLowerCase()) {
          userId = u.userId;
          break;
        }
      }
    }
    if (!userId) continue;

    const detail = await fetchKissflowUserDetail(app, userId);
    if (!detail) continue;

    row.lastSignedIn = detail.lastLogin;
    row.loggedInToday = isLoggedInToday(detail.lastLogin);
    if (detail.email && !row.email) row.email = detail.email;
    if (detail.name && (!row.name || row.name === row.email)) row.name = detail.name;
  }
}

function extractWebsite(obj: Record<string, unknown>): string {
  for (const key of [
    'Website_and_form',
    'Website',
    'website',
    'Lead_Website',
    'Website_Name',
    'Source_Website',
    'Lead_Source',
    'Source',
    'Company_Website',
  ]) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (val && typeof val === 'object') {
      const nested = val as Record<string, unknown>;
      const label = pickString(nested, ['Name', 'name', 'Label', 'DisplayName', 'Value']);
      if (label) return label;
    }
  }
  return '';
}

function extractLeadStatus(obj: Record<string, unknown>): string {
  return (
    pickString(obj, [
      'Status',
      'status',
      '_status',
      'Lead_Status',
      'LeadStatus',
      'Stage',
      'State',
      'Lead_Stage',
    ]) || 'Unknown'
  );
}

function extractSalesPerson(obj: Record<string, unknown>): {
  ids: string[];
  emails: string[];
  names: string[];
} {
  const ids: string[] = [];
  const emails: string[] = [];
  const names: string[] = [];
  const roleNames: string[] = [];

  const pushPerson = (val: unknown, allowRole = false) => {
    if (!val) return;
    if (typeof val === 'string') {
      if (val.includes('@')) emails.push(val.toLowerCase());
      else if (val) names.push(val);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((entry) => pushPerson(entry, allowRole));
      return;
    }
    if (typeof val === 'object') {
      const o = val as Record<string, unknown>;
      const kind = pickString(o, ['Kind', 'kind']);
      if (kind === 'AppRole') {
        if (allowRole) {
          const roleName = pickString(o, ['Name', 'name']);
          if (roleName) roleNames.push(roleName);
        }
        return;
      }
      const id = pickString(o, ['_id', 'Id', 'id', 'UserId']);
      const email = pickString(o, [
        'Email',
        'email',
        'MailId',
        'UserName',
        'Sales_Person_Email',
        'Final_sales_person_email',
      ]);
      const name = pickString(o, ['Name', 'DisplayName', 'FullName', 'FirstName']);
      if (id) ids.push(id);
      if (email) emails.push(email.toLowerCase());
      if (name) names.push(name);
    }
  };

  // Prefer explicit sales-person fields, then assigned-to users, then role queue.
  for (const key of [
    'Final_Sales_Person_user',
    'Final_sales_person_email',
    'Sales_Person_1',
    'SalesPerson',
    'Sales Person',
    'Sales_Person',
    'AssignedTo',
    'Assignee',
    'Owner',
    'CurrentAssignee',
    'Responsible',
    '_assigned_to',
  ]) {
    if (key in obj) pushPerson(obj[key], key === '_current_assigned_to');
  }

  for (const key of ['Sales_Person_Lookup', 'Sales_Person_Lookup__City', 'Sales_Person_Lookup__State']) {
    const lookup = obj[key];
    if (lookup && typeof lookup === 'object' && !Array.isArray(lookup) && Object.keys(lookup).length) {
      pushPerson(lookup);
    }
  }

  if (Array.isArray(obj._current_assigned_to)) {
    pushPerson(obj._current_assigned_to, true);
  }

  if (!emails.length && !names.length && !ids.length && roleNames.length) {
    names.push(...roleNames);
  }

  return { ids, emails, names };
}

function normalizeLeadStatus(raw: string): 'Open' | 'Closed' | 'Other' {
  const s = raw.toLowerCase().trim();
  if (s === 'open') return 'Open';
  if (s === 'close' || s === 'closed') return 'Closed';
  if (isLeadClosed(raw)) return 'Closed';
  if (isLeadOpen(raw)) return 'Open';
  return 'Other';
}

function isLeadClosed(status: string): boolean {
  const s = status.toLowerCase().trim();
  if (s === 'close' || s === 'closed') return true;
  const b = bucketStatus(status);
  return b === 'closed' || b === 'completed' || b === 'rejected';
}

function isLeadOpen(status: string): boolean {
  const s = status.toLowerCase().trim();
  if (s === 'open') return true;
  return !isLeadClosed(status);
}

function websiteMatches(leadWebsite: string, filter: string): boolean {
  const w = leadWebsite.trim().toLowerCase();
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  if (!w) return false;
  return w === f || w.includes(f) || f.includes(w);
}

/** Paginated fetch of all items from Lead Tracker process. */
export async function fetchAllLeadItems(
  app: KissflowApplication,
  processId: string,
): Promise<{ items: Record<string, unknown>[]; error?: string }> {
  const account = encodeURIComponent(app.accountId);
  const rid = encodeURIComponent(processId);
  const adminRid = encodeURIComponent(
    (app.appId || '').trim() || resolveProcessIdForAdmin(processId),
  );

  const pathBuilders = [
    (page: number) =>
      `/process/2/${account}/admin/${adminRid}/item?${kissflowPageQuery(page)}&apply_preference=1`,
    (page: number) => `/process/2/${account}/${rid}/myitems?${kissflowPageQuery(page)}`,
    (page: number) => `/process/2/${account}/${rid}/mytasks?${kissflowPageQuery(page)}`,
  ];

  const failures: string[] = [];

  for (const buildPath of pathBuilders) {
    const all: Record<string, unknown>[] = [];
    let page = 1;
    let hadSuccess = false;

    while (page <= 100) {
      const res = await kissflowFetch(app, buildPath(page));
      if (!res.ok) {
        failures.push(`${buildPath(page)}: ${res.error || res.status}`);
        break;
      }
      hadSuccess = true;
      const batch = asArray(res.data).filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object' && !Array.isArray(row),
      );
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < KISSFLOW_PAGE_SIZE) break;
      page += 1;
    }

    if (hadSuccess) return { items: all };
  }

  return {
    items: [],
    error: failures[0] || `Could not fetch leads for ${processId}`,
  };
}

function personRowKey(person: { emails: string[]; names: string[]; ids: string[] }): string {
  return (person.emails[0] || person.names[0] || person.ids[0] || '').toLowerCase();
}

export function renderLeadReportTableHtml(rows: LeadReportRow[]): string {
  if (!rows.length) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececea;border-radius:4px;overflow:hidden;">
<tr><td style="padding:24px;text-align:center;font-size:13px;color:#888888;">No users/leads for this team.</td></tr></table>`;
  }

  const bodyRows = rows
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#faf9f7';
      const signIcon = row.loggedInToday
        ? `<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:#dcfce7;color:#16a34a;font-size:13px;font-weight:bold;text-align:center;">✓</span>`
        : `<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:#fee2e2;color:#c8102e;font-size:13px;font-weight:bold;text-align:center;">✕</span>`;
      const emailCell = row.email
        ? `<a href="mailto:${escapeHtml(row.email)}" style="color:#1a1a1a;text-decoration:none;font-size:13px;">${escapeHtml(row.email)}</a>`
        : `<span style="color:#888888;font-size:13px;">—</span>`;
      const lastLogin = formatLoginIST(row.lastSignedIn);

      return `<tr style="background:${bg};">
<td style="padding:10px 12px;border-bottom:1px solid #ececea;">${emailCell}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;font-size:13px;color:#1a1a1a;font-weight:600;">${escapeHtml(row.name)}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;text-align:center;font-size:14px;font-weight:700;color:#c8102e;">${row.openLeads}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;text-align:center;font-size:14px;font-weight:700;color:#1a1a1a;">${row.closedLeads}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;text-align:center;">${signIcon}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;font-size:12px;color:#888888;font-family:Consolas,Monaco,monospace;">${escapeHtml(lastLogin)}</td>
</tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececea;border-radius:4px;overflow:hidden;border-collapse:separate;">
<thead>
<tr style="background:#faf9f7;">
<th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:0.06em;">Sales Person Email</th>
<th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:0.06em;">Sales Person Name</th>
<th style="padding:10px 12px;text-align:center;font-size:10px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:0.06em;">Open Leads</th>
<th style="padding:10px 12px;text-align:center;font-size:10px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:0.06em;">Closed Leads</th>
<th style="padding:10px 12px;text-align:center;font-size:10px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:0.06em;">Signed In Today</th>
<th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:0.06em;">Last Signed In</th>
</tr>
</thead>
<tbody>${bodyRows}</tbody>
</table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Sample table for template preview when live data is unavailable. */
export function sampleLeadReportTableHtml(): string {
  return renderLeadReportTableHtml([
    {
      email: 'pankaj@example.com',
      name: 'Pankaj',
      openLeads: 0,
      closedLeads: 1,
      loggedInToday: false,
      lastSignedIn: '2026-07-02T01:43:58Z',
    },
    {
      email: 'vidya@example.com',
      name: 'Vidya',
      openLeads: 2,
      closedLeads: 3,
      loggedInToday: false,
      lastSignedIn: '2026-07-27T10:55:41Z',
    },
    {
      email: 'vikas@example.com',
      name: 'Vikas',
      openLeads: 1,
      closedLeads: 0,
      loggedInToday: false,
      lastSignedIn: '2026-07-22T10:14:47Z',
    },
  ]);
}

function cacheKey(appId: string, websiteFilter: string, userGroupFilter: string) {
  const w = websiteFilter.trim().toLowerCase() || 'all';
  const g = userGroupFilter.trim().toLowerCase() || 'all';
  return `${CACHE_PREFIX}${appId}_${w}_${g}`;
}

export function loadCachedLeadReport(
  appId: string,
  websiteFilter = '',
  userGroupFilter = '',
): LeadReport | null {
  try {
    const raw = localStorage.getItem(cacheKey(appId, websiteFilter, userGroupFilter));
    if (!raw) return null;
    return { ...(JSON.parse(raw) as LeadReport), source: 'cache' };
  } catch {
    return null;
  }
}

function saveLeadReportCache(report: LeadReport, websiteFilter: string, userGroupFilter: string) {
  localStorage.setItem(
    cacheKey(report.applicationId, websiteFilter, userGroupFilter),
    JSON.stringify(report),
  );
}

export async function buildLeadReport(
  app: KissflowApplication,
  options: {
    websiteFilter?: string;
    userGroupFilter?: string;
    processId?: string;
  } = {},
): Promise<LeadReport> {
  const websiteFilter = (options.websiteFilter || '').trim();
  const userGroupFilter = (options.userGroupFilter || '').trim();
  const processId = options.processId || app.processIds?.[0] || 'Lead_tracker_1_A00';
  const errors: string[] = [];

  const [{ items, error: itemsError }, { users: allUsersRaw, errors: userErrors }] = await Promise.all([
    fetchAllLeadItems(app, processId),
    fetchAllKissflowUsers(app),
  ]);

  if (itemsError) errors.push(itemsError);
  errors.push(...userErrors);

  const filteredLeads = items.filter((item) =>
    websiteMatches(extractWebsite(item), websiteFilter),
  );

  const userByEmail = new Map<string, KissflowUserRecord>();
  const userById = new Map<string, KissflowUserRecord>();
  const userByName = new Map<string, KissflowUserRecord>();
  for (const u of allUsersRaw) {
    if (u.email) userByEmail.set(u.email.toLowerCase(), u);
    if (u.userId) userById.set(u.userId, u);
    if (u.name) userByName.set(u.name.toLowerCase(), u);
  }

  type Agg = LeadReportRow;
  const aggMap = new Map<string, Agg>();

  const findUserForPerson = (person: { ids: string[]; emails: string[]; names: string[] }) => {
    for (const email of person.emails) {
      const u = userByEmail.get(email.toLowerCase());
      if (u) return u;
    }
    for (const id of person.ids) {
      const u = userById.get(id);
      if (u) return u;
    }
    for (const name of person.names) {
      const u = userByName.get(name.toLowerCase());
      if (u) return u;
    }
    return undefined;
  };

  const ensureRow = (
    person: { emails: string[]; names: string[]; ids: string[] },
    user?: KissflowUserRecord,
  ): Agg => {
    const email = user?.email || person.emails[0] || '';
    const name = user?.name || person.names[0] || email || person.ids[0] || 'Unknown';
    const key = (email || person.ids[0] || name).toLowerCase();
    if (!aggMap.has(key)) {
      aggMap.set(key, {
        email,
        name,
        openLeads: 0,
        closedLeads: 0,
        loggedInToday: user ? isLoggedInToday(user.lastLogin) : false,
        lastSignedIn: user?.lastLogin || null,
      });
    } else if (user) {
      const row = aggMap.get(key)!;
      row.loggedInToday = isLoggedInToday(user.lastLogin);
      row.lastSignedIn = user.lastLogin || row.lastSignedIn;
      if (!row.email && user.email) row.email = user.email;
      if (user.name && (row.name === 'Unknown' || !row.name)) row.name = user.name;
    }
    return aggMap.get(key)!;
  };

  for (const lead of filteredLeads) {
    const person = extractSalesPerson(lead);
    const status = extractLeadStatus(lead);
    const pKey = personRowKey(person);
    if (!pKey) continue;

    const user = findUserForPerson(person);
    const row = ensureRow(person, user);
    const bucket = normalizeLeadStatus(status);
    if (bucket === 'Open') row.openLeads += 1;
    else if (bucket === 'Closed') row.closedLeads += 1;
    else if (isLeadOpen(status)) row.openLeads += 1;
    else if (isLeadClosed(status)) row.closedLeads += 1;
  }

  const rows = Array.from(aggMap.values())
    .filter((r) => r.openLeads + r.closedLeads > 0)
    .sort((a, b) => b.openLeads + b.closedLeads - (a.openLeads + a.closedLeads) || a.name.localeCompare(b.name));

  await enrichRowsWithFreshLogin(app, rows, userByEmail, userByName, userById);

  let totalOpen = 0;
  let totalClosed = 0;
  for (const lead of filteredLeads) {
    const bucket = normalizeLeadStatus(extractLeadStatus(lead));
    if (bucket === 'Open') totalOpen += 1;
    else if (bucket === 'Closed') totalClosed += 1;
    else if (isLeadOpen(extractLeadStatus(lead))) totalOpen += 1;
    else if (isLeadClosed(extractLeadStatus(lead))) totalClosed += 1;
  }

  const report: LeadReport = {
    applicationId: app.id,
    websiteFilter: websiteFilter || null,
    userGroupFilter: userGroupFilter || null,
    generatedAt: new Date().toISOString(),
    rows,
    totals: {
      totalLeads: filteredLeads.length,
      openLeads: totalOpen,
      closedLeads: totalClosed,
      salesPersons: rows.length,
      signedInToday: rows.filter((r) => r.loggedInToday).length,
    },
    errors,
    source: 'live',
  };

  saveLeadReportCache(report, websiteFilter, userGroupFilter);
  return report;
}

export function leadReportToOverrides(report: LeadReport): Record<string, string> {
  const groupLabel = report.userGroupFilter || report.websiteFilter || 'All teams';
  return {
    GroupName: groupLabel,
    WebsiteName: report.websiteFilter || groupLabel,
    TotalLeads: String(report.totals.totalLeads),
    OpenLeads: String(report.totals.openLeads),
    ClosedLeads: String(report.totals.closedLeads),
    SalesPersons: String(report.totals.salesPersons),
    SignedInToday: String(report.totals.signedInToday),
    LeadTableHtml: renderLeadReportTableHtml(report.rows),
    ReportTitle: `${groupLabel} — Lead Tracker`,
    ReportBody: `Live data from Kissflow Lead Tracker (${groupLabel}): leads filtered by Website_and_form, grouped by assigned sales person.`,
  };
}
