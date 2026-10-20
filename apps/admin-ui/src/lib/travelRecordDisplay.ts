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

/** Additive fare-analysis columns. Existing ids/order stay unchanged. */
export const TRAVEL_FARE_COLUMNS: AppRecordColumn[] = [
  { id: 'fare_route', label: 'Route' },
  { id: 'advance_days', label: 'Days ahead' },
  { id: 'over_median_pct', label: 'vs route median' },
  { id: 'fare_check', label: 'Fare check' },
];

const TRAVEL_FARE_POLICY = {
  minAdvanceDays: 7,
  fareCapMultiplier: 1.25,
  minRouteSamples: 3,
};

/** Top KPI table — all processes, no request-only place columns. */
export const TRAVEL_DASH_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'amount', label: 'Booking amount' },
  { id: 'process_id', label: 'Process' },
  ...TRAVEL_TAIL_COLUMNS,
  ...TRAVEL_FARE_COLUMNS,
];

export const TRAVEL_REQUEST_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'trip_type', label: 'Trip type' },
  { id: 'from_city', label: 'From place' },
  { id: 'to_city', label: 'To place' },
  { id: 'travel_mode', label: 'Travel mode' },
  { id: 'amount', label: 'Booking amount' },
  ...TRAVEL_TAIL_COLUMNS,
  ...TRAVEL_FARE_COLUMNS,
];

export const TRAVEL_ADVANCE_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'amount', label: 'Advance amount' },
  { id: 'linked_request_id', label: 'Linked request' },
  ...TRAVEL_TAIL_COLUMNS,
  ...TRAVEL_FARE_COLUMNS,
];

export const TRAVEL_EXPENSE_COLUMNS: AppRecordColumn[] = [
  ...TRAVEL_SHARED_COLUMNS,
  { id: 'expense_type', label: 'Expense type' },
  { id: 'raised_amount', label: 'Raised amount' },
  { id: 'amount', label: 'Claim amount' },
  { id: 'expense_date', label: 'Expense date' },
  ...TRAVEL_TAIL_COLUMNS,
  ...TRAVEL_FARE_COLUMNS,
];

export function travelColumnsForPack(pack: TravelPackKind | null | undefined): AppRecordColumn[] {
  if (pack === 'booking') return TRAVEL_REQUEST_COLUMNS;
  if (pack === 'advance') return TRAVEL_ADVANCE_COLUMNS;
  if (pack === 'expense') return TRAVEL_EXPENSE_COLUMNS;
  return TRAVEL_DASH_COLUMNS;
}

const TRAVEL_ALWAYS_COLUMNS = new Set(TRAVEL_DASH_COLUMNS.map((col) => col.id));
const TRAVEL_REQUEST_ALWAYS = new Set(TRAVEL_REQUEST_COLUMNS.map((col) => col.id));
const TRAVEL_ADVANCE_ALWAYS = new Set(['request_id', 'requested_by', 'assigned_to', 'company_name', 'amount', 'current_step', 'status', 'created_at', 'fare_route', 'advance_days', 'over_median_pct', 'fare_check']);
const TRAVEL_EXPENSE_ALWAYS = new Set(['request_id', 'requested_by', 'assigned_to', 'company_name', 'raised_amount', 'amount', 'current_step', 'status', 'created_at', 'fare_route', 'advance_days', 'over_median_pct', 'fare_check']);

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
    ...travelFareTiles(row),
  ];
}

function travelFareTiles(row: AppRecordRow): Array<{ label: string; value: string }> {
  const check = String(row.fare_check || '').trim();
  if (!check || check === 'n/a') return [];
  return [
    tile('Advance purchase', fareConditionLabel(row.advance_check)),
    tile('Fare cap', fareConditionLabel(row.cap_check)),
    tile('Lowest logical fare', fareConditionLabel(row.lowest_fare_check)),
    tile('Cabin class', fareConditionLabel(row.cabin_check)),
  ];
}

function fareConditionLabel(value: unknown): string {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'n/a') return 'Not evaluated';
  if (text === 'pass') return 'Pass';
  if (text === 'fail') return 'Fail';
  if (text === 'not evaluated') return 'Not evaluated';
  return String(value);
}

export function fareCheckLabel(value: unknown): string {
  const text = String(value || '').trim();
  if (!text || text === 'n/a' || text === '—') return '';
  return text;
}

