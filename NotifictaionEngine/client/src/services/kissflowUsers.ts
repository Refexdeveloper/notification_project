import type { KissflowApplication } from '@/mocks/applications';
import { kissflowFetch, KISSFLOW_PAGE_SIZE, pickDateTime, pickString } from './kissflowClient';

/** Kissflow official user directory API (paginated). */
export const KISSFLOW_USER_LIST_BASE = (accountId: string) =>
  `/user/2/${encodeURIComponent(accountId)}`;

export function kissflowUserListPath(
  accountId: string,
  page = 1,
  pageSize = KISSFLOW_PAGE_SIZE,
): string {
  const qs = new URLSearchParams({
    page_number: String(page),
    page_size: String(pageSize),
  });
  return `${KISSFLOW_USER_LIST_BASE(accountId)}?${qs.toString()}`;
}

export function kissflowUserListFallbackPath(
  accountId: string,
  page = 1,
  pageSize = KISSFLOW_PAGE_SIZE,
): string {
  const qs = new URLSearchParams({
    page_number: String(page),
    page_size: String(pageSize),
  });
  return `${KISSFLOW_USER_LIST_BASE(accountId)}/list?${qs.toString()}`;
}

export interface KissflowUserRecord {
  userId: string;
  email: string;
  name: string;
  status: string;
  department: string;
  role: string;
  lastLogin: string | null;
  /** Kissflow group names from Groups / UserGroups on the user record */
  groups: string[];
  raw: Record<string, unknown>;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() && !Number.isNaN(Number(val))) return Number(val);
  }
  return null;
}

/** Parse Kissflow list payloads: array root or { Data, TotalCount }. */
export function parseKissflowListPayload(data: unknown): {
  items: unknown[];
  totalCount: number | null;
} {
  if (Array.isArray(data)) {
    return { items: data, totalCount: data.length };
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['Data', 'data', 'Users', 'users', 'Items', 'items', 'Result']) {
      if (Array.isArray(obj[key])) {
        return {
          items: obj[key] as unknown[],
          totalCount: pickNumber(obj, ['TotalCount', 'total_count', 'Total', 'Count']),
        };
      }
    }
  }
  return { items: [], totalCount: null };
}

export function normalizeKissflowUser(raw: unknown): KissflowUserRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const userId = pickString(obj, ['_id', 'Id', 'id', 'UserId']);
  const email = pickString(obj, ['Email', 'email', 'MailId', 'UserName', 'userName']);
  const name =
    pickString(obj, ['Name', 'DisplayName', 'FullName']) ||
    [pickString(obj, ['FirstName']), pickString(obj, ['LastName'])].filter(Boolean).join(' ') ||
    email ||
    userId;
  if (!userId && !email) return null;

  const rolesArr = Array.isArray(obj.Roles) ? obj.Roles : [];
  const roleFromArr =
    rolesArr
      .map((r) =>
        r && typeof r === 'object'
          ? pickString(r as Record<string, unknown>, ['Name', 'name'])
          : '',
      )
      .filter(Boolean)
      .join(', ') || '';

  const lastLogin =
    pickDateTime(obj, [
      'LastLoggedInAt',
      'LastLogin',
      'LastSignedIn',
      'LastActive',
      'LastLoginAt',
      'LastActivity',
      'last_login',
      'LastAccessedAt',
    ]) || null;

  return {
    userId: userId || email,
    email: email || '',
    name: name || email || userId,
    status: pickString(obj, ['Status', 'status']) || 'Active',
    department:
      pickString(obj, ['Department', 'Dept', 'department', 'Designation', 'Company']) || '',
    role:
      pickString(obj, ['UserType', '_user_type', 'Role', 'Kind', 'role']) || roleFromArr || '',
    lastLogin,
    groups: extractUserGroupNames(obj),
    raw: obj,
  };
}

