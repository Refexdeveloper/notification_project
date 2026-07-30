import type { KissflowApplication } from '@/mocks/applications';
import {
  asArray,
  kissflowFetch,
  kissflowPageQuery,
  KISSFLOW_PAGE_SIZE,
  pickString,
  resolveProcessIdForAdmin,
} from './kissflowClient';
import {
  fetchAllKissflowUsers,
  fetchKissflowUserDetail,
  type KissflowUserRecord,
} from './kissflowUsers';

export { fetchAllKissflowUsers, fetchKissflowUserDetail } from './kissflowUsers';
export type { KissflowUserRecord } from './kissflowUsers';

export type ResourceType = 'PROCESS' | 'BOARD' | 'DATAFORM';

/** Normalized record — resource-agnostic analytics unit */
export interface NormalizedRecord {
  resourceType: ResourceType;
  resourceId: string;
  recordId: string;
  assignedUserIds: string[];
  assignedEmails: string[];
  assignedNames: string[];
  status: string;
  statusBucket: StatusBucket;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  applicationId: string;
}

export type StatusBucket =
  | 'open'
  | 'pending'
  | 'closed'
  | 'completed'
  | 'rejected'
  | 'other';

export interface AnalyticsUser {
  userId: string;
  email: string;
  name: string;
  status: string;
  department: string;
  role: string;
  lastLogin: string | null;
  loggedInToday: boolean;
  daysSinceLogin: number | null;
  /** Full Kissflow user object from list/detail API */
  kissflowRaw?: Record<string, unknown>;
}

export interface UserEngagementRow {
  userId: string;
  email: string;
  name: string;
  role: string;
  department: string;
  status: string;
  lastLogin: string | null;
  loggedInToday: boolean;
  daysSinceLogin: number | null;
  assigned: number;
  open: number;
  pending: number;
  closed: number;
  completed: number;
  rejected: number;
  other: number;
  kissflowRaw?: Record<string, unknown>;
  byResource: {
    resourceType: ResourceType;
    resourceId: string;
    assigned: number;
    open: number;
    pending: number;
    closed: number;
    completed: number;
    rejected: number;
  }[];
}

export interface EngagementReport {
  applicationId: string;
  generatedAt: string;
  users: UserEngagementRow[];
  totals: {
    totalUsers: number;
    activeToday: number;
    inactive: number;
    neverLoggedIn: number;
    totalAssigned: number;
  };
  errors: string[];
  source: 'live' | 'cache';
}

const CACHE_PREFIX = 'ne_engagement_';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isLoggedInToday(lastLogin: string | null): boolean {
  const d = parseDate(lastLogin);
  if (!d) return false;
  return d >= startOfToday();
}

