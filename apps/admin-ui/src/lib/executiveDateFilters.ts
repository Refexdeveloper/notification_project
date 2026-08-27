/** Shared executive date-scope helpers (IST). Used by main + app dashboards + records. */

export type DatePresetId =
  | 'daily'
  | 'fy'
  | 'ytd'
  | 'quarterly'
  | 'monthly'
  | 'weekly'
  | 'last_30'
  | 'year'
  | 'pick_month'
  | 'prev_fy'
  | 'last_year'
  | 'custom'
  | 'all'; // kept for API/back-compat; hidden from CEO filter bar

/** Visible CEO presets (order). Last year removed. */
export const DATE_PRESETS: Array<{ id: DatePresetId; label: string; hint: string }> = [
  { id: 'daily', label: 'Today', hint: 'Created or closed today (IST activity)' },
  { id: 'fy', label: 'This FY', hint: 'Indian FY Apr → today (default executive scope)' },
  { id: 'weekly', label: 'Weekly', hint: 'Pick a Mon–Sun week' },
  { id: 'monthly', label: 'MTD', hint: 'Items created this month' },
  { id: 'quarterly', label: 'QTD', hint: 'Items created this quarter' },
  { id: 'pick_month', label: 'Month', hint: 'Pick a calendar month' },
  { id: 'year', label: 'Year', hint: 'Pick a calendar year' },
  { id: 'custom', label: 'Custom', hint: 'Explicit date range' },
];

/** Quick chips shown above the Week/Month/Year/Custom tabs. */
export const QUICK_DATE_PRESETS: DatePresetId[] = ['daily', 'fy', 'monthly', 'quarterly'];

/** Default date scope for CEO dashboards. */
export const DEFAULT_DATE_PRESET: DatePresetId = 'fy';

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

export function currentIstMonth(): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(new Date()),
    );
  } catch {
    return new Date().getMonth() + 1;
  }
}

/** Cap a YYYY-MM-DD at today (IST) — never allow future window ends. */
export function minYmd(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

export function maxYmd(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function calendarYearBounds(year: number): { from: string; to: string } {
  const today = istTodayYmd();
  const y = currentIstYear();
  const to = year >= y ? today : `${year}-12-31`;
  return { from: `${year}-01-01`, to: minYmd(to, today) };
}

export function calendarMonthBounds(year: number, month: number): { from: string; to: string } {
  const today = istTodayYmd();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const m = String(month).padStart(2, '0');
  const from = `${year}-${m}-01`;
  const monthEnd = `${year}-${m}-${String(lastDay).padStart(2, '0')}`;
  return { from, to: minYmd(monthEnd, today) };
}

/** Months 1–12 available for a year (no future months in the current IST year). */
export function availableMonthsForYear(year: number): number[] {
  const y = currentIstYear();
  const m = currentIstMonth();
  if (year < y) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (year > y) return [];
  return Array.from({ length: m }, (_, i) => i + 1);
}

/** Calendar years that may appear in pickers (never future years). */
export function availableCalendarYears(span = 4): number[] {
  const y = currentIstYear();
  return Array.from({ length: span }, (_, i) => y - i);
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

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12));
  return dt.toISOString().slice(0, 10);
}

/** Monday (IST calendar) of the week containing ymd. */
export function mondayOfWeekContaining(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  // getUTCDay: 0=Sun … 6=Sat → offset back to Monday
  const dow = dt.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDaysYmd(ymd.slice(0, 10), -back);
}

export function currentWeekBoundsIst(): { from: string; to: string } {
  const today = istTodayYmd();
  const from = mondayOfWeekContaining(today);
  return { from, to: today };
}

export type WeekOption = {
  id: string;
  label: string;
  from: string;
  to: string;
  badge?: string;
  isCurrent?: boolean;
  isPrevious?: boolean;
};

/** Mon–Sun weeks that intersect a calendar month (no future weeks). */
export function weeksInMonth(year: number, month: number): WeekOption[] {
  const today = istTodayYmd();
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const current = currentWeekBoundsIst();
  const prevFrom = addDaysYmd(current.from, -7);
  const prevTo = addDaysYmd(current.from, -1);

  const weeks: WeekOption[] = [];
  let cursor = mondayOfWeekContaining(monthStart);
  // Walk forward while week start is on/before month end and not after today
  while (cursor <= monthEnd && cursor <= today) {
    const weekEndFull = addDaysYmd(cursor, 6);
    const to = minYmd(weekEndFull, today);
    // Keep weeks that overlap this month
    if (to >= monthStart && cursor <= monthEnd) {
      const isCurrent = cursor === current.from;
      const isPrevious = cursor === prevFrom;
      const weekNum = weeks.length + 1;
      weeks.push({
        id: cursor,
        label: isCurrent ? 'Current week' : isPrevious ? 'Previous week' : `Week ${weekNum}`,
        from: cursor,
        to,
        badge: isCurrent ? 'THIS WEEK' : isPrevious ? 'LAST WEEK' : undefined,
        isCurrent,
        isPrevious,
      });
    }
    cursor = addDaysYmd(cursor, 7);
  }
  // Newest first (like the reference UI)
  return weeks.reverse();
}

