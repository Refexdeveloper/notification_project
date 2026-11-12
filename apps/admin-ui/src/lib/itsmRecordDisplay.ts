import type { AppRecordColumn, AppRecordRow } from '@/services/appRecordsApi';
import { isDisplayablePersonName, isPlaceholderPersonName, normalizeItsmPersonLabel } from '@/lib/personName';

/** Same MIS columns as aasik_ITSM newceo — embed, normal, and Records tab. */
export const ITSM_CEO_RECORD_COLUMNS: AppRecordColumn[] = [
  { id: 'request_id', label: 'Request ID' },
  { id: 'requested_by', label: 'Requester' },
  { id: 'assigned_to', label: 'Assigned To' },
  { id: 'sla', label: 'SLA' },
  { id: 'created_at', label: 'Created Date' },
  { id: 'status', label: 'Ticket Status' },
  { id: 'form_status', label: 'Stage' },
  { id: 'source', label: 'Source' },
  { id: 'ticket_type', label: 'Request Type' },
  { id: 'closed_by', label: 'Closed By' },
  { id: 'closed_at', label: 'Closed Date' },
];

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

/** Refex vs Extrovis — same split as aasik_ITSM dashboards. */
export function isItsmExtrovisRow(row: AppRecordRow): boolean {
  const blob = [
    row.entity,
    row.entity_key,
    row.request_id,
    row.process_id,
    row.company,
    row.company_name,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return blob.includes('extrovis');
}

/**
 * Stage label — backend already applies aasik rules
 * (Refex report Stages + Open→InProgress fallback; Extrovis Statu_1).
 * Ticket Status Closed / Rejected / Completed → Stage Closed.
 */
export function itsmStageLabel(row: AppRecordRow): string {
  const status = String(row.status || '').toLowerCase();
  if (status === 'closed' || status === 'rejected' || status === 'completed') return 'Closed';
  const raw = String(row.form_status || row.stages || '').trim();
  if (!raw) return '';
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

export function isItsmClosedRecord(row: AppRecordRow): boolean {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.form_status || row.current_step || '').toLowerCase();
  return status === 'closed'
    || status === 'rejected'
    || status === 'completed'
    || /complet|closed|reopen|employee feedback/.test(stage);
}

export function itsmClosedByDisplay(row: AppRecordRow): string {
  if (!isItsmClosedRecord(row)) return '';
  const closer = normalizeItsmPersonLabel(String(row.closed_by || '').trim());
  if (closer && !isPlaceholderPersonName(closer) && !isItsmSystemActor(closer) && isDisplayablePersonName(closer)) {
    return closer;
  }
  return itsmHumanName(row);
}

export function itsmClosedAtDisplay(row: AppRecordRow): string {
  const closed = isItsmClosedRecord(row);
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

export function itsmExpandTiles(row: AppRecordRow): Array<{ label: string; value: string }> {
  return [
    { label: 'Subject', value: String(row.subject || '').trim() },
    { label: 'Description', value: String(row.description || '').trim() },
    { label: 'Category', value: String(row.category || '').trim() },
    { label: 'Sub Category', value: String(row.sub_category || '').trim() },
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

function stageToken(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function isExtrovisPickupStep(row: AppRecordRow): boolean {
  const step = String(row.current_step || '').toLowerCase();
  return step.includes('pickup') || step.includes('pick up') || step.includes('pick-up');
}

/**
 * aasik isRefexSlaStageInProgress / isExtrovisLiveSlaStage.
 * Refex: process Stages wins; else display Stage (Open→InProgress already applied).
 * Extrovis: process Stages or Statu_1 InProgress.
 */
function isItsmSlaStageInProgress(row: AppRecordRow): boolean {
  const process = stageToken(row.process_stages);
  if (isItsmExtrovisRow(row)) {
    if (process === 'inprogress') return true;
    return stageToken(row.form_status || row.stages) === 'inprogress';
  }
  if (process) return process === 'inprogress';
  return stageToken(row.form_status || row.stages || itsmStageLabel(row)) === 'inprogress';
}

/** aasik isSlaHoldRow — entity-aware. */
function isItsmSlaHoldRow(row: AppRecordRow): boolean {
  const status = String(row.status || '').toLowerCase();
  const closed = status === 'closed' || status === 'rejected' || status === 'completed';
  if (closed) return false;
  const form = stageToken(row.form_status || row.stages);
  const process = stageToken(row.process_stages);
  if (form === 'onhold' || form === 'hold') return true;
  if (isItsmExtrovisRow(row)) {
    // Extrovis PickUp uses created+TAT — never Hold.
    if (isExtrovisPickupStep(row)) return false;
    return !isItsmSlaStageInProgress(row);
  }
  // Refex: Pending Approval keeps the clock; other non-InProgress stages Hold.
  // Empty Stages on an open ticket still run the clock (aasik / prior NE rule).
  if (isPendingApprovalSlaRow(row)) return false;
  if (isItsmSlaStageInProgress(row)) return false;
  if (!process && !form) return false;
  return true;
}

/**
 * SLA badge — aasik_ITSM Refex vs Extrovis rules (embed / main / CEO).
 */
export function itsmSlaDisplay(row: AppRecordRow, now = new Date()): { primary: string; sub: string | null; state: 'breached' | 'ok' | 'hold' | 'none' } {
  const status = String(row.status || '').toLowerCase();
  const closed = status === 'closed' || status === 'rejected' || status === 'completed';

  if (isItsmSlaHoldRow(row)) {
    return { primary: 'Hold', sub: null, state: 'hold' };
  }

  const budget = headSlaBudgetMinutes(row);
  const closedAt = itsmClosedAtDisplay(row) || now;
  // Extrovis PickUp clocks from created; otherwise last modified (aasik).
  const clockStart = !closed
    ? (
      isItsmExtrovisRow(row) && isExtrovisPickupStep(row)
        ? (row.created_at || row.modified_at)
        : (row.modified_at || row.created_at)
    )
    : row.created_at;
  const elapsed = minutesBetween(clockStart, closed ? closedAt : now);
  const flag = String(row.sla_breached || '').toLowerCase();
  const breached = flag === 'true' || flag === 'yes' || flag === '1' || flag === 'breached'
    || (budget > 0 && elapsed != null && elapsed > budget);
  if (breached) {
    const over = budget > 0 && elapsed != null ? Math.max(0, elapsed - budget) : elapsed;
    return {
      primary: 'Breached',
      sub: over && over > 0 ? `Exceeded by ${formatSlaDuration(over)}` : null,
      state: 'breached',
    };
  }
  if (closed) {
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

export function itsmRecordCellText(row: AppRecordRow, colId: string): string {
  if (colId === 'assigned_to') return itsmHumanName(row) || '—';
  if (colId === 'closed_by') return itsmClosedByDisplay(row) || '—';
  if (colId === 'form_status') return itsmStageLabel(row) || '—';
  if (colId === 'sla') return itsmSlaFilterLabel(row) || '—';
  if (colId === 'closed_at') return itsmClosedAtDisplay(row);
  if (colId === 'source') return String(row.source || row.source_channel || '').trim();
  if (colId === 'ticket_type') return getRequestTypeShort(row.ticket_type) || String(row.ticket_type || '').trim();
  return String((row as Record<string, unknown>)[colId] ?? '').trim();
}
