/** Shared executive date-scope helpers (IST). Used by main + app dashboards. */

export type DatePresetId =
  | 'all'
  | 'daily'
  | 'ytd'
  | 'quarterly'
  | 'monthly'
  | 'last_30'
  | 'last_year'
  | 'fy'
  | 'prev_fy'
  | 'year'
  | 'pick_month'
  | 'custom';

export const DATE_PRESETS: Array<{ id: DatePresetId; label: string; hint: string }> = [
  { id: 'all', label: 'All time', hint: 'Current inventory (matches main dashboard when unfiltered)' },
  { id: 'daily', label: 'Today', hint: 'Created or closed today (IST activity)' },
  { id: 'ytd', label: 'YTD', hint: 'Items created since 1 Jan this year' },
  { id: 'quarterly', label: 'QTD', hint: 'Items created this quarter' },
  { id: 'monthly', label: 'MTD', hint: 'Items created this month' },
  { id: 'last_30', label: 'Last 30 days', hint: 'Rolling 30-day created window' },
  { id: 'last_year', label: 'Last year', hint: 'Previous calendar year' },
  { id: 'fy', label: 'This FY', hint: 'Indian FY Apr → today' },
  { id: 'prev_fy', label: 'Previous FY', hint: 'Prior Indian FY Apr → Mar' },
  { id: 'year', label: 'Year', hint: 'Pick a calendar year' },
  { id: 'pick_month', label: 'Month', hint: 'Pick a calendar month' },
  { id: 'custom', label: 'Custom', hint: 'Explicit date range' },
];

export function currentIstYear(): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()),
    );
  } catch {
    return new Date().getFullYear();
  }
}

export function istTodayYmd(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function calendarYearBounds(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function calendarMonthBounds(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const m = String(month).padStart(2, '0');
  return { from: `${year}-${m}-01`, to: `${year}-${m}-${String(lastDay).padStart(2, '0')}` };
}

function quarterStartYmd(todayYmd: string): string {
  const [y, m] = todayYmd.split('-').map(Number);
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qStartMonth).padStart(2, '0')}-01`;
}

function monthStartYmd(todayYmd: string): string {
  const [y, m] = todayYmd.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12));
  return dt.toISOString().slice(0, 10);
}

export function formatExplicitDay(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd || '—';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatExplicitRange(from: string, to: string): string {
  if (from && to) return `${formatExplicitDay(from)} – ${formatExplicitDay(to)}`;
  if (from) return `From ${formatExplicitDay(from)}`;
  if (to) return `Until ${formatExplicitDay(to)}`;
  return 'All time';
}

export type ResolvedDateScope = {
  period: string;
  from?: string;
  to?: string;
};

/** Map UI period + pickers → API query params. */
export function resolveDateScope(input: {
  period: DatePresetId | string;
  calendarYear: number;
  calendarMonth: number;
  dateFrom: string;
  dateTo: string;
}): ResolvedDateScope {
  const { period, calendarYear, calendarMonth, dateFrom, dateTo } = input;
  if (period === 'year') return { period: 'year', ...calendarYearBounds(calendarYear) };
  if (period === 'pick_month') {
    const bounds = calendarMonthBounds(calendarYear, calendarMonth);
    return { period: 'custom', ...bounds };
  }
  if (period === 'custom') return { period: 'custom', from: dateFrom, to: dateTo };
  return { period };
}

export function periodSummaryLabel(
  period: string,
  calendarYear: number,
  calendarMonth: number,
  dateFrom: string,
  dateTo: string,
): string {
  const today = istTodayYmd();
  if (period === 'all') return 'All time · current inventory';
  if (period === 'daily') return `Today · ${formatExplicitDay(today)} (activity IST)`;
  if (period === 'last_30') return formatExplicitRange(addDaysYmd(today, -29), today);
  if (period === 'monthly') return formatExplicitRange(monthStartYmd(today), today);
  if (period === 'quarterly') return formatExplicitRange(quarterStartYmd(today), today);
  if (period === 'ytd') return formatExplicitRange(`${currentIstYear()}-01-01`, today);
  if (period === 'last_year') {
    const y = currentIstYear() - 1;
    return formatExplicitRange(`${y}-01-01`, `${y}-12-31`);
  }
  if (period === 'fy') return 'This financial year (Apr–today)';
  if (period === 'prev_fy') return 'Previous financial year (Apr–Mar)';
  if (period === 'year') return formatExplicitRange(`${calendarYear}-01-01`, `${calendarYear}-12-31`);
  if (period === 'pick_month') {
    const bounds = calendarMonthBounds(calendarYear, calendarMonth);
    return formatExplicitRange(bounds.from, bounds.to);
  }
  if (period === 'custom') return formatExplicitRange(dateFrom, dateTo);
  return period;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