/** Indian FY label helpers. startYear = calendar year of April start. */
export function indianFyBounds(startYear: number): { from: string; to: string; label: string } {
  const today = istTodayYmd();
  const from = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  return {
    from,
    to: minYmd(end, today),
    label: `FY ${startYear}–${String(startYear + 1).slice(2)}`,
  };
}

export function currentIndianFyStartYear(todayYmd = istTodayYmd()): number {
  const [y, m] = todayYmd.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export function availableIndianFyStartYears(span = 4): number[] {
  const cur = currentIndianFyStartYear();
  return Array.from({ length: span }, (_, i) => cur - i);
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

export function formatShortDay(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd || '—';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
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
  const today = istTodayYmd();
  const { period, calendarYear, calendarMonth, dateFrom, dateTo } = input;
  if (period === 'daily') return { period: 'daily', from: today, to: today };
  if (period === 'monthly') return { period: 'monthly', from: monthStartYmd(today), to: today };
  if (period === 'quarterly') return { period: 'quarterly', from: quarterStartYmd(today), to: today };
  if (period === 'year') return { period: 'year', ...calendarYearBounds(calendarYear) };
  if (period === 'pick_month') {
    const bounds = calendarMonthBounds(calendarYear, calendarMonth);
    if (bounds.from > today) return { period: 'custom', from: today, to: today };
    return { period: 'custom', ...bounds };
  }
  if (period === 'weekly') {
    if (dateFrom && dateTo) {
      return { period: 'custom', from: dateFrom, to: minYmd(dateTo, today) };
    }
    const week = currentWeekBoundsIst();
    return { period: 'custom', from: week.from, to: week.to };
  }
  if (period === 'custom') {
    const from = dateFrom || today;
    const to = minYmd(dateTo || today, today);
    return { period: 'custom', from: minYmd(from, to), to };
  }
  if (period === 'prev_fy') {
    const start = currentIndianFyStartYear() - 1;
    const bounds = indianFyBounds(start);
    return { period: 'custom', from: bounds.from, to: bounds.to };
  }
  if (period === 'fy') {
    const start = currentIndianFyStartYear();
    const bounds = indianFyBounds(start);
    return { period: 'fy', from: bounds.from, to: bounds.to };
  }
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
  if (period === 'daily') return `Today · ${formatExplicitDay(today)}`;
  if (period === 'weekly') {
    if (dateFrom && dateTo) {
      const cur = currentWeekBoundsIst();
      if (dateFrom === cur.from) return `Current week · ${formatShortDay(dateFrom)} → Today`;
      return `${formatShortDay(dateFrom)} → ${formatShortDay(dateTo)}`;
    }
    const w = currentWeekBoundsIst();
    return `Current week · ${formatShortDay(w.from)} → Today`;
  }
  if (period === 'last_30') return formatExplicitRange(addDaysYmd(today, -29), today);
  if (period === 'monthly') return `MTD · ${formatExplicitRange(monthStartYmd(today), today)}`;
  if (period === 'quarterly') return `QTD · ${formatExplicitRange(quarterStartYmd(today), today)}`;
  if (period === 'ytd') return formatExplicitRange(`${currentIstYear()}-01-01`, today);
  if (period === 'last_year') {
    const y = currentIstYear() - 1;
    return formatExplicitRange(`${y}-01-01`, `${y}-12-31`);
  }
  if (period === 'fy') {
    const start = currentIndianFyStartYear();
    return `FY ${start}–${String(start + 1).slice(2)} · Apr–today`;
  }
  if (period === 'prev_fy') {
    const start = currentIndianFyStartYear() - 1;
    return indianFyBounds(start).label;
  }
  if (period === 'year') return `Year ${calendarYear}`;
  if (period === 'pick_month') {
    const bounds = calendarMonthBounds(calendarYear, calendarMonth);
    return `${MONTH_NAMES[calendarMonth - 1]} ${calendarYear}`;
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
