import type { AppDashboardUser } from '@/services/appDashboardApi';
import type { AppRecordRow } from '@/services/appRecordsApi';
import {
  compactMisName,
  isDisplayablePersonName,
  isPlaceholderPersonName,
  looksLikeKissflowUserId,
  normalizeItsmPersonLabel,
} from '@/lib/personName';
import {
  buildEntityBucketOptions,
  buildRefexCompanyOptions,
  sortCompanyFilterOptions,
  companyIdFromLabel,
  recordMatchesCompany,
  recordMatchesEntityBucket,
  REFEX_DEFAULT_COMPANY_NAME,
  resolveCompanyIdFromText,
  resolveEntityBucket,
} from '@/lib/refexCompanies';

export type RecordFilterOpts = {
  /** Entity bucket: all | refex | extrovis | venwind */
  entity?: string;
  /** Catalog company id from the 29-company list */
  company?: string;
  status?: string;
  assigned?: string;
  /** Kissflow user id / email when the dropdown option is not a display name */
  assignedId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** IST calendar-day slice for Opened today / Closed today KPI clicks. */
  todayKind?: 'opened' | 'closed';
  itsmCompanyMode?: boolean;
  travelMode?: boolean;
  /** Match created_at OR closed_at inside the date window (Today = activity). */
  activityDates?: boolean;
};

export type RecordKpiFocus = 'total' | 'open' | 'closed' | 'rejected' | 'opened_today' | 'closed_today';

export function isRecordKpiFocus(focus: string | null | undefined): focus is RecordKpiFocus {
  return focus === 'total'
    || focus === 'open'
    || focus === 'closed'
    || focus === 'rejected'
    || focus === 'opened_today'
    || focus === 'closed_today';
}

function isBucketOnlyCompany(value: unknown): boolean {
  return /^(refex|extrovis|venwind)$/i.test(String(value || '').trim());
}

export function recordMatchesAssigned(
  row: AppRecordRow,
  assigned?: string,
  assignedId?: string,
  opts: { matchRequester?: boolean } = {},
): boolean {
  const name = normalizeItsmPersonLabel(String(assigned || '').trim());
  const id = String(assignedId || '').trim();
  if (!name && !id) return true;

  const matchRequester = opts.matchRequester !== false;
  const who = normalizeItsmPersonLabel(String(row.assigned_to || '').trim());
  const requester = normalizeItsmPersonLabel(String(row.requested_by || '').trim());
  const rowId = String(row.assignee_id || '').trim().toLowerCase();
  const email = String(row.assignee_email || '').trim().toLowerCase();
  const compactWho = compactMisName(who);
  const compactRequester = compactMisName(requester);
  const compactName = compactMisName(name);
  const idl = id.toLowerCase();
  const namel = name.toLowerCase();

  if (idl) {
    if (rowId && rowId === idl) return true;
    if (email && (email === idl || email.startsWith(`${idl}@`))) return true;
    if (who.toLowerCase() === idl) return true;
    if (matchRequester && requester.toLowerCase() === idl) return true;
  }
  if (compactName.length >= 3) {
    if (compactWho.length >= 3 && compactWho === compactName) return true;
    if (matchRequester && compactRequester.length >= 3 && compactRequester === compactName) return true;
  }
  if (namel && who && who.toLowerCase().includes(namel)) return true;
  if (matchRequester && namel && requester && requester.toLowerCase().includes(namel)) return true;
  return false;
}

function isDraftRow(row: AppRecordRow): boolean {
  const hay = `${row.status_raw || ''} ${row.current_step || ''} ${row.status || ''} ${row.process_status || ''}`.toLowerCase();
  return hay.includes('draft');
}

function toIstYmd(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value).slice(0, 10);
  }
}

function recordClosedAt(row: AppRecordRow): string | null | undefined {
  return (
    (row.closed_at as string | null | undefined)
    || (row.completed_at as string | null | undefined)
    || (row.modified_at as string | null | undefined)
    || null
  );
}

