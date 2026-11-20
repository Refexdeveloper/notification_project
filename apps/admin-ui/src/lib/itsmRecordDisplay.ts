import type { AppRecordColumn, AppRecordRow } from '@/services/appRecordsApi';
import { isDisplayablePersonName, isPlaceholderPersonName, normalizeItsmPersonLabel } from '@/lib/personName';

/** Same MIS columns as aasik_ITSM newceo — embed, normal, and Records tab. */
export const ITSM_CEO_RECORD_COLUMNS: AppRecordColumn[] = [
  { id: 'request_id', label: 'Request ID' },
  { id: 'requested_by', label: 'Requester Name' },
  { id: 'company_name', label: 'Company' },
  { id: 'assigned_to', label: 'Assigned To' },
  { id: 'sla', label: 'SLA' },
  { id: 'created_at', label: 'Created Date' },
  { id: 'status', label: 'Ticket Status' },
  { id: 'form_status', label: 'Stage' },
  { id: 'source', label: 'Source' },
  { id: 'category', label: 'Category' },
  { id: 'sub_category', label: 'Sub Category' },
  { id: 'laptop_label', label: 'Laptop' },
  { id: 'ticket_type', label: 'Request Type' },
  { id: 'closed_by', label: 'Closed By' },
  { id: 'closed_at', label: 'Closed Date' },
];

/** Kissflow process / flow titles — not useful as the ticket Name. */
function isItsmProcessTitle(value: string): boolean {
  const token = value.toLowerCase().replace(/[\s_-]+/g, '');
  return !token
    || token === '—'
    || token.includes('liveitservicerequest')
    || token.includes('itservicemanagement')
    || token.includes('itservicerequest');
}

/** True when Category / Sub Category looks like a laptop or desktop device issue. */
export function isItsmLaptopIssue(row: {
  category?: string | null;
  sub_category?: string | null;
}): boolean {
  const blob = `${row.category || ''} ${row.sub_category || ''}`.toLowerCase();
  return /\blaptop\b/.test(blob)
    || /\bdesktop\b/.test(blob)
    || /laptop\s*\/\s*desktop/.test(blob);
}

/** Laptop name · model from API fields (or empty). */
export function itsmLaptopLabel(row: AppRecordRow): string {
  const direct = String((row as Record<string, unknown>).laptop_label || '').trim();
  if (direct) return direct;
  const name = String((row as Record<string, unknown>).laptop_name || '').trim();
  const model = String((row as Record<string, unknown>).laptop_model || '').trim();
  if (name && model) {
    const n = name.toLowerCase();
    const m = model.toLowerCase();
    if (n.includes(m) || m.includes(n)) return name.length >= model.length ? name : model;
    return `${name} · ${model}`;
  }
  return name || model || '';
}