/** Parse Groups / UserGroups from Kissflow user JSON. */
export function extractUserGroupNames(raw: Record<string, unknown>): string[] {
  const names: string[] = [];
  const push = (val: unknown) => {
    if (!val) return;
    if (typeof val === 'string' && val.trim()) {
      names.push(val.trim());
      return;
    }
    if (Array.isArray(val)) {
      val.forEach(push);
      return;
    }
    if (typeof val === 'object') {
      const o = val as Record<string, unknown>;
      const label = pickString(o, ['Name', 'name', 'Title', 'DisplayName', 'GroupName']);
      if (label) names.push(label);
      else if (typeof o._id === 'string' && o._id.trim()) names.push(o._id.trim());
    }
  };

  for (const key of ['Groups', 'groups', 'UserGroups', 'user_groups', 'Group', 'GroupList']) {
    if (key in raw) push(raw[key]);
  }

  const seen = new Set<string>();
  return names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** True if user belongs to a Kissflow group (exact or partial name match). */
export function userBelongsToGroup(user: KissflowUserRecord, groupName: string): boolean {
  const target = groupName.trim().toLowerCase();
  if (!target) return true;
  return user.groups.some((g) => {
    const gl = g.trim().toLowerCase();
    return gl === target || gl.includes(target) || target.includes(gl);
  });
}

async function fetchUserListPage(
  app: KissflowApplication,
  page: number,
  pageSize: number,
  workingPath?: string,
): Promise<{
  items: unknown[];
  totalCount: number | null;
  ok: boolean;
  path: string;
  error?: string;
}> {
  const account = app.accountId;
  const candidates = workingPath
    ? [
        workingPath.replace(/page_number=\d+/, `page_number=${page}`),
        kissflowUserListPath(account, page, pageSize),
        kissflowUserListFallbackPath(account, page, pageSize),
      ]
    : [
        kissflowUserListPath(account, page, pageSize),
        kissflowUserListFallbackPath(account, page, pageSize),
        `${KISSFLOW_USER_LIST_BASE(account)}/?page_number=${page}&page_size=${pageSize}&user_type=User&invited_user=false`,
      ];

  const tried = new Set<string>();
  for (const path of candidates) {
    if (tried.has(path)) continue;
    tried.add(path);
    const res = await kissflowFetch(app, path);
    if (!res.ok) continue;
    const parsed = parseKissflowListPayload(res.data);
    if (parsed.items.length > 0 || page > 1) {
      return { ...parsed, ok: true, path };
    }
    // Empty page 1 — try next candidate endpoint
    if (page === 1 && parsed.totalCount === 0) {
      return { ...parsed, ok: true, path };
    }
  }

  return {
    items: [],
    totalCount: null,
    ok: false,
    path: candidates[0],
    error: 'Kissflow user list API failed (check Access Key + Account ID)',
  };
}

/**
 * GET all users from Kissflow account directory.
 * Uses official paginated endpoint: GET /user/2/{account_id}?page_number=&page_size=
 */
export async function fetchAllKissflowUsers(
  app: KissflowApplication,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<{ users: KissflowUserRecord[]; totalCount: number | null; errors: string[] }> {
  const pageSize = options.pageSize ?? KISSFLOW_PAGE_SIZE;
  const maxPages = options.maxPages ?? 100;
  const errors: string[] = [];
  const allRaw: unknown[] = [];
  let page = 1;
  let workingPath = '';
  let reportedTotal: number | null = null;

  for (;;) {
    const result = await fetchUserListPage(app, page, pageSize, workingPath || undefined);
    if (!result.ok) {
      if (page === 1) {
        return { users: [], totalCount: null, errors: [result.error || 'User list failed'] };
      }
      errors.push(result.error || `Page ${page} failed`);
      break;
    }

    workingPath = result.path;
    if (result.totalCount != null) reportedTotal = result.totalCount;

    if (!result.items.length) break;
    allRaw.push(...result.items);

    if (result.items.length < pageSize) break;
    if (reportedTotal != null && allRaw.length >= reportedTotal) break;

    page += 1;
    if (page > maxPages) {
      errors.push(`User list truncated after ${maxPages} pages`);
      break;
    }
  }

  const seen = new Set<string>();
  const users = allRaw
    .map(normalizeKissflowUser)
    .filter(Boolean)
    .filter((u) => {
      const key = (u as KissflowUserRecord).userId || (u as KissflowUserRecord).email;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }) as KissflowUserRecord[];

  if (!users.length) {
    errors.push(
      errors.length
        ? 'No users returned'
        : `No users from Kissflow (${workingPath || kissflowUserListPath(app.accountId, 1, pageSize)})`,
    );
  }

  return { users, totalCount: reportedTotal ?? users.length, errors };
}

/** Fill missing Groups from user detail API (list endpoint often omits Groups). */
export async function enrichUsersWithGroups(
  app: KissflowApplication,
  users: KissflowUserRecord[],
  concurrency = 8,
): Promise<KissflowUserRecord[]> {
  const out = [...users];
  let cursor = 0;

  async function worker() {
    while (cursor < out.length) {
      const i = cursor++;
      if (out[i].groups.length) continue;
      const detail = await fetchKissflowUserDetail(app, out[i].userId);
      if (detail?.groups.length) {
        out[i] = { ...out[i], groups: detail.groups, raw: detail.raw };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, out.length)) }, () => worker()),
  );
  return out;
}

/** Fetch single user detail (LastLoggedInAt, roles, etc.). */
export async function fetchKissflowUserDetail(
  app: KissflowApplication,
  userId: string,
): Promise<KissflowUserRecord | null> {
  const path = `${KISSFLOW_USER_LIST_BASE(app.accountId)}/${encodeURIComponent(userId)}`;
  const res = await kissflowFetch(app, path);
  if (!res.ok) return null;
  return normalizeKissflowUser(res.data);
}