export function recordEntityKey(row: AppRecordRow, itsmCompanyMode: boolean): string {
  // ITSM: process entity_key is authoritative (Refex vs Extrovis apps).
  // Do not prefer assignee legal-company / company_key — those are Company filter only.
  const bucket = resolveEntityBucket(
    itsmCompanyMode
      ? row.entity_key || row.entity || row.assignee_company_key
      : row.entity_key || row.entity || row.company,
  );
  if (bucket) return bucket;
  const ek = String(row.entity_key || row.entity || '').toLowerCase();
  if (ek.includes('extrovis')) return 'extrovis';
  if (ek.includes('venwind')) return 'venwind';
  return 'refex';
}

export function recordCompanyKey(row: AppRecordRow, itsmCompanyMode: boolean): string | null {
  const fromCompany = itsmCompanyMode
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
  if (fromCompany) return fromCompany;
  if (itsmCompanyMode) {
    const text = String(row.company_name || row.company || '').trim();
    if (!text || isBucketOnlyCompany(text)) {
      return companyIdFromLabel(REFEX_DEFAULT_COMPANY_NAME);
    }
    return null;
  }
  return (
    resolveCompanyIdFromText(row.entity)
    || resolveCompanyIdFromText(row.entity_key)
    || resolveCompanyIdFromText(row.assignee_company_key)
  );
}

export function filterAppRecords(
  items: AppRecordRow[],
  opts: RecordFilterOpts = {},
): AppRecordRow[] {
  const statusFilter = String(opts.status || 'all').toLowerCase();
  const entityFilter = String(opts.entity || 'all').trim().toLowerCase();
  const companyFilter = String(opts.company || 'all').trim().toLowerCase();
  const assignedFilter = String(opts.assigned || '').trim();
  const assignedId = String(opts.assignedId || '').trim();
  const from = String(opts.dateFrom || '').slice(0, 10);
  const to = String(opts.dateTo || '').slice(0, 10);
  const todayKind = opts.todayKind;
  const todayYmd = todayKind ? toIstYmd(new Date().toISOString()) : '';
  const itsmCompanyMode = Boolean(opts.itsmCompanyMode);
  const activityDates = Boolean(opts.activityDates);

  return (items || []).filter((row) => {
    if (isDraftRow(row)) return false;
    const id = String(row.request_id || row.id || '').trim();
    if (!id || id === '—') return false;

    if (statusFilter !== 'all' && String(row.status || '').toLowerCase() !== statusFilter) return false;

    if (!recordMatchesEntityBucket(row, entityFilter, itsmCompanyMode)) return false;
    if (companyFilter.startsWith('raw:')) {
      const want = companyFilter.slice(4);
      const compact = compactMisName(String(row.company_name || row.assignee_company || row.company || ''));
      if (!want || (compact !== want && !compact.includes(want) && !want.includes(compact))) return false;
    } else if (!recordMatchesCompany(row, companyFilter, itsmCompanyMode)) {
      return false;
    }

    if ((assignedFilter || assignedId) && !recordMatchesAssigned(row, assignedFilter, assignedId, {
      matchRequester: !itsmCompanyMode,
    })) {
      return false;
    }

    if (from || to) {
      const createdYmd = toIstYmd(row.created_at);
      const closedYmd = activityDates ? toIstYmd(recordClosedAt(row)) : '';
      const ymds = [createdYmd, closedYmd].filter(Boolean);
      if (!ymds.length) return false;
      const inWindow = ymds.some((ymd) => (!from || ymd >= from) && (!to || ymd <= to));
      if (!inWindow) return false;
    }

    if (todayKind === 'opened') {
      if (toIstYmd(row.created_at) !== todayYmd) return false;
    }
    if (todayKind === 'closed') {
      const closedYmd = toIstYmd(recordClosedAt(row));
      if (closedYmd) {
        if (closedYmd !== todayYmd) return false;
      } else if (String(row.status || '').toLowerCase() !== 'closed' || toIstYmd(row.created_at) !== todayYmd) {
        return false;
      }
    }

    return true;
  });
}