/** Ticket Name: Summary/subject when real; otherwise first line of description. */
export function itsmTicketName(row: AppRecordRow): string {
  const candidates = [
    String((row as Record<string, unknown>).summary || '').trim(),
    String((row as Record<string, unknown>).name || '').trim(),
    String(row.subject || '').trim(),
  ];
  for (const value of candidates) {
    if (value && !isItsmProcessTitle(value)) return value;
  }
  const description = String(row.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!description) return '';
  const firstLine = description.split(/(?<=[.!?])\s+|[\r\n]+/)[0]?.trim() || description;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117).trim()}…` : firstLine;
}

/** Category + sub-category key used to count how often an issue type appears. */
export function itsmIssueOccurrenceKey(row: {
  category?: string | null;
  sub_category?: string | null;
}): string {
  const category = String(row.category || '').trim().toLowerCase() || '—';
  const sub = String(row.sub_category || '').trim().toLowerCase() || '—';
  return `${category}||${sub}`;
}

/** Human label for the occurrence drill-down chip (Category · Sub Category). */
export function itsmIssueOccurrenceLabel(row: {
  category?: string | null;
  sub_category?: string | null;
}): string {
  const category = String(row.category || '').trim() || '—';
  const sub = String(row.sub_category || '').trim() || '—';
  return `${category} · ${sub}`;
}

/** Stamp each row with how many tickets share the same Category + Sub Category. */
export function stampItsmOccurrenceCounts<T extends {
  category?: string | null;
  sub_category?: string | null;
  occurrence_count?: number | null;
}>(rows: T[]): T[] {
  if (!rows.length) return rows;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = itsmIssueOccurrenceKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return rows.map((row) => ({
    ...row,
    occurrence_count: counts.get(itsmIssueOccurrenceKey(row)) || 1,
  }));
}

export function itsmReopenedStamp(row: AppRecordRow): { label: string; when: string } | null {
  const when = String(row.reopened_at || '').trim();
  if (!when) return null;
  return { label: 'Reopened', when };
}

export function isItsmSystemActor(value: string | null | undefined): boolean {
  const token = String(value || '').toLowerCase().replace(/[\s._-]+/g, '');
  return token === 'itsm'
    || token === 'itsmsa'
    || token.startsWith('itsmbot')
    || token === 'itsmserviceaccount'
    || token === 'bot'
    || token === 'itagents'
    || token === 'itagentsextrovis'
    || token === 'firstapprover'
    || token === 'firstapproverextrovis';
}

export function itsmHumanName(row: AppRecordRow): string {
  const assigned = normalizeItsmPersonLabel(String(row.assigned_to || '').trim());
  if (assigned && isDisplayablePersonName(assigned) && !isItsmSystemActor(assigned)) return assigned;
  const closedBy = normalizeItsmPersonLabel(String(row.closed_by || '').trim());
  if (closedBy && isDisplayablePersonName(closedBy) && !isItsmSystemActor(closedBy)) return closedBy;
  return '';
}

export function itsmStageLabel(row: AppRecordRow): string {
  const raw = String(row.form_status || '').trim();
  const token = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (token === 'completed' || token === 'complete') return 'Closed';
  if (token === 'inprogress') return 'InProgress';
  if (token === 'onhold' || token === 'hold') return 'OnHold';
  if (token === 'pendingwithvendor' || token === 'pendingvendor') return 'Pending with Vendor';
  if (token === 'pendingwithemployee' || token === 'pendingemployee') return 'Pending with Employee';
  if (token === 'closed' || token === 'close') return 'Closed';
  if (token === 'open') return 'Open';
  return raw;
}

export function itsmClosedByDisplay(row: AppRecordRow): string {
  const status = String(row.status || '').toLowerCase();
  const closed = status === 'closed' || status === 'rejected';
  if (!closed) return '';
  const closer = normalizeItsmPersonLabel(String(row.closed_by || '').trim());
  if (closer && !isPlaceholderPersonName(closer) && !isItsmSystemActor(closer) && isDisplayablePersonName(closer)) {
    return closer;
  }
  return itsmHumanName(row);
}

export function itsmClosedAtDisplay(row: AppRecordRow): string {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.form_status || row.current_step || '').toLowerCase();
  const closed = status === 'closed'
    || status === 'rejected'
    || /complet|reopen|employee feedback/.test(stage);
  return String(
    row.closed_at
    || (closed ? (row.agent_closed_at || row.modified_at || '') : '')
    || '',
  );
}

export function getRequestTypeShort(value: unknown): string {
  const label = String(value || '').trim();
  if (!label || label === '—') return '';
  const token = label.toLowerCase().replace(/[\s_-]+/g, '');
  if (token.includes('incident') || token === 'ic') return 'IC';
  if (token.includes('servicerequest') || token === 'sr' || token.includes('service')) return 'SR';
  if (token.includes('changerequest') || token === 'cr') return 'CR';
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
}

function itsmPersonField(row: AppRecordRow, ...keys: string[]): string {
  const raw = row as Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (value == null || value === '') continue;
    if (typeof value === 'string') {
      const text = normalizeItsmPersonLabel(value.trim());
      if (text && isDisplayablePersonName(text) && !isItsmSystemActor(text)) return text;
      continue;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const nested = normalizeItsmPersonLabel(
        String(obj.Name || obj.name || obj.DisplayName || obj.Email || obj.email || '').trim(),
      );
      if (nested && isDisplayablePersonName(nested) && !isItsmSystemActor(nested)) return nested;
    }
  }
  return '';
}

/**
 * Actual user for the ticket: Behalf Of Name when a proxy raised it, else Requester.
 * Never prefer Raised_By (e.g. Fazulahemed) over Behalf Of Name.
 */
export function itsmRequesterName(row: AppRecordRow): string {
  const behalf = itsmPersonField(
    row,
    'behalf_of_name',
    'Behalf_Of_Name',
    'BehalfOfName',
    'Behalf_Of',
  );
  if (behalf) return behalf;

  const raised = itsmPersonField(row, 'raised_by', 'Raised_By');
  const fromLookup = itsmPersonField(row, 'requester_name');
  if (fromLookup && (!raised || fromLookup.toLowerCase() !== raised.toLowerCase())) {
    return fromLookup;
  }
  const requested = itsmPersonField(row, 'requested_by', 'Requester_Name', 'Requester');
  if (requested && (!raised || requested.toLowerCase() !== raised.toLowerCase())) {
    return requested;
  }
  // No distinct username vs raiser — fall back to requester / raised-by.
  if (fromLookup) return fromLookup;
  if (requested) return requested;
  return raised;
}

/** Align requested_by with Behalf Of Name for IT Help Desk inventory / Top users / Records. */
export function stampItsmRequesterNames<T extends AppRecordRow>(rows: T[]): T[] {
  if (!rows.length) return rows;
  let changed = false;
  const next = rows.map((row) => {
    const actual = itsmRequesterName(row);
    if (!actual) return row;
    const current = String(row.requested_by || '').trim();
    if (current === actual) return row;
    changed = true;
    return { ...row, requested_by: actual };
  });
  return changed ? next : rows;
}

/**
 * Who submitted the ticket (Raised By / created-by), ignoring Behalf Of Name.
 */
export function itsmTicketUserName(row: AppRecordRow): string {
  const raised = itsmPersonField(row, 'raised_by', 'Raised_By');
  if (raised) return raised;
  return itsmPersonField(
    row,
    'requested_by',
    'Requester_Name',
    'Requester',
    'requester_name',
    '_created_by',
  );
}

export function itsmExpandTiles(row: AppRecordRow): Array<{ label: string; value: string }> {
  const laptop = itsmLaptopLabel(row);
  return [
    { label: 'Subject', value: itsmTicketName(row) },
    { label: 'Description', value: String(row.description || '').trim() },
    { label: 'Requester Name', value: itsmRequesterName(row) },
    { label: 'Category', value: String(row.category || '').trim() },
    { label: 'Sub Category', value: String(row.sub_category || '').trim() },
    { label: 'Laptop', value: laptop },
    { label: 'Criticality', value: String(row.criticality || '').trim() },
    { label: 'Company', value: String(row.company_name || row.company || '').trim() },
    { label: 'Entity', value: String(row.entity || '').trim() },
    { label: 'Stage', value: itsmStageLabel(row) },
  ];
}

const PENDING_APPROVAL_SLA_MINUTES = 120;

function isPendingApprovalSlaRow(row: AppRecordRow): boolean {
  const text = [row.form_status, row.current_step, row.status_raw]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return text.includes('pending') && text.includes('approv');
}

function parseSlaMinutes(value: unknown): number {
  if (value == null || value === '' || value === '—') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value > 1_000_000 ? value / 60000 : value;
  }
  const trimmed = String(value).trim();
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber > 1_000_000 ? asNumber / 60000 : asNumber;
  }
  return 0;
}

function formatSlaDuration(totalMinutes: number): string {
  const mins = Math.abs(Math.round(totalMinutes));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  const parts = [`${days}d`];
  if (remHours) parts.push(`${remHours}h`);
  if (remainder) parts.push(`${remainder}m`);
  return parts.join(' ');
}

function minutesBetween(from: unknown, to: unknown): number | null {
  const start = from ? new Date(String(from)) : null;
  const end = to ? new Date(String(to)) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  return (end.getTime() - start.getTime()) / 60000;
}

function normalizeSlaToken(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function headSlaBudgetMinutes(row: AppRecordRow): number {
  if (isPendingApprovalSlaRow(row)) return PENDING_APPROVAL_SLA_MINUTES;
  const closure = parseSlaMinutes(row.closure_minutes);
  if (closure > 0) return closure;
  const tat = parseSlaMinutes(row.tat_minutes);
  if (tat > 0) return tat;
  const sla = parseSlaMinutes(row.sla_minutes);
  if (sla > 0) return sla;
  const expected = minutesBetween(row.created_at, row.expected_at || row.sla_expected_at);
  return expected && expected > 0 ? expected : 0;
}

/** IT Tech / support work steps where elapsed-vs-budget SLA applies (matches production). */
function isItsmTechWorkStep(row: AppRecordRow): boolean {
  const step = String(row.current_step || '').toLowerCase();
  const token = normalizeSlaToken(step);
  if (token === 'inprogress' || token === 'completed' || token === 'open') return false;
  return step.includes('it tech')
    || step.includes('tech support')
    || step.includes('pickup')
    || step.includes('pick up')
    || step.includes('dependency')
    || step.includes('it agent')
    || step.includes('solution');
}

/** In-progress stage used with tech-work SLA timing (matches production). */
function isItsmInProgressSlaStage(row: AppRecordRow): boolean {
  const processStages = normalizeSlaToken(row.process_stages);
  const formOrStages = normalizeSlaToken(row.form_status || row.stages || '');
  const currentStep = normalizeSlaToken(row.current_step);
  if (processStages) return processStages === 'inprogress';
  return formOrStages === 'inprogress' || currentStep === 'inprogress' || isItsmTechWorkStep(row);
}

/** Approval / L1–L2 steps never count as SLA breached while open (matches production). */
function isItsmApprovalSlaStep(row: AppRecordRow): boolean {
  if (isPendingApprovalSlaRow(row)) return true;
  const step = String(row.current_step || '').toLowerCase();
  return /\bl1\b/.test(step)
    || /\bl2\b/.test(step)
    || step.includes('l1 approval')
    || step.includes('l2 approval')
    || step.includes('it manager approval')
    || step.includes('it head approval');
}

function hasItsmSlaBreachFlag(row: AppRecordRow): boolean {
  const flag = String(row.sla_breached || '').toLowerCase();
  if (flag === 'true' || flag === 'yes' || flag === '1' || flag === 'breached') return true;
  const statusBlob = [row.status_raw, row.item_status, row.itemStatus, row.status]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return statusBlob.includes('breach');
}

/**
 * Same SLA Breached rules as production admin-ui:
 * - Closed/rejected/completed: breach flag only
 * - Approval steps (open): never breached
 * - IT tech/support In Progress: flag OR elapsed > budget
 * - Other open steps: breach flag only
 */
export function itsmSlaDisplay(row: AppRecordRow, now = new Date()): { primary: string; sub: string | null; state: 'breached' | 'ok' | 'hold' | 'none' } {
  const form = normalizeSlaToken(row.form_status);
  const status = String(row.status || '').toLowerCase();
  const isClosed = status === 'closed' || status === 'rejected' || status === 'completed';
  if (!isClosed && (form === 'onhold' || form === 'hold')) {
    return { primary: 'Hold', sub: null, state: 'hold' };
  }

  const budget = headSlaBudgetMinutes(row);
  const elapsedStart = isClosed ? row.created_at : (row.modified_at || row.created_at);
  const closedAt = itsmClosedAtDisplay(row) || now;
  const elapsed = minutesBetween(elapsedStart, isClosed ? closedAt : now);
  const flag = hasItsmSlaBreachFlag(row);

  const breached = isClosed
    ? flag
    : isItsmApprovalSlaStep(row)
      ? false
      : (isItsmTechWorkStep(row) && isItsmInProgressSlaStage(row)
        ? (flag || (budget > 0 && elapsed != null && elapsed > budget))
        : flag);

  if (breached) {
    const over = budget > 0 && elapsed != null ? Math.max(0, elapsed - budget) : elapsed;
    return {
      primary: 'Breached',
      sub: over && over > 0 ? `Exceeded by ${formatSlaDuration(over)}` : null,
      state: 'breached',
    };
  }
  if (isClosed) {
    return {
      primary: 'Not Breached',
      sub: elapsed != null && budget > 0
        ? `${formatSlaDuration(elapsed)} / ${formatSlaDuration(budget)}`
        : (elapsed != null ? formatSlaDuration(elapsed) : null),
      state: 'ok',
    };
  }
  if (budget > 0 && elapsed != null && elapsed <= budget) {
    return { primary: 'On track', sub: `${formatSlaDuration(budget - elapsed)} left`, state: 'ok' };
  }
  return { primary: 'On track', sub: null, state: 'ok' };
}

export function itsmSlaFilterLabel(row: AppRecordRow): string {
  const display = itsmSlaDisplay(row);
  return display.primary && display.primary !== '—' ? display.primary : '';
}

/** True when the SLA column / SLA Breached card would count the ticket (production rules). */
export function isItsmSlaBreached(row: AppRecordRow, now = new Date()): boolean {
  return itsmSlaDisplay(row, now).state === 'breached';
}

export function countItsmSlaBreached(rows: AppRecordRow[], now = new Date()): number {
  return (rows || []).filter((row) => isItsmSlaBreached(row, now)).length;
}

export function itsmRecordCellText(row: AppRecordRow, colId: string): string {
  if (colId === 'assigned_to') return itsmHumanName(row) || '—';
  if (colId === 'requested_by' || colId === 'requester_name') return itsmRequesterName(row) || '—';
  if (colId === 'closed_by') return itsmClosedByDisplay(row) || '—';
  if (colId === 'form_status') return itsmStageLabel(row) || '—';
  if (colId === 'sla') return itsmSlaFilterLabel(row) || '—';
  if (colId === 'closed_at') return itsmClosedAtDisplay(row);
  if (colId === 'subject' || colId === 'name') return itsmTicketName(row);
  if (colId === 'source') return String(row.source || row.source_channel || '').trim();
  if (colId === 'company_name' || colId === 'company') {
    return String(row.company_name || row.company || '').trim();
  }
  if (colId === 'category') return String(row.category || '').trim();
  if (colId === 'sub_category') return String(row.sub_category || '').trim();
  if (colId === 'laptop_label' || colId === 'laptop') {
    if (!isItsmLaptopIssue(row) && !itsmLaptopLabel(row)) return '';
    return itsmLaptopLabel(row);
  }
  if (colId === 'occurrence_count') {
    const n = Number(row.occurrence_count);
    return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
  }
  if (colId === 'ticket_type') return getRequestTypeShort(row.ticket_type) || String(row.ticket_type || '').trim();
  return String((row as Record<string, unknown>)[colId] ?? '').trim();
}
