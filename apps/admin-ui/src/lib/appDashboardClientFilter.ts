import type { AppDashboardUser } from '@/services/appDashboardApi';
import type { AppRecordRow } from '@/services/appRecordsApi';
import {
  compactMisName,
  isDisplayablePersonName,
  isPlaceholderPersonName,
  looksLikeKissflowUserId,
  normalizeItsmPersonLabel,
  personDedupeKey,
} from '@/lib/personName';
import { itsmHumanName } from '@/lib/itsmRecordDisplay';
import { isPmSlaBreached } from '@/lib/pmSla';
import {
  buildEntityBucketOptions,
  buildRefexCompanyOptions,
  companyBelongsToEntity,
  sortCompanyFilterOptions,
  companyIdFromLabel,
  isEntityBucketLabel,
  recordMatchesCompany,
  recordMatchesEntityBucket,
  REFEX_DEFAULT_COMPANY_NAME,
  resolveCompanyIdFromText,
  resolveEntityBucket,
} from '@/lib/refexCompanies';

/**
 * ITSM Entity filter label — Kissflow Employee_entity / Entity (Adrenalin-backed),
 * already stamped on row.entity by the API.
 */
export function itsmEntityFieldLabel(row: { entity?: unknown; employee_entity?: unknown }): string {
  const text = String(row.employee_entity || row.entity || '').trim();
  if (!text || text === '—' || text === '-') return '';
  return text;
}