export function formatOverMedianPct(value: unknown): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const pct = Math.round(n * 100);
  if (pct === 0) return '0%';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

export function fareCheckTone(value: unknown): string {
  const text = String(value || '').toLowerCase();
  if (text === 'compliant') return 'bg-[#E8F7F0] text-[#287B5D] ring-[#CDEBD9]';
  if (text === 'flagged') return 'bg-[#FFF3DF] text-[#A96A20] ring-[#F5E0C0]';
  if (text === 'blocked') return 'bg-[#FCECEF] text-[#B24E66] ring-[#F0D4DB]';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}

function isFlightMode(travelMode: unknown): boolean {
  const text = String(travelMode || '').trim().toLowerCase();
  if (!text) return false;
  if (text.includes('flight')) return true;
  return /(^|[^a-z])air([^a-z]|$)/.test(text);
}

function fareRouteValue(fromCity: unknown, toCity: unknown): string {
  const from = String(fromCity || '').trim().toUpperCase();
  const to = String(toCity || '').trim().toUpperCase();
  if (!from || !to || from === '—' || to === '—') return '';
  return `${from}-${to}`;
}

function wholeDays(later: unknown, earlier: unknown): number | null {
  const a = Date.parse(String(later || ''));
  const b = Date.parse(String(earlier || ''));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((a - b) / 86400000);
}

function median(values: number[]): number | null {
  const sorted = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Same policy as backend travelFareAnalysis. Used when live API has not deployed the fields yet. */
export function annotateTravelFareRows(rows: AppRecordRow[]): AppRecordRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const routeAmounts = new Map<string, number[]>();
  for (const row of list) {
    if (!isFlightMode(row.travel_mode)) continue;
    const route = fareRouteValue(row.from_city, row.to_city);
    if (!route) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const bucket = routeAmounts.get(route) || [];
    bucket.push(amount);
    routeAmounts.set(route, bucket);
  }
  const routeMedians = new Map<string, { median: number | null; samples: number }>();
  for (const [route, amounts] of routeAmounts.entries()) {
    routeMedians.set(route, { median: median(amounts), samples: amounts.length });
  }

  return list.map((row) => {
    if (!isFlightMode(row.travel_mode)) {
      return {
        ...row,
        fare_check: 'n/a',
        fare_flags: [],
        advance_check: 'not evaluated',
        cap_check: 'not evaluated',
        lowest_fare_check: 'not evaluated',
        cabin_check: 'not evaluated',
      };
    }
    const route = fareRouteValue(row.from_city, row.to_city) || undefined;
    const days = wholeDays(row.departure_date, row.created_at);
    const stats = route ? routeMedians.get(route) : undefined;
    const routeMedian = stats && Number.isFinite(Number(stats.median)) ? Number(stats.median) : null;
    const amount = Number(row.amount);
    const overMedianPct = (
      Number.isFinite(amount) && routeMedian != null && routeMedian > 0
        ? (amount - routeMedian) / routeMedian
        : null
    );
    const advanceCheck = days == null
      ? 'not evaluated'
      : (days >= TRAVEL_FARE_POLICY.minAdvanceDays ? 'pass' : 'fail');
    const capCheck = (
      stats && stats.samples >= TRAVEL_FARE_POLICY.minRouteSamples
      && routeMedian != null && Number.isFinite(amount)
    )
      ? (amount <= routeMedian * TRAVEL_FARE_POLICY.fareCapMultiplier ? 'pass' : 'fail')
      : 'not evaluated';
    const flags: string[] = [];
    if (advanceCheck === 'fail') flags.push('Late booking');
    if (capCheck === 'fail') flags.push('Over fare cap');
    let fareCheck = 'Not evaluated';
    if (capCheck === 'fail') fareCheck = 'Blocked';
    else if (advanceCheck === 'fail') fareCheck = 'Flagged';
    else if (advanceCheck === 'pass' || capCheck === 'pass') fareCheck = 'Compliant';
    return {
      ...row,
      fare_route: route,
      advance_days: days,
      route_median: routeMedian,
      over_median_pct: overMedianPct,
      advance_check: advanceCheck,
      cap_check: capCheck,
      lowest_fare_check: 'not evaluated',
      cabin_check: 'not evaluated',
      fare_flags: flags,
      fare_check: fareCheck,
    };
  });
}