export function summarizeAppRecords(items: AppRecordRow[]) {
  let open = 0;
  let closed = 0;
  let rejected = 0;
  for (const r of items) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'closed') closed += 1;
    else if (s === 'rejected') rejected += 1;
    else open += 1;
  }
  return { open, closed, rejected, total: open + closed + rejected };
}

/** Today's created / closed counts (IST calendar day). Closed prefers closed_at / completed_at. */
export function countTodayActivity(items: AppRecordRow[], todayYmd: string) {
  let opened = 0;
  let closed = 0;
  for (const r of items || []) {
    if (toIstYmd(r.created_at) === todayYmd) opened += 1;
    const closedYmd = toIstYmd(recordClosedAt(r));
    if (closedYmd) {
      if (closedYmd === todayYmd) closed += 1;
    } else if (String(r.status || '').toLowerCase() === 'closed' && toIstYmd(r.created_at) === todayYmd) {
      closed += 1;
    }
  }
  return { opened, closed };
}

function isPmTaskProcess(processId: string): boolean {
  return /project_sub_task/i.test(processId);
}

function isPmSubtaskProcess(processId: string): boolean {
  return /sub_task_process/i.test(processId) && !/project_sub_task/i.test(processId);
}

function pmRecordBucket(row: AppRecordRow): 'open' | 'closed' | 'rejected' {
  const s = String(row.status || '').toLowerCase();
  if (s === 'closed' || s === 'completed' || s === 'done' || s === 'complete') return 'closed';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'withdrawn') return 'rejected';
  return 'open';
}

function pmRecordProjectKey(row: AppRecordRow): string {
  return String(row.project_id || row.project_key || '').trim();
}

/**
 * Client-side PM portfolio KPIs — same split as email count-pm-portfolio-kpis.js
 * and backend pmPortfolio.js. Uses Entity/Company/User/Period-scoped records.
 */
export function countPmPortfolio(items: AppRecordRow[]) {
  const out = {
    projects_total: 0,
    projects_open: 0,
    projects_closed: 0,
    tasks_total: 0,
    tasks_open: 0,
    tasks_closed: 0,
    linked_tasks: 0,
    individual_total: 0,
    individual_open: 0,
    individual_closed: 0,
    subtasks_total: 0,
    subtasks_open: 0,
    subtasks_closed: 0,
  };
  const projectMap = new Map<string, { hasOpen: boolean; hasClosed: boolean }>();

  for (const row of items || []) {
    const pid = String(row.process_id || '');
    const bucket = pmRecordBucket(row);
    if (isPmTaskProcess(pid)) {
      out.tasks_total += 1;
      if (bucket === 'open') out.tasks_open += 1;
      else if (bucket === 'closed') out.tasks_closed += 1;
      const key = pmRecordProjectKey(row);
      if (key) {
        out.linked_tasks += 1;
        const entry = projectMap.get(key) || { hasOpen: false, hasClosed: false };
        if (bucket === 'open') entry.hasOpen = true;
        if (bucket === 'closed') entry.hasClosed = true;
        projectMap.set(key, entry);
      } else {
        out.individual_total += 1;
        if (bucket === 'open') out.individual_open += 1;
        else if (bucket === 'closed') out.individual_closed += 1;
      }
    } else if (isPmSubtaskProcess(pid)) {
      out.subtasks_total += 1;
      if (bucket === 'open') out.subtasks_open += 1;
      else if (bucket === 'closed') out.subtasks_closed += 1;
    }
  }

  out.projects_total = projectMap.size;
  for (const entry of projectMap.values()) {
    if (entry.hasOpen) out.projects_open += 1;
    else if (entry.hasClosed) out.projects_closed += 1;
  }
  return out;
}