/** Distinct Kissflow entity-field values for the IT Help Desk Entity dropdown. */
export function itsmEntityFieldCountsFromRecords(
  items: AppRecordRow[],
): Array<{ id: string; label: string; count: number }> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of items || []) {
    const label = itsmEntityFieldLabel(row);
    if (!label) continue;
    const key = label.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .map(({ label, count }) => ({ id: label, label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

export function recordMatchesItsmEntityField(
  row: { entity?: unknown },
  filterId: string,
): boolean {
  const filter = String(filterId || 'all').trim();
  if (!filter || filter.toLowerCase() === 'all') return true;
  return itsmEntityFieldLabel(row).toLowerCase() === filter.toLowerCase();
}

export type RecordFilterOpts = {
  /**
   * ITSM: exact Kissflow Entity field label (or legacy bucket refex/extrovis).
   * Other apps: entity bucket all | refex | extrovis | venwind.
   */
  entity?: string;
  /** Company catalog id (or Lead website label). */
  company?: string;
  /** Requester department label (EMS); compared case-insensitively. */
  department?: string;
  /** Lead Tracker: filter by Kissflow Website_and_form */
  leadWebsiteMode?: boolean;
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

export type RecordKpiFocus =
  | 'total'
  | 'open'
  | 'closed'
  | 'rejected'
  | 'opened_today'
  | 'closed_today'
  | 'sla_breached';

export function isRecordKpiFocus(focus: string | null | undefined): focus is RecordKpiFocus {
  return focus === 'total'
    || focus === 'open'
    || focus === 'closed'
    || focus === 'rejected'
    || focus === 'opened_today'
    || focus === 'closed_today'
    || focus === 'sla_breached';
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
  const compactWho = personDedupeKey(who);
  const compactRequester = personDedupeKey(requester);
  const compactName = personDedupeKey(name);
  const idl = id.toLowerCase();
  const namel = name.toLowerCase();

  const owner = itsmHumanName(row);
  const compactOwner = personDedupeKey(owner);
  if (idl) {
    if (rowId && rowId === idl) return true;
    if (email && (email === idl || email.startsWith(`${idl}@`))) return true;
    if (who.toLowerCase() === idl) return true;
    if (owner && owner.toLowerCase() === idl) return true;
    if (matchRequester && requester.toLowerCase() === idl) return true;
  }
  if (compactName.length >= 3) {
    if (compactWho.length >= 3 && compactWho === compactName) return true;
    if (compactOwner.length >= 3 && compactOwner === compactName) return true;
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

function recordClosedAt(row: AppRecordRow, itsmStrict = false): string | null | undefined {
  if (itsmStrict) {
    return (row.closed_at as string | null | undefined) || null;
  }
  return (
    (row.closed_at as string | null | undefined)
    || (row.completed_at as string | null | undefined)
    || (row.modified_at as string | null | undefined)
    || null
  );
}

/** Refex IT Tech Reopen / Ticket Reopen + Extrovis ReOpen Window. Not "Ticket Reopened". */
export function isItsmReopenHoldStep(row: AppRecordRow | Record<string, unknown> | null | undefined): boolean {
  const hay = `${row?.current_step || ''} ${row?.status_raw || ''} ${row?.form_status || ''}`.toLowerCase();
  if (!hay.trim() || hay.includes('reopened')) return false;
  return (
    hay.includes('it tech reopen')
    || hay.includes('ticket reopen')
    || hay.includes('reopen window')
    || hay.includes('employee feedback')
  );
}

/**
 * Closed Today = moved onto Ticket Reopen / IT Tech Reopen / ReOpen Window today.
 * Falls back to process completed_at. Never uses comment-bumped modified_at.
 */
export function recordItsmClosedTodayAt(row: AppRecordRow | Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const reopenAt = String(row.reopen_entered_at || '').trim();
  if (reopenAt) return reopenAt;
  if (isItsmReopenHoldStep(row)) {
    const agentAt = String(row.agent_closed_at || '').trim();
    return agentAt || null;
  }
  return String(row.closed_at || row.completed_at || '').trim() || null;
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

export function recordDepartmentLabel(row: AppRecordRow): string {
  const text = String(row.department || '').trim();
  return text === '—' ? '' : text;
}

/** Department dropdown rows (label = id), sorted A→Z. */
export function departmentCountsFromRecords(items: AppRecordRow[]): Array<{ id: string; label: string; count: number }> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of items || []) {
    const label = recordDepartmentLabel(row);
    if (!label) continue;
    const key = label.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .map(({ label, count }) => ({ id: label, label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

export function filterAppRecords(
  items: AppRecordRow[],
  opts: RecordFilterOpts = {},
): AppRecordRow[] {
  const statusFilter = String(opts.status || 'all').toLowerCase();
  const entityFilter = String(opts.entity || 'all').trim().toLowerCase();
  const companyFilter = String(opts.company || 'all').trim().toLowerCase();
  const departmentFilter = String(opts.department || 'all').trim().toLowerCase();
  const assignedFilter = String(opts.assigned || '').trim();
  const assignedId = String(opts.assignedId || '').trim();
  const from = String(opts.dateFrom || '').slice(0, 10);
  const to = String(opts.dateTo || '').slice(0, 10);
  const todayKind = opts.todayKind;
  const todayYmd = todayKind ? toIstYmd(new Date().toISOString()) : '';
  const itsmCompanyMode = Boolean(opts.itsmCompanyMode);
  const leadWebsiteMode = Boolean(opts.leadWebsiteMode);
  const activityDates = Boolean(opts.activityDates);

  return (items || []).filter((row) => {
    if (isDraftRow(row)) return false;
    const id = String(row.request_id || row.id || '').trim();
    if (!id || id === '—') return false;

    if (statusFilter !== 'all' && String(row.status || '').toLowerCase() !== statusFilter) return false;

    if (itsmCompanyMode) {
      // Entity dropdown = Kissflow Employee_entity / Entity (Adrenalin via Kissflow).
      // Keep legacy bucket ids working if still selected.
      if (entityFilter === 'refex' || entityFilter === 'extrovis' || entityFilter === 'venwind') {
        if (!recordMatchesEntityBucket(row, entityFilter, itsmCompanyMode)) return false;
      } else if (!recordMatchesItsmEntityField(row, String(opts.entity || 'all').trim())) {
        return false;
      }
    } else if (!recordMatchesEntityBucket(row, entityFilter, itsmCompanyMode)) {
      return false;
    }
    if (leadWebsiteMode) {
      if (!recordMatchesLeadWebsite(row, companyFilter)) return false;
    } else if (companyFilter.startsWith('raw:')) {
      const want = companyFilter.slice(4);
      const compact = compactMisName(String(row.company_name || row.assignee_company || row.company || ''));
      if (!want || (compact !== want && !compact.includes(want) && !want.includes(compact))) return false;
    } else if (!recordMatchesCompany(row, companyFilter, itsmCompanyMode)) {
      return false;
    }

    if (departmentFilter !== 'all' && recordDepartmentLabel(row).toLowerCase() !== departmentFilter) return false;

    if ((assignedFilter || assignedId) && !recordMatchesAssigned(row, assignedFilter, assignedId, {
      matchRequester: !itsmCompanyMode,
    })) {
      return false;
    }

    if (from || to) {
      const createdYmd = toIstYmd(row.created_at);
      const closedYmd = activityDates ? toIstYmd(recordClosedAt(row, itsmCompanyMode)) : '';
      const ymds = [createdYmd, closedYmd].filter(Boolean);
      if (!ymds.length) return false;
      const inWindow = ymds.some((ymd) => (!from || ymd >= from) && (!to || ymd <= to));
      if (!inWindow) return false;
    }

    if (todayKind === 'opened') {
      if (toIstYmd(row.created_at) !== todayYmd) return false;
    }
    if (todayKind === 'closed') {
      const closedYmd = itsmCompanyMode
        ? toIstYmd(recordItsmClosedTodayAt(row))
        : toIstYmd(recordClosedAt(row, false));
      if (closedYmd) {
        if (closedYmd !== todayYmd) return false;
      } else if (itsmCompanyMode) {
        return false;
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

/** Today's created / closed counts (IST calendar day). ITSM Closed Today = Reopen-step move. */
export function countTodayActivity(items: AppRecordRow[], todayYmd: string, opts: { itsmStrict?: boolean } = {}) {
  let opened = 0;
  let closed = 0;
  for (const r of items || []) {
    if (toIstYmd(r.created_at) === todayYmd) opened += 1;
    if (opts.itsmStrict) {
      if (String(r.status || '').toLowerCase() !== 'closed') continue;
      if (toIstYmd(recordItsmClosedTodayAt(r)) === todayYmd) closed += 1;
      continue;
    }
    const closedYmd = toIstYmd(recordClosedAt(r, false));
    if (closedYmd) {
      if (closedYmd === todayYmd) closed += 1;
    } else if (
      String(r.status || '').toLowerCase() === 'closed'
      && toIstYmd(r.created_at) === todayYmd
    ) {
      closed += 1;
    }
  }
  return { opened, closed };
}

export function isPmTaskProcess(processId: string): boolean {
  return /project_sub_task/i.test(processId);
}

export function isPmSubtaskProcess(processId: string): boolean {
  return /sub_task_process/i.test(processId) && !/project_sub_task/i.test(processId);
}

function pmRecordBucket(row: AppRecordRow): 'open' | 'closed' | 'rejected' {
  const s = String(row.status || '').toLowerCase();
  if (s === 'closed' || s === 'completed' || s === 'done' || s === 'complete') return 'closed';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'withdrawn') return 'rejected';
  return 'open';
}

export function pmRecordProjectKey(row: AppRecordRow): string {
  return String(row.project_id || row.project_key || '').trim();
}

export type PmPackKind = 'projects' | 'tasks' | 'individual' | 'subtasks';
export type PmPackMetric = 'total' | 'open' | 'closed' | 'sla_breached';
export type PmProjectState = { hasOpen: boolean; hasClosed: boolean };

/** Project ID → whether it still has open tasks / any closed tasks (same rules as portfolio KPIs). */
export function buildPmProjectState(items: AppRecordRow[]): Map<string, PmProjectState> {
  const projectMap = new Map<string, PmProjectState>();
  for (const row of items || []) {
    if (!isPmTaskProcess(String(row.process_id || ''))) continue;
    const key = pmRecordProjectKey(row);
    if (!key) continue;
    const bucket = pmRecordBucket(row);
    const entry = projectMap.get(key) || { hasOpen: false, hasClosed: false };
    if (bucket === 'open') entry.hasOpen = true;
    if (bucket === 'closed') entry.hasClosed = true;
    projectMap.set(key, entry);
  }
  return projectMap;
}

/**
 * Filter MIS rows for a PM portfolio card click.
 * Projects cards show linked tasks for matching project IDs.
 */
export function pmRowMatchesPack(
  row: AppRecordRow,
  pack: { key: PmPackKind; metric: PmPackMetric },
  projectState: Map<string, PmProjectState>,
): boolean {
  const pid = String(row.process_id || '');
  const bucket = pmRecordBucket(row);
  const key = pmRecordProjectKey(row);

  if (pack.key === 'projects') {
    if (!isPmTaskProcess(pid) || !key) return false;
    const entry = projectState.get(key);
    if (!entry) return false;
    if (pack.metric === 'total') return true;
    if (pack.metric === 'open') return entry.hasOpen;
    return entry.hasClosed && !entry.hasOpen;
  }

  if (pack.key === 'tasks') {
    if (!isPmTaskProcess(pid)) return false;
    if (pack.metric === 'sla_breached') return isPmSlaBreached(row);
    if (pack.metric === 'total') return true;
    return pack.metric === 'open' ? bucket === 'open' : bucket === 'closed';
  }

  if (pack.key === 'individual') {
    if (!isPmTaskProcess(pid) || key) return false;
    if (pack.metric === 'total') return true;
    return pack.metric === 'open' ? bucket === 'open' : bucket === 'closed';
  }

  if (pack.key === 'subtasks') {
    if (!isPmSubtaskProcess(pid)) return false;
    if (pack.metric === 'total') return true;
    return pack.metric === 'open' ? bucket === 'open' : bucket === 'closed';
  }

  return false;
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

function leadWebsiteLabel(row: AppRecordRow): string {
  return String(
    row.website
    || row.website_name
    || row.Website_and_form
    || row.Website
    || '',
  ).trim();
}

export function recordMatchesLeadWebsite(row: AppRecordRow, filter: string): boolean {
  const want = String(filter || 'all').trim().toLowerCase();
  if (!want || want === 'all') return true;
  const have = leadWebsiteLabel(row).toLowerCase();
  if (!have) return false;
  return have === want || have.includes(want) || want.includes(have);
}

export function websiteCountsFromRecords(
  items: AppRecordRow[],
): Array<{ id: string; label: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const row of items) {
    const label = leadWebsiteLabel(row);
    if (!label || isPlaceholderPersonName(label)) continue;
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ id: label, label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function companyCountsFromRecords(
  items: AppRecordRow[],
  {
    itsmCompanyMode = false,
    entity = 'all',
  }: { itsmCompanyMode?: boolean; entity?: string } = {},
): Array<{ id: string; label: string; count: number }> {
  const entityFilter = String(entity || 'all').trim().toLowerCase();
  const counts: Record<string, number> = {};
  const extraLabels: Record<string, string> = {};
  for (const row of items) {
    if (entityFilter !== 'all' && !recordMatchesEntityBucket(row, entityFilter, itsmCompanyMode)) continue;
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
    .filter(([id, label]) => (counts[id] || 0) > 0 && companyBelongsToEntity(label || id, entityFilter))
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
  const compact = personDedupeKey(user.user_name);
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
    personDedupeKey(name),
    personDedupeKey(name) ? `name:${personDedupeKey(name)}` : '',
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

function personCompanyLookupKeys(row: {
  user_id?: string | null;
  user_name?: string | null;
  email?: string | null;
  requested_by?: string | null;
  assigned_to?: string | null;
  assignee_id?: string | null;
  assignee_email?: string | null;
  requester_email?: string | null;
}): string[] {
  const keys: string[] = [];
  const push = (raw: unknown, prefix: 'id' | 'email' | 'name') => {
    const text = String(raw || '').trim();
    if (!text) return;
    if (prefix === 'email') {
      const mail = text.toLowerCase();
      if (mail.includes('@')) keys.push(`email:${mail}`);
      return;
    }
    if (prefix === 'id') {
      keys.push(`id:${text.toLowerCase()}`);
      return;
    }
    const compact = personDedupeKey(text);
    if (compact.length >= 3) keys.push(`name:${compact}`);
  };
  push(row.user_id, 'id');
  push(row.assignee_id, 'id');
  push(row.email, 'email');
  push(row.assignee_email, 'email');
  push(row.requester_email, 'email');
  push(row.user_name, 'name');
  push(row.requested_by, 'name');
  push(row.assigned_to, 'name');
  return keys;
}

function preferCatalogCompany(current: string | null | undefined, next: string | null | undefined): string {
  const cur = String(current || '').trim();
  const nxt = String(next || '').trim();
  const curOk = Boolean(cur) && !isBucketOnlyCompany(cur) && !isEntityBucketLabel(cur) && Boolean(resolveCompanyIdFromText(cur));
  if (curOk) return cur;
  const nxtOk = Boolean(nxt) && !isBucketOnlyCompany(nxt) && !isEntityBucketLabel(nxt) && Boolean(resolveCompanyIdFromText(nxt));
  if (nxtOk) return nxt;
  if (cur && !isBucketOnlyCompany(cur) && !isEntityBucketLabel(cur)) return cur;
  if (nxt && !isBucketOnlyCompany(nxt) && !isEntityBucketLabel(nxt)) return nxt;
  return cur || nxt || '';
}

/**
 * Stamp APP_ROLE / roster users with legal company (+ email) from application
 * ticket payloads. Company comes from the requester’s ticket company
 * (user_details_lookup Company_Name) — never from tickets they only handle as
 * assignee (IT agents must not inherit the requester’s company).
 * Assignee rows contribute email only (ticket assignee_company often mirrors
 * requester company_name and must be ignored).
 */
export function stampAppUsersWithCompanyFromRecords(
  users: AppDashboardUser[],
  records: AppRecordRow[],
): AppDashboardUser[] {
  if (!users?.length) return users || [];
  type Hit = { company: string; email: string };
  const byKey = new Map<string, Hit>();
  const remember = (keys: string[], company: string, email: string) => {
    if (!keys.length) return;
    for (const key of keys) {
      const prev = byKey.get(key);
      const nextCompany = preferCatalogCompany(prev?.company, company);
      const nextEmail = String(prev?.email || '').includes('@')
        ? String(prev?.email)
        : (email.includes('@') ? email : String(prev?.email || ''));
      byKey.set(key, { company: nextCompany, email: nextEmail });
    }
  };

  for (const row of records || []) {
    const ticketCompany = preferCatalogCompany(
      '',
      String(row.company_name || row.company || '').trim(),
    );
    const requesterEmail = String((row as Record<string, unknown>).requester_email || '').trim().toLowerCase();
    const assigneeEmail = String(row.assignee_email || '').trim().toLowerCase();
    remember(
      personCompanyLookupKeys({
        requested_by: row.requested_by,
        requester_email: requesterEmail,
      }),
      ticketCompany,
      requesterEmail,
    );
    // Assignees: email only. Ticket assignee_company often mirrors requester
    // company_name (Holding ticket → Mugesh gets Holding) — never use it here.
    remember(
      personCompanyLookupKeys({
        user_id: row.assignee_id,
        user_name: row.assigned_to,
        assigned_to: row.assigned_to,
        assignee_id: row.assignee_id,
        assignee_email: assigneeEmail,
        email: assigneeEmail,
      }),
      '',
      assigneeEmail,
    );
  }

  return users.map((user) => {
    const keys = personCompanyLookupKeys(user);
    let hit: Hit | undefined;
    for (const key of keys) {
      const found = byKey.get(key);
      if (!found) continue;
      hit = {
        company: preferCatalogCompany(hit?.company, found.company),
        email: (hit?.email && hit.email.includes('@')) ? hit.email : (found.email || hit?.email || ''),
      };
    }
    const company = preferCatalogCompany(user.company, hit?.company);
    const email = String(user.email || '').includes('@')
      ? String(user.email)
      : (hit?.email && hit.email.includes('@') ? hit.email : String(user.email || ''));
    if (!company && !email) return user;
    return {
      ...user,
      company: company || user.company || null,
      company_key: resolveCompanyIdFromText(company || user.company) || user.company_key || null,
      email: email || user.email,
    };
  });
}

/** Copy last_sign_in / email / company from Kissflow roster onto MIS rows. */
export function overlayRosterSignIn(
  users: AppDashboardUser[],
  roster: AppDashboardUser[],
): AppDashboardUser[] {
  if (!users?.length || !roster?.length) return users || [];
  const profileByKey = buildProfileLookup(roster);
  return users.map((u) => {
    const fakeRow: AppRecordRow = {
      id: String(u.user_id || u.user_name || ''),
      assigned_to: u.user_name,
      assignee_id: u.user_id,
      assignee_email: u.email,
    };
    const profile = resolveProfileForRecord(fakeRow, profileByKey);
    const company = preferCatalogCompany(u.company, profile.company);
    const email = String(u.email || '').includes('@')
      ? String(u.email)
      : (String(profile.email || '').includes('@') ? String(profile.email) : String(u.email || ''));
    const next = {
      ...u,
      email: email || u.email,
      company: company || u.company || null,
      company_key: resolveCompanyIdFromText(company || u.company) || u.company_key || profile.company_key || null,
      last_sign_in: u.last_sign_in || profile.last_sign_in || null,
      ever_logged_in: Boolean(u.ever_logged_in || profile.ever_logged_in || u.last_sign_in || profile.last_sign_in),
      is_active: u.is_active ?? profile.is_active,
      active_status: u.active_status ?? profile.active_status,
    };
    return next;
  });
}

export function isUsableUserFilterLabel(name: string | null | undefined, userId?: string | null): boolean {
  return isDisplayablePersonName(name, userId) && !isPlaceholderPersonName(name);
}

function preferredFilterLabel(current: string, next: string): string {
  const left = String(current || '').trim();
  const right = String(next || '').trim();
  if (!left) return right;
  if (!right) return left;
  const leftCased = left !== left.toLowerCase();
  const rightCased = right !== right.toLowerCase();
  if (rightCased && !leftCased) return right;
  if (right.length > left.length) return right;
  return left;
}

/** Merge Sakthivel / sakthivel / two Kissflow ids into one User filter option. */
export function mergeUserFilterOptions(
  options: Array<{ id: string; label: string; email?: string }>,
): Array<{ id: string; label: string }> {
  const map = new Map<string, { id: string; label: string }>();
  for (const option of options || []) {
    const label = normalizeItsmPersonLabel(option.label);
    if (!isUsableUserFilterLabel(label, option.id)) continue;
    const key = personDedupeKey(label)
      || String(option.email || '').trim().toLowerCase()
      || String(option.id || '').trim().toLowerCase();
    if (!key) continue;
    const hit = map.get(key);
    if (!hit) {
      map.set(key, { id: option.id, label });
      continue;
    }
    hit.label = preferredFilterLabel(hit.label, label);
  }
  return [...map.values()];
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
  const compactSel = personDedupeKey(sel);
  const compactLabel = personDedupeKey(option.label);
  return Boolean(compactSel) && compactSel === compactLabel;
}

/** MIS / records Assigned-to cell. ITSM matches newceo: hide bots, use human closer if needed. */
export function assignedRecordLabel(row: AppRecordRow, opts: { itsmCompanyMode?: boolean } = {}): string {
  const assigned = normalizeItsmPersonLabel(String(row.assigned_to || '').trim());
  if (opts.itsmCompanyMode) {
    return itsmHumanName(row) || '—';
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
    const assignedName = itsmHumanName(r) || normalizeItsmPersonLabel(String(r.assigned_to || '').trim());
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
    const mergeKey = personDedupeKey(name) || email || id || name.toLowerCase();
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
    // Assignee company from roster only — never ticket company_name (requester’s).
    if (!row.company && profile.company) {
      row.company = String(profile.company);
      row.company_key = String(profile.company_key || '');
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
  const compact = personDedupeKey(u.user_name);
  if (compact.length >= 3) return `name:${compact}`;
  return `id:${String(u.user_id || u.user_name || '').trim().toLowerCase()}`;
}

function ticketUserForMember(
  member: AppDashboardUser,
  countsByKey: Map<string, AppDashboardUser>,
): AppDashboardUser | undefined {
  return countsByKey.get(rosterPersonKey(member))
    || (member.email ? countsByKey.get(`email:${String(member.email).trim().toLowerCase()}`) : undefined)
    || (personDedupeKey(member.user_name).length >= 3
      ? countsByKey.get(`name:${personDedupeKey(member.user_name)}`)
      : undefined)
    || (member.user_id ? countsByKey.get(`id:${String(member.user_id).trim().toLowerCase()}`) : undefined);
}

function indexTicketUsers(ticketUsers: AppDashboardUser[]): Map<string, AppDashboardUser> {
  const countsByKey = new Map<string, AppDashboardUser>();
  for (const u of ticketUsers || []) {
    countsByKey.set(rosterPersonKey(u), u);
    const email = String(u.email || '').trim().toLowerCase();
    if (email.includes('@')) countsByKey.set(`email:${email}`, u);
    const compact = personDedupeKey(u.user_name);
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
    const compact = personDedupeKey(u.user_name);
    if (compact.length >= 3) seen.add(`name:${compact}`);
    const id = String(u.user_id || '').trim().toLowerCase();
    if (id) seen.add(`id:${id}`);
  }
  const extra: AppDashboardUser[] = [];
  for (const u of ticketUsers || []) {
    const keys = [
      rosterPersonKey(u),
      u.email ? `email:${String(u.email).trim().toLowerCase()}` : '',
      personDedupeKey(u.user_name).length >= 3 ? `name:${personDedupeKey(u.user_name)}` : '',
      u.user_id ? `id:${String(u.user_id).trim().toLowerCase()}` : '',
    ].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    extra.push(u);
    for (const k of keys) seen.add(k);
  }
  return extra.length ? [...merged, ...extra] : merged;
}

export function misUserHasLogin(user: { last_sign_in?: string | null; ever_logged_in?: boolean }): boolean {
  return Boolean(user.last_sign_in) || user.ever_logged_in === true;
}

/**
 * Same people as the MIS Users table: assigned tickets in the current
 * Entity/Company/Period scope and a Kissflow login. Roster-only names
 * (e.g. Agnes Simon with 0 tickets) are excluded so the User filter
 * cannot list someone who never appears in MIS.
 */
export function misEligibleUsers(
  ticketUsers: AppDashboardUser[],
  roster: AppDashboardUser[],
): AppDashboardUser[] {
  return overlayRosterSignIn(
    (ticketUsers || []).filter((u) => Number(u.total || 0) > 0),
    roster,
  ).filter((u) => misUserHasLogin(u));
}