function daysSince(lastLogin: string | null): number | null {
  const d = parseDate(lastLogin);
  if (!d) return null;
  const ms = startOfToday().getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

export function bucketStatus(raw: string): StatusBucket {
  const s = raw.toLowerCase().trim();
  if (!s) return 'other';
  if (/(reject|declin|cancel|void)/.test(s)) return 'rejected';
  if (/(complete|done|approved|resolved|finish|signed)/.test(s)) return 'completed';
  if (/(closed|close)/.test(s)) return 'closed';
  if (/(pending|await|approval|review|in[\s_-]?progress|progress|submitted)/.test(s)) return 'pending';
  if (/(open|new|draft|todo|to[\s_-]?do|active|backlog)/.test(s)) return 'open';
  return 'other';
}

function extractAssignees(obj: Record<string, unknown>): {
  ids: string[];
  emails: string[];
  names: string[];
} {
  const ids: string[] = [];
  const emails: string[] = [];
  const names: string[] = [];

  const pushPerson = (val: unknown) => {
    if (!val) return;
    if (typeof val === 'string') {
      if (val.includes('@')) emails.push(val.toLowerCase());
      else if (val) {
        ids.push(val);
        names.push(val);
      }
      return;
    }
    if (Array.isArray(val)) {
      val.forEach(pushPerson);
      return;
    }
    if (typeof val === 'object') {
      const o = val as Record<string, unknown>;
      const id = pickString(o, ['_id', 'Id', 'id', 'UserId']);
      const email = pickString(o, ['Email', 'email', 'MailId', 'UserName']);
      const name = pickString(o, ['Name', 'DisplayName', 'FullName', 'FirstName']);
      if (id) ids.push(id);
      if (email) emails.push(email.toLowerCase());
      if (name) names.push(name);
    }
  };

  for (const key of [
    'AssignedTo',
    'Assignee',
    'Assignees',
    'assigned_to',
    'assignee',
    'Owner',
    'CurrentAssignee',
    'Responsible',
    '_assigned_to',
    'SalesPerson',
    'Sales Person',
  ]) {
    if (key in obj) pushPerson(obj[key]);
  }

  return { ids, emails, names };
}

function normalizeRecord(
  raw: unknown,
  meta: { resourceType: ResourceType; resourceId: string; applicationId: string },
): NormalizedRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const recordId = pickString(obj, ['_id', 'Id', 'id', 'ItemId', 'RecordId']);
  if (!recordId) return null;

  const status = pickString(obj, ['Status', 'status', '_status', 'Stage', 'State', 'ActivityName']) || 'Unknown';
  const assignees = extractAssignees(obj);
  const createdBy = pickString(obj, ['CreatedBy', 'created_by', '_created_by', 'Requester']);
  const createdAt = pickString(obj, ['CreatedAt', 'created_at', '_created_at', 'CreatedDate']) || null;
  const updatedAt = pickString(obj, ['ModifiedAt', 'updated_at', '_modified_at', 'LastModified']) || null;

  return {
    resourceType: meta.resourceType,
    resourceId: meta.resourceId,
    recordId,
    assignedUserIds: assignees.ids,
    assignedEmails: assignees.emails,
    assignedNames: assignees.names,
    status,
    statusBucket: bucketStatus(status),
    createdBy,
    createdAt,
    updatedAt,
    applicationId: meta.applicationId,
  };
}

function kissflowUserToAnalytics(user: KissflowUserRecord): AnalyticsUser {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    status: user.status,
    department: user.department,
    role: user.role,
    lastLogin: user.lastLogin,
    loggedInToday: isLoggedInToday(user.lastLogin),
    daysSinceLogin: daysSince(user.lastLogin),
    kissflowRaw: user.raw,
  };
}

async function enrichUserDetails(
  app: KissflowApplication,
  users: AnalyticsUser[],
  concurrency = 6,
): Promise<{ users: AnalyticsUser[]; errors: string[] }> {
  const errors: string[] = [];
  const enriched = [...users];
  let cursor = 0;

  async function worker() {
    while (cursor < enriched.length) {
      const i = cursor++;
      const u = enriched[i];
      if (!u.userId) continue;
      if (u.lastLogin) continue;
      const detail = await fetchKissflowUserDetail(app, u.userId);
      if (!detail) {
        errors.push(`User detail ${u.userId}: not found`);
        continue;
      }
      enriched[i] = {
        ...u,
        ...kissflowUserToAnalytics(detail),
        userId: u.userId,
        email: detail.email || u.email,
        name: detail.name || u.name,
        kissflowRaw: detail.raw,
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, enriched.length)) }, () => worker()),
  );
  return { users: enriched, errors };
}

async function fetchUsers(app: KissflowApplication): Promise<{ users: AnalyticsUser[]; errors: string[] }> {
  const { users: kissflowUsers, errors } = await fetchAllKissflowUsers(app);
  let users = kissflowUsers.map(kissflowUserToAnalytics);

  const needDetails = users.some((u) => !u.lastLogin);
  if (needDetails && users.length) {
    const enriched = await enrichUserDetails(app, users);
    users = enriched.users;
    if (enriched.errors.length) errors.push(...enriched.errors.slice(0, 5));
  }

  return { users, errors };
}