export function entityCountsFromRecords(
  items: AppRecordRow[],
  {
    itsmCompanyMode = false,
    travelMode = false,
  }: { itsmCompanyMode?: boolean; travelMode?: boolean } = {},
): Array<{ id: string; label: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const row of items) {
    const key = recordEntityKey(row, itsmCompanyMode);
    counts[key] = (counts[key] || 0) + 1;
  }
  const mode = travelMode ? 'refex_venwind' : itsmCompanyMode ? 'refex_extrovis' : 'all_buckets';
  return buildEntityBucketOptions(counts, { mode, includeAll: false })
    .filter((e) => (e.count || 0) > 0)
    .map((e) => ({ id: e.id, label: e.label, count: Number(e.count || 0) }));
}

export function companyCountsFromRecords(
  items: AppRecordRow[],
  {
    itsmCompanyMode = false,
    entity = 'all',
  }: { itsmCompanyMode?: boolean; entity?: string } = {},
): Array<{ id: string; label: string; count: number }> {
  const counts: Record<string, number> = {};
  const extraLabels: Record<string, string> = {};
  for (const row of items) {
    let key = recordCompanyKey(row, itsmCompanyMode);
    if (!key) {
      const label = String(row.company_name || row.assignee_company || row.company || '').trim();
      if (!label || isPlaceholderPersonName(label) || isBucketOnlyCompany(label)) continue;
      if (label.length < 4 || /^(yes|no|true|false|n\/a)$/i.test(label)) continue;
      key = `raw:${compactMisName(label) || label.toLowerCase()}`;
      extraLabels[key] = label;
    }
    counts[key] = (counts[key] || 0) + 1;
  }
  const catalog = buildRefexCompanyOptions(counts, { includeAll: false, entity })
    .filter((e) => (e.count || 0) > 0)
    .map((e) => ({ id: e.id, label: e.label, count: Number(e.count || 0) }));
  const extras = Object.entries(extraLabels)
    .filter(([id]) => (counts[id] || 0) > 0)
    .map(([id, label]) => ({ id, label, count: counts[id] }));
  return sortCompanyFilterOptions([...catalog, ...extras]);
}

function profileLookupKeys(user: AppDashboardUser): string[] {
  const keys: string[] = [];
  if (user.user_id) {
    keys.push(String(user.user_id).toLowerCase());
    keys.push(`id:${String(user.user_id).toLowerCase()}`);
  }
  if (user.email) {
    keys.push(String(user.email).toLowerCase());
    keys.push(`email:${String(user.email).toLowerCase()}`);
  }
  const compact = compactMisName(user.user_name);
  if (compact.length >= 3) {
    keys.push(`name:${compact}`);
    keys.push(compact);
  }
  if (user.user_name) keys.push(String(user.user_name).toLowerCase());
  return keys;
}

function buildProfileLookup(roster: AppDashboardUser[]): Map<string, AppDashboardUser> {
  const profileByKey = new Map<string, AppDashboardUser>();
  for (const u of roster) {
    for (const key of profileLookupKeys(u)) {
      if (!profileByKey.has(key)) profileByKey.set(key, u);
    }
  }
  return profileByKey;
}

function resolveProfileForRecord(
  record: AppRecordRow,
  profileByKey: Map<string, AppDashboardUser>,
): AppDashboardUser {
  const name = normalizeItsmPersonLabel(String(record.assigned_to || '').trim());
  const email = String(record.assignee_email || '').trim().toLowerCase();
  const id = String(record.assignee_id || '').trim();
  const candidates = [
    id,
    id ? `id:${id.toLowerCase()}` : '',
    email,
    email ? `email:${email}` : '',
    name.toLowerCase(),
    compactMisName(name),
    compactMisName(name) ? `name:${compactMisName(name)}` : '',
  ].filter(Boolean);
  for (const key of candidates) {
    const hit = profileByKey.get(key);
    if (hit) return hit;
  }
  return {} as AppDashboardUser;
}

