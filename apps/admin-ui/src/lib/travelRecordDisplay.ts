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
  { id: 'reference_fare', label: 'Reference fare' },
  { id: 'policy_deviation_cost', label: 'Policy deviation cost' },
  { id: 'deviation_pct', label: 'Deviation %' },
  { id: 'sla', label: 'SLA' },
  { id: 'fare_trend', label: 'Fare trend' },
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

export function formatDeviationPct(value: unknown): string {
  return formatOverMedianPct(value);
}

export type TravelFareTrendKind = 'Up' | 'Down' | 'Flat';

export function travelFareTrendKind(value: unknown): TravelFareTrendKind | null {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'up') return 'Up';
  if (key === 'down') return 'Down';
  if (key === 'flat') return 'Flat';
  return null;
}

/** Absolute whole-percent label used next to the fare-trend sparkline (3%, 0%, 14%). */
export function formatFareTrendPct(value: unknown): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${Math.round(Math.abs(n) * 100)}%`;
}

export function fareTrendFilterLabel(trend: unknown, deviationPct: unknown): string {
  const kind = travelFareTrendKind(trend);
  const pct = kind === 'Flat' ? '0%' : formatFareTrendPct(deviationPct);
  if (!kind || !pct) return '';
  const marker = kind === 'Up' ? '▲' : kind === 'Down' ? '▼' : '■';
  return `${marker}${pct}`;
}

export function travelSlaDisplay(row: AppRecordRow): {
  primary: string;
  sub: string | null;
  state: 'breached' | 'ok' | 'none';
} {
  const created = row.created_at ? new Date(String(row.created_at)) : null;
  const depart = row.departure_date ? new Date(String(row.departure_date)) : null;
  if (!created || !depart || Number.isNaN(created.getTime()) || Number.isNaN(depart.getTime())) {
    return { primary: '', sub: null, state: 'none' };
  }
  const days = Math.round((depart.getTime() - created.getTime()) / 86400000);
  const time = days === 0 ? 'Same day' : `${Math.abs(days)}d`;
  if (days < 0) return { primary: 'Breached', sub: time, state: 'breached' };
  return { primary: 'Not breached', sub: time, state: 'ok' };
}

export function travelSlaLabel(row: AppRecordRow): string {
  const sla = travelSlaDisplay(row);
  if (sla.state === 'none') return '';
  return sla.sub ? `${sla.primary} · ${sla.sub}` : sla.primary;
}

function emptyFareAnnotation(row: AppRecordRow): AppRecordRow {
  return {
    ...row,
    reference_fare: null,
    policy_deviation_cost: null,
    deviation_pct: null,
    sla: travelSlaLabel(row) || null,
    fare_trend: null,
  };
}

/** Route reference fare / policy deviation / SLA / trend for Travel Booking rows. */
export function annotateTravelBookingFareRows(rows: AppRecordRow[]): AppRecordRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const routeAmounts = new Map<string, number[]>();
  const routeHistory = new Map<string, Array<{ id: string; amount: number; at: number }>>();
  for (const row of list) {
    if (!isFlightTravelMode(row.travel_mode)) continue;
    const route = travelFareRoute(row.from_city, row.to_city);
    if (!route) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const bucket = routeAmounts.get(route) || [];
    bucket.push(amount);
    routeAmounts.set(route, bucket);
    const history = routeHistory.get(route) || [];
    const at = row.created_at ? new Date(String(row.created_at)).getTime() : 0;
    history.push({ id: String(row.id || row.request_id || ''), amount, at: Number.isFinite(at) ? at : 0 });
    routeHistory.set(route, history);
  }
  const routeMedians = new Map<string, number>();
  for (const [route, amounts] of routeAmounts.entries()) {
    if (amounts.length < TRAVEL_FARE_MIN_SAMPLES) continue;
    const mid = medianAmount(amounts);
    if (mid != null) routeMedians.set(route, mid);
  }
  for (const history of routeHistory.values()) {
    history.sort((a, b) => a.at - b.at);
  }

  return list.map((row) => {
    const sla = travelSlaLabel(row) || null;
    if (!isFlightTravelMode(row.travel_mode)) {
      return { ...emptyFareAnnotation(row), sla };
    }
    const route = travelFareRoute(row.from_city, row.to_city);
    const referenceFare = route ? routeMedians.get(route) : undefined;
    const amount = Number(row.amount);
    if (referenceFare == null || !Number.isFinite(amount)) {
      return { ...emptyFareAnnotation(row), sla };
    }
    const deviation = amount - referenceFare;
    const history = route ? routeHistory.get(route) || [] : [];
    const rowId = String(row.id || row.request_id || '');
    const index = history.findIndex((hit) => hit.id === rowId);
    const previous = index > 0 ? history[index - 1] : null;
    const compare = previous ? amount - previous.amount : deviation;
    const fareTrend = compare > 0 ? 'Up' : compare < 0 ? 'Down' : 'Flat';
    return {
      ...row,
      reference_fare: referenceFare,
      policy_deviation_cost: deviation,
      deviation_pct: referenceFare === 0 ? null : deviation / referenceFare,
      sla,
      fare_trend: fareTrend,
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
