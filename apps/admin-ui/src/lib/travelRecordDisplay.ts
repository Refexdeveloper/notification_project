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

/** Shown only after Travel Booking KPI click. */
export const TRAVEL_BOOKING_FARE_COLUMNS: AppRecordColumn[] = [
  { id: 'route_median', label: 'Route median ₹' },
  { id: 'over_median', label: 'Above median ₹' },
  { id: 'over_median_pct', label: 'Above median %' },
];

export const TRAVEL_REQUEST_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'trip_type', label: 'Trip type' },
  { id: 'from_city', label: 'From place' },
  { id: 'to_city', label: 'To place' },
  { id: 'travel_mode', label: 'Travel mode' },
  { id: 'amount', label: 'Booking amount' },
  ...TRAVEL_BOOKING_FARE_COLUMNS,
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

const TRAVEL_FARE_MIN_SAMPLES = 3;

function isFlightTravelMode(travelMode: unknown): boolean {
  const text = String(travelMode || '').trim().toLowerCase();
  if (!text) return false;
  if (text.includes('flight')) return true;
  return /(^|[^a-z])air([^a-z]|$)/.test(text);
}

function fareRouteCity(value: unknown): string {
  let text = String(value || '').trim();
  if (!text || text === '—') return '';
  text = text.replace(/\s*\([A-Za-z]{3}\)\s*$/g, '').trim();
  return text.toUpperCase();
}

export function travelFareRoute(fromCity: unknown, toCity: unknown): string {
  const from = fareRouteCity(fromCity);
  const to = fareRouteCity(toCity);
  if (!from || !to) return '';
  return `${from}-${to}`;
}

function medianAmount(values: number[]): number | null {
  const sorted = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function formatOverMedianPct(value: unknown): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const pct = Math.round(n * 1000) / 10;
  if (pct === 0) return '0%';
  const shown = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${pct > 0 ? '+' : ''}${shown}%`;
}

/** Route median / fare difference for Travel Booking rows only. Non-flight or <3 samples stay empty. */
export function annotateTravelBookingFareRows(rows: AppRecordRow[]): AppRecordRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const routeAmounts = new Map<string, number[]>();
  for (const row of list) {
    if (!isFlightTravelMode(row.travel_mode)) continue;
    const route = travelFareRoute(row.from_city, row.to_city);
    if (!route) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const bucket = routeAmounts.get(route) || [];
    bucket.push(amount);
    routeAmounts.set(route, bucket);
  }
  const routeMedians = new Map<string, number>();
  for (const [route, amounts] of routeAmounts.entries()) {
    if (amounts.length < TRAVEL_FARE_MIN_SAMPLES) continue;
    const mid = medianAmount(amounts);
    if (mid != null) routeMedians.set(route, mid);
  }

  return list.map((row) => {
    if (!isFlightTravelMode(row.travel_mode)) {
      return { ...row, route_median: null, over_median: null, over_median_pct: null };
    }
    const route = travelFareRoute(row.from_city, row.to_city);
    const routeMedian = route ? routeMedians.get(route) : undefined;
    const amount = Number(row.amount);
    if (routeMedian == null || !Number.isFinite(amount)) {
      return { ...row, route_median: null, over_median: null, over_median_pct: null };
    }
    const overMedian = amount - routeMedian;
    return {
      ...row,
      route_median: routeMedian,
      over_median: overMedian,
      over_median_pct: routeMedian === 0 ? null : overMedian / routeMedian,
    };
  });
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