/** Overlay legal company from the user roster when the process row only has Refex/Extrovis/Venwind. */
export function stampRecordsWithAssigneeCompany(
  records: AppRecordRow[],
  roster: AppDashboardUser[],
  { itsmCompanyMode = false }: { itsmCompanyMode?: boolean } = {},
): AppRecordRow[] {
  if (itsmCompanyMode) {
    return (records || []).map(applyItsmLegalCompany);
  }
  if (!records?.length || !roster?.length) return records || [];
  const profileByKey = buildProfileLookup(roster);
  return records.map((row) => {
    const existing = String(row.company_name || row.assignee_company || row.company || '').trim();
    const resolved = resolveCompanyIdFromText(existing);
    if (existing && !isBucketOnlyCompany(existing) && resolved) return row;
    const profile = resolveProfileForRecord(row, profileByKey);
    const company = String(profile.company || '').trim();
    if (!company) return row;
    return {
      ...row,
      company_name: company,
      assignee_company: company,
      company,
      company_key: profile.company_key || resolveCompanyIdFromText(company) || row.company_key,
      // Never replace Entity bucket (refex/extrovis/venwind) with a legal company id.
    };
  });
}

function applyItsmLegalCompany(row: AppRecordRow): AppRecordRow {
  const existing = String(row.company_name || row.company || '').trim();
  const resolved = resolveCompanyIdFromText(existing);
  if (existing && !isBucketOnlyCompany(existing) && resolved) {
    return {
      ...row,
      company_name: existing,
      company: existing,
      company_key: resolved,
    };
  }
  const label = REFEX_DEFAULT_COMPANY_NAME;
  return {
    ...row,
    company_name: label,
    company: label,
    company_key: companyIdFromLabel(label),
  };
}

/** Copy last_sign_in from Kissflow roster onto MIS rows that only have ticket counts. */
export function overlayRosterSignIn(
  users: AppDashboardUser[],
  roster: AppDashboardUser[],
): AppDashboardUser[] {
  if (!users?.length || !roster?.length) return users || [];
  const profileByKey = buildProfileLookup(roster);
  return users.map((u) => {
    if (u.last_sign_in) return u;
    const fakeRow: AppRecordRow = {
      id: String(u.user_id || u.user_name || ''),
      assigned_to: u.user_name,
      assignee_id: u.user_id,
      assignee_email: u.email,
    };
    const profile = resolveProfileForRecord(fakeRow, profileByKey);
    if (!profile.last_sign_in) return u;
    return {
      ...u,
      last_sign_in: profile.last_sign_in,
      ever_logged_in: true,
      is_active: profile.is_active ?? u.is_active,
      active_status: profile.active_status ?? u.active_status,
    };
  });
}

export function isUsableUserFilterLabel(name: string | null | undefined, userId?: string | null): boolean {
  return isDisplayablePersonName(name, userId) && !isPlaceholderPersonName(name);
}

/** Keep the selected dropdown value in the list so native <select> does not snap back to All. */
export function ensureFilterOption(
  options: Array<{ id: string; label: string }>,
  selectedId?: string | null,
  selectedLabel?: string | null,
): Array<{ id: string; label: string }> {
  const id = String(selectedId || '').trim();
  if (!id || options.some((o) => o.id === id)) return options;
  const label = String(selectedLabel || id).trim() || id;
  return [...options, { id, label }];
}

export function filterOptionMatches(
  option: { id: string; label: string },
  selectedId?: string | null,
): boolean {
  const sel = String(selectedId || '').trim();
  if (!sel || sel === 'all') return true;
  if (option.id === sel || option.label === sel) return true;
  const compactSel = compactMisName(sel);
  const compactLabel = compactMisName(option.label);
  return Boolean(compactSel) && compactSel === compactLabel;
}