async function fetchResourceRecords(
  app: KissflowApplication,
  resourceType: ResourceType,
  resourceId: string,
): Promise<{ records: NormalizedRecord[]; error?: string }> {
  const account = encodeURIComponent(app.accountId);
  const rid = encodeURIComponent(resourceId);
  const adminRid = encodeURIComponent(
    (app.appId || '').trim() || resolveProcessIdForAdmin(resourceId),
  );

  // Prefer non-admin endpoints first — Admin APIs return 403 for standard Access Keys
  const pageQ = kissflowPageQuery(1, KISSFLOW_PAGE_SIZE);
  const paths: string[] =
    resourceType === 'PROCESS'
      ? [
          `/process/2/${account}/${rid}/myitems?${pageQ}`,
          `/process/2/${account}/${rid}/mytasks?${pageQ}`,
          `/process/2/${account}/admin/${adminRid}/item?${pageQ}&apply_preference=1`,
        ]
      : resourceType === 'BOARD'
        ? [
            `/board/2/${account}/${rid}/item?${pageQ}`,
            `/board/2/${account}/${rid}?${pageQ}`,
          ]
        : [
            `/form/2/${account}/${rid}?${pageQ}`,
            `/form/2/${account}/${rid}/item?${pageQ}`,
          ];

  const failures: string[] = [];
  for (const path of paths) {
    const res = await kissflowFetch(app, path);
    if (!res.ok) {
      if (res.status === 403 && path.includes('/admin/')) {
        failures.push('Admin API forbidden (403) — Access Key is not an admin key');
      } else {
        failures.push(`${path}: ${res.error || res.status}`);
      }
      continue;
    }
    const records = asArray(res.data)
      .map((row) =>
        normalizeRecord(row, {
          resourceType,
          resourceId,
          applicationId: app.id,
        }),
      )
      .filter(Boolean) as NormalizedRecord[];
    return { records };
  }

  return {
    records: [],
    error:
      failures.find((f) => f.includes('403')) ||
      `${resourceType} ${resourceId}: no accessible records`,
  };
}

function matchUser(user: AnalyticsUser, record: NormalizedRecord): boolean {
  if (user.userId && record.assignedUserIds.includes(user.userId)) return true;
  if (user.email && record.assignedEmails.includes(user.email.toLowerCase())) return true;
  if (user.name && record.assignedNames.some((n) => n.toLowerCase() === user.name.toLowerCase())) {
    return true;
  }
  return false;
}

function aggregate(
  app: KissflowApplication,
  users: AnalyticsUser[],
  records: NormalizedRecord[],
  errors: string[],
  source: 'live' | 'cache',
): EngagementReport {
  const rows: UserEngagementRow[] = users.map((user) => {
    const mine = records.filter((r) => matchUser(user, r));
    const count = (bucket: StatusBucket) => mine.filter((r) => r.statusBucket === bucket).length;

    const resourceMap = new Map<string, UserEngagementRow['byResource'][number]>();
    for (const r of mine) {
      const key = `${r.resourceType}:${r.resourceId}`;
      if (!resourceMap.has(key)) {
        resourceMap.set(key, {
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          assigned: 0,
          open: 0,
          pending: 0,
          closed: 0,
          completed: 0,
          rejected: 0,
        });
      }
      const entry = resourceMap.get(key)!;
      entry.assigned += 1;
      if (r.statusBucket === 'open') entry.open += 1;
      if (r.statusBucket === 'pending') entry.pending += 1;
      if (r.statusBucket === 'closed') entry.closed += 1;
      if (r.statusBucket === 'completed') entry.completed += 1;
      if (r.statusBucket === 'rejected') entry.rejected += 1;
    }

    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      status: user.status,
      lastLogin: user.lastLogin,
      loggedInToday: user.loggedInToday,
      daysSinceLogin: user.daysSinceLogin,
      kissflowRaw: user.kissflowRaw,
      assigned: mine.length,
      open: count('open'),
      pending: count('pending'),
      closed: count('closed'),
      completed: count('completed'),
      rejected: count('rejected'),
      other: count('other'),
      byResource: Array.from(resourceMap.values()),
    };
  });

  // Include assignees that aren't in the user directory
  const knownKeys = new Set(
    rows.flatMap((r) => [r.userId, r.email.toLowerCase(), r.name.toLowerCase()].filter(Boolean)),
  );
  for (const record of records) {
    const keys = [
      ...record.assignedUserIds,
      ...record.assignedEmails,
      ...record.assignedNames.map((n) => n.toLowerCase()),
    ];
    if (keys.some((k) => knownKeys.has(k))) continue;
    const label = record.assignedEmails[0] || record.assignedNames[0] || record.assignedUserIds[0];
    if (!label) continue;
    knownKeys.add(label.toLowerCase());
    const orphanRecords = records.filter((r) => matchUser(
      {
        userId: record.assignedUserIds[0] || label,
        email: record.assignedEmails[0] || '',
        name: record.assignedNames[0] || label,
        status: 'Active',
        department: '',
        role: '',
        lastLogin: null,
        loggedInToday: false,
        daysSinceLogin: null,
      },
      r,
    ));
    rows.push({
      userId: record.assignedUserIds[0] || label,
      email: record.assignedEmails[0] || '',
      name: record.assignedNames[0] || label,
      role: '',
      department: '',
      status: 'Active',
      lastLogin: null,
      loggedInToday: false,
      daysSinceLogin: null,
      kissflowRaw: undefined,
      assigned: orphanRecords.length,
      open: orphanRecords.filter((r) => r.statusBucket === 'open').length,
      pending: orphanRecords.filter((r) => r.statusBucket === 'pending').length,
      closed: orphanRecords.filter((r) => r.statusBucket === 'closed').length,
      completed: orphanRecords.filter((r) => r.statusBucket === 'completed').length,
      rejected: orphanRecords.filter((r) => r.statusBucket === 'rejected').length,
      other: orphanRecords.filter((r) => r.statusBucket === 'other').length,
      byResource: [],
    });
  }

  rows.sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));

  return {
    applicationId: app.id,
    generatedAt: new Date().toISOString(),
    users: rows,
    totals: {
      totalUsers: rows.length,
      activeToday: rows.filter((r) => r.loggedInToday).length,
      inactive: rows.filter((r) => !r.loggedInToday && r.lastLogin).length,
      neverLoggedIn: rows.filter((r) => !r.lastLogin).length,
      totalAssigned: rows.reduce((n, r) => n + r.assigned, 0),
    },
    errors,
    source,
  };
}

