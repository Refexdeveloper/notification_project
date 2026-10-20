import type { TravelRouteSummary } from '@/components/feature/TravelRouteBanner';
import type { AppRecordColumn, AppRecordRow } from '@/services/appRecordsApi';
import { displayWhen, isBlankDash } from '@/lib/dashboardEmpty';

export type TravelPackKind = 'booking' | 'advance' | 'expense';

const TRAVEL_SHARED_COLUMNS: AppRecordColumn[] = [
  { id: 'request_id', label: 'Request ID' },
  { id: 'requested_by', label: 'Requestor' },
  { id: 'assigned_to', label: 'Assigned to' },
  { id: 'purpose', label: 'Purpose' },
  { id: 'company_name', label: 'Company name' },
];

const TRAVEL_TAIL_COLUMNS: AppRecordColumn[] = [
  { id: 'current_step', label: 'Current step' },
  { id: 'status', label: 'Status' },
  { id: 'created_at', label: 'Created by' },
];

/** Top KPI table — all processes, no request-only place columns. */
export const TRAVEL_DASH_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'amount', label: 'Booking amount' },
  { id: 'process_id', label: 'Process' },
  ...TRAVEL_TAIL_COLUMNS,
];

export const TRAVEL_REQUEST_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'trip_type', label: 'Trip type' },
  { id: 'from_city', label: 'From place' },
  { id: 'to_city', label: 'To place' },
  { id: 'travel_mode', label: 'Travel mode' },
  { id: 'amount', label: 'Booking amount' },
  ...TRAVEL_TAIL_COLUMNS,
];

export const TRAVEL_ADVANCE_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'amount', label: 'Advance amount' },
  { id: 'linked_request_id', label: 'Linked request' },
  ...TRAVEL_TAIL_COLUMNS,
];

export const TRAVEL_EXPENSE_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'expense_type', label: 'Expense type' },
  { id: 'raised_amount', label: 'Raised amount' },
  { id: 'amount', label: 'Claim amount' },
  { id: 'expense_date', label: 'Expense date' },
  ...TRAVEL_TAIL_COLUMNS,
];

export function travelColumnsForPack(pack: TravelPackKind | null | undefined): AppRecordColumn[] {
  if (pack === 'booking') return TRAVEL_REQUEST_COLUMNS;
  if (pack === 'advance') return TRAVEL_ADVANCE_COLUMNS;
  if (pack === 'expense') return TRAVEL_EXPENSE_COLUMNS;
  return TRAVEL_DASH_COLUMNS;
}

const TRAVEL_ALWAYS_COLUMNS = new Set(TRAVEL_DASH_COLUMNS.map((col) => col.id));
const TRAVEL_REQUEST_ALWAYS = new Set(TRAVEL_REQUEST_COLUMNS.map((col) => col.id));
const TRAVEL_ADVANCE_ALWAYS = new Set(['request_id', 'requested_by', 'assigned_to', 'company_name', 'amount', 'current_step', 'status', 'created_at']);
const TRAVEL_EXPENSE_ALWAYS = new Set(['request_id', 'requested_by', 'assigned_to', 'company_name', 'raised_amount', 'amount', 'current_step', 'status', 'created_at']);

export function isTravelCoreColumn(colId: string, pack?: TravelPackKind | null): boolean {
  if (pack === 'booking') return TRAVEL_REQUEST_ALWAYS.has(colId);
  if (pack === 'advance') return TRAVEL_ADVANCE_ALWAYS.has(colId);
  if (pack === 'expense') return TRAVEL_EXPENSE_ALWAYS.has(colId);
  return TRAVEL_ALWAYS_COLUMNS.has(colId);
}

/** Purpose_of_Travel when mapped; otherwise Kissflow subject if it is not the process title. */
export function travelPurposeText(row: AppRecordRow): string {
  const purpose = String(row.purpose || '').trim();
  if (purpose && purpose !== '—') return purpose;
  const subject = String(row.subject || '').trim();
  if (!subject || subject === '—') return '';
  if (/^travel (request|advance|expense)$/i.test(subject)) return '';
  return subject;
}

export function prettyTravelTripType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw || raw === '—') return '';
  const key = raw.toLowerCase().replace(/[_\s-]+/g, '');
  if (key.includes('round')) return 'Round trip';
  if (key.includes('oneway') || key === 'one') return 'One way';
  return raw;
}

export function travelRouteSummary(row: AppRecordRow): TravelRouteSummary | null {
  const from = String(row.from_city || '').trim();
  const to = String(row.to_city || '').trim();
  if ((!from || from === '—') && (!to || to === '—')) return null;
  const tripType = prettyTravelTripType(row.trip_type) || 'Trip';
  return {
    from: from && from !== '—' ? from : '—',
    to: to && to !== '—' ? to : '—',
    tripType,
    roundTrip: /round/i.test(tripType),
  };
}

function tile(label: string, value: unknown): { label: string; value: string } {
  if (isBlankDash(value)) return { label, value: '' };
  return { label, value: String(value).trim() };
}

function dateTile(label: string, value: unknown): { label: string; value: string } {
  if (isBlankDash(value)) return { label, value: '' };
  const formatted = displayWhen(String(value));
  return { label, value: formatted === '—' ? '' : formatted };
}

/** Fields that are not table columns. Empty values are dropped by the panel. */
export function travelExpandTiles(
  row: AppRecordRow,
  opts: { hideRouteFields?: boolean; hideTravelMode?: boolean } = {},
): Array<{ label: string; value: string }> {
  const days = Number(row.travel_days);
  const hideRoute = Boolean(opts.hideRouteFields);
  return [
    hideRoute ? tile('Trip type', '') : tile('Trip type', prettyTravelTripType(row.trip_type) || row.trip_type),
    dateTile('Departure date', row.departure_date),
    hideRoute ? tile('From place', '') : tile('From place', row.from_city),
    hideRoute ? tile('To place', '') : tile('To place', row.to_city),
    opts.hideTravelMode ? tile('Travel mode', '') : tile('Travel mode', row.travel_mode),
    dateTile('Return date', row.return_date),
    tile('Travel days', Number.isFinite(days) && days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : ''),
    tile('Linked travel request', row.linked_request_id),
    tile('Advance claim status', row.advance_claim_status),
    tile('Expense type', row.expense_type),
    dateTile('Expense date', row.expense_date),
    tile('Airline', row.airline),
    tile('Flight number', row.flight_number),
    tile('Designation', row.designation),
    tile('Remarks', row.remarks),
    tile('Payment', row.payment_status),
  ];
}