/** MIS / records Assigned-to cell. ITSM = workflow Assigned To only (never closer/requester). */
export function assignedRecordLabel(row: AppRecordRow, opts: { itsmCompanyMode?: boolean } = {}): string {
  const assigned = normalizeItsmPersonLabel(String(row.assigned_to || '').trim());
  if (opts.itsmCompanyMode) {
    if (!assigned || isPlaceholderPersonName(assigned) || looksLikeKissflowUserId(assigned)) return '—';
    return assigned;
  }
  const candidates = [assigned, row.closed_by, row.requested_by];
  for (const raw of candidates) {
    const name = normalizeItsmPersonLabel(String(raw || '').trim());
    if (isDisplayablePersonName(name, String(row.assignee_id || ''))) return name;
  }
  return '—';
}

export function buildMisUsersFromRecords(
  records: AppRecordRow[],
  roster: AppDashboardUser[],
  opts: { ownerMode?: 'assignee' | 'assignee_or_requester' } = {},
): AppDashboardUser[] {
  const ownerMode = opts.ownerMode || 'assignee';
  const profileByKey = buildProfileLookup(roster);
  const byKey = new Map<string, {
    user_id: string;
    user_name: string;
    email: string;
    open: number;
    closed: number;
    rejected: number;
    total: number;
    company?: string;
    company_key?: string;
    profile: AppDashboardUser;
  }>();

  for (const r of records || []) {
    const profile = resolveProfileForRecord(r, profileByKey);
    const assignedName = normalizeItsmPersonLabel(String(r.assigned_to || '').trim());
    const requesterName = normalizeItsmPersonLabel(String(r.requested_by || '').trim());
    const assignedOk = isDisplayablePersonName(assignedName, String(r.assignee_id || ''));
    const name = assignedOk
      ? assignedName
      : (ownerMode === 'assignee_or_requester' && isDisplayablePersonName(requesterName)
        ? requesterName
        : '');
    const email = String(r.assignee_email || profile.email || '').trim().toLowerCase();
    const id = String(r.assignee_id || profile.user_id || '').trim();
    if (!name || !isDisplayablePersonName(name, id) || isPlaceholderPersonName(name)) continue;
    const mergeKey = compactMisName(name) || email || id || name.toLowerCase();
    if (!mergeKey) continue;
    const row = byKey.get(mergeKey) || {
      user_id: id || profile.user_id || mergeKey,
      user_name: name || profile.user_name || mergeKey,
      email: email || profile.email || '',
      open: 0,
      closed: 0,
      rejected: 0,
      total: 0,
      company: profile.company,
      company_key: profile.company_key,
      profile,
    };
    const s = String(r.status || '').toLowerCase();
    if (s === 'closed') row.closed += 1;
    else if (s === 'rejected') row.rejected += 1;
    else row.open += 1;
    row.total += 1;
    if (profile.last_sign_in && (!row.profile.last_sign_in || new Date(profile.last_sign_in) > new Date(row.profile.last_sign_in || 0))) {
      row.profile = profile;
    }
    if (!row.company && (profile.company || r.company_name || r.assignee_company)) {
      row.company = String(profile.company || r.company_name || r.assignee_company || '');
      row.company_key = String(profile.company_key || r.company_key || '');
    }
    byKey.set(mergeKey, row);
  }

  return [...byKey.values()].map((counts) => {
    const profile = counts.profile || ({} as AppDashboardUser);
    return {
      user_id: counts.user_id,
      user_name: counts.user_name,
      email: counts.email,
      company: counts.company || profile.company,
      company_key: counts.company_key || profile.company_key,
      last_sign_in: profile.last_sign_in ?? null,
      ever_logged_in: profile.ever_logged_in,
      is_active: profile.is_active,
      active_status: profile.active_status ?? null,
      open: counts.open,
      closed: counts.closed,
      rejected: counts.rejected,
      total: counts.total,
      pending: counts.open,
      completed: counts.closed,
      closure_ratio: counts.open + counts.closed > 0
        ? Math.round((counts.closed / (counts.open + counts.closed)) * 1000) / 10
        : 0,
    };
  });
}

function rosterPersonKey(u: AppDashboardUser): string {
  const email = String(u.email || '').trim().toLowerCase();
  if (email.includes('@')) return `email:${email}`;
  const compact = compactMisName(u.user_name);
  if (compact.length >= 3) return `name:${compact}`;
  return `id:${String(u.user_id || u.user_name || '').trim().toLowerCase()}`;
}