function cacheKey(appId: string) {
  return `${CACHE_PREFIX}${appId}`;
}

export function loadCachedEngagement(appId: string): EngagementReport | null {
  try {
    const raw = localStorage.getItem(cacheKey(appId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EngagementReport;
    return { ...parsed, source: 'cache' };
  } catch {
    return null;
  }
}

function saveCache(report: EngagementReport) {
  localStorage.setItem(cacheKey(report.applicationId), JSON.stringify(report));
}

/** Pull users + records from configured resources and aggregate engagement. */
export async function buildEngagementReport(app: KissflowApplication): Promise<EngagementReport> {
  const errors: string[] = [];
  const { users, errors: userErrors } = await fetchUsers(app);
  errors.push(...userErrors);

  const records: NormalizedRecord[] = [];

  for (const id of app.processIds || []) {
    const { records: rows, error } = await fetchResourceRecords(app, 'PROCESS', id);
    records.push(...rows);
    if (error) errors.push(error);
  }
  for (const id of app.boardIds || []) {
    const { records: rows, error } = await fetchResourceRecords(app, 'BOARD', id);
    records.push(...rows);
    if (error) errors.push(error);
  }
  for (const id of app.dataformIds || []) {
    const { records: rows, error } = await fetchResourceRecords(app, 'DATAFORM', id);
    records.push(...rows);
    if (error) errors.push(error);
  }

  // If user directory is empty but we have assignees on records, seed users from assignees
  let finalUsers = users;
  if (!finalUsers.length && records.length) {
    const map = new Map<string, AnalyticsUser>();
    for (const r of records) {
      const email = r.assignedEmails[0] || '';
      const name = r.assignedNames[0] || email || r.assignedUserIds[0];
      const userId = r.assignedUserIds[0] || email || name;
      if (!userId || map.has(userId)) continue;
      map.set(userId, {
        userId,
        email,
        name: name || userId,
        status: 'Active',
        department: '',
        role: '',
        lastLogin: null,
        loggedInToday: false,
        daysSinceLogin: null,
      });
    }
    finalUsers = Array.from(map.values());
    if (!finalUsers.length) {
      errors.push('No users or assigned records found. Verify IDs and API access.');
    }
  }

  const report = aggregate(app, finalUsers, records, errors, 'live');
  saveCache(report);
  return report;
}

export function formatLogin(value: string | null): string {
  if (!value) return 'Never';
  const d = parseDate(value);
  if (!d) return value;
  return d.toUTCString();
}