function ticketUserForMember(
  member: AppDashboardUser,
  countsByKey: Map<string, AppDashboardUser>,
): AppDashboardUser | undefined {
  return countsByKey.get(rosterPersonKey(member))
    || (member.email ? countsByKey.get(`email:${String(member.email).trim().toLowerCase()}`) : undefined)
    || (compactMisName(member.user_name).length >= 3
      ? countsByKey.get(`name:${compactMisName(member.user_name)}`)
      : undefined)
    || (member.user_id ? countsByKey.get(`id:${String(member.user_id).trim().toLowerCase()}`) : undefined);
}

function indexTicketUsers(ticketUsers: AppDashboardUser[]): Map<string, AppDashboardUser> {
  const countsByKey = new Map<string, AppDashboardUser>();
  for (const u of ticketUsers || []) {
    countsByKey.set(rosterPersonKey(u), u);
    const email = String(u.email || '').trim().toLowerCase();
    if (email.includes('@')) countsByKey.set(`email:${email}`, u);
    const compact = compactMisName(u.user_name);
    if (compact.length >= 3) countsByKey.set(`name:${compact}`, u);
    const id = String(u.user_id || '').trim().toLowerCase();
    if (id) countsByKey.set(`id:${id}`, u);
  }
  return countsByKey;
}

function overlayCountsOnMember(member: AppDashboardUser, hit?: AppDashboardUser): AppDashboardUser {
  const open = Number(hit?.open ?? hit?.pending ?? 0);
  const closed = Number(hit?.closed ?? hit?.completed ?? 0);
  const rejected = Number(hit?.rejected ?? 0);
  return {
    ...member,
    open,
    closed,
    rejected,
    total: open + closed + rejected,
    pending: open,
    completed: closed,
    closure_ratio: open + closed > 0 ? Math.round((closed / (open + closed)) * 1000) / 10 : 0,
  };
}

/** Overlay assignee ticket counts onto the Kissflow APP_ROLE roster. Extra requesters are dropped. */
export function mergeRosterWithTicketCounts(
  roster: AppDashboardUser[],
  ticketUsers: AppDashboardUser[],
): AppDashboardUser[] {
  const countsByKey = indexTicketUsers(ticketUsers);
  return (roster || []).map((member) => overlayCountsOnMember(member, ticketUserForMember(member, countsByKey)));
}

/**
 * Entity = All: keep APP_ROLE members (including zeros) and add ticket assignees
 * who are missing from the roster (ITSM Refex agents when SQL APP_ROLE is Extrovis-only).
 */
export function unionRosterWithTicketUsers(
  roster: AppDashboardUser[],
  ticketUsers: AppDashboardUser[],
): AppDashboardUser[] {
  const merged = mergeRosterWithTicketCounts(roster, ticketUsers);
  const seen = new Set<string>();
  for (const u of merged) {
    seen.add(rosterPersonKey(u));
    const email = String(u.email || '').trim().toLowerCase();
    if (email.includes('@')) seen.add(`email:${email}`);
    const compact = compactMisName(u.user_name);
    if (compact.length >= 3) seen.add(`name:${compact}`);
    const id = String(u.user_id || '').trim().toLowerCase();
    if (id) seen.add(`id:${id}`);
  }
  const extra: AppDashboardUser[] = [];
  for (const u of ticketUsers || []) {
    const keys = [
      rosterPersonKey(u),
      u.email ? `email:${String(u.email).trim().toLowerCase()}` : '',
      compactMisName(u.user_name).length >= 3 ? `name:${compactMisName(u.user_name)}` : '',
      u.user_id ? `id:${String(u.user_id).trim().toLowerCase()}` : '',
    ].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    extra.push(u);
    for (const k of keys) seen.add(k);
  }
  return extra.length ? [...merged, ...extra] : merged;
}
