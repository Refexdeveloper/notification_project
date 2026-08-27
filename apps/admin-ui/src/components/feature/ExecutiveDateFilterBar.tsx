import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import {
  availableCalendarYears,
  availableIndianFyStartYears,
  availableMonthsForYear,
  calendarMonthBounds,
  currentIndianFyStartYear,
  currentIstMonth,
  currentIstYear,
  currentWeekBoundsIst,
  DATE_PRESETS,
  formatShortDay,
  indianFyBounds,
  istTodayYmd,
  MONTH_NAMES,
  periodSummaryLabel,
  QUICK_DATE_PRESETS,
  weeksInMonth,
  type DatePresetId,
} from '@/lib/executiveDateFilters';

type PeriodTab = 'weekly' | 'monthly' | 'year' | 'custom';

type Props = {
  period: DatePresetId | string;
  onPeriodChange: (period: DatePresetId) => void;
  calendarYear: number;
  onCalendarYearChange: (year: number) => void;
  calendarMonth: number;
  onCalendarMonthChange: (month: number) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  /** Optional entity filter (app dashboard / records). */
  entity?: string;
  onEntityChange?: (entity: string) => void;
  entityOptions?: Array<{ id: string; label: string; count?: number }>;
  entityLabel?: string;
  /** Optional application filter (main dashboard) — rendered top-right. */
  application?: string;
  onApplicationChange?: (id: string) => void;
  applicationOptions?: Array<{ id: string; label: string }>;
  applicationLabel?: string;
  refreshing?: boolean;
  compact?: boolean;
  /** Refexone embed — hide filter hint paragraphs */
  hideHints?: boolean;
};

export const CARD_BORDER = 'rgba(226, 232, 240, 0.9)';
export const MUTED = '#64748b';

const ACCENT = '#0f766e'; // teal-green like reference screenshots

function tabForPeriod(period: string): PeriodTab {
  if (period === 'weekly') return 'weekly';
  if (period === 'pick_month') return 'monthly';
  if (period === 'year' || period === 'fy' || period === 'prev_fy') return 'year';
  if (period === 'custom') return 'custom';
  return 'weekly';
}

export default function ExecutiveDateFilterBar({
  period,
  onPeriodChange,
  calendarYear,
  onCalendarYearChange,
  calendarMonth,
  onCalendarMonthChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  entity,
  onEntityChange,
  entityOptions,
  entityLabel = 'Entity',
  application,
  onApplicationChange,
  applicationOptions,
  applicationLabel = 'Application',
  refreshing,
  hideHints,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PeriodTab>(() => tabForPeriod(period));
  const [browseYear, setBrowseYear] = useState(calendarYear || currentIstYear());
  const [browseMonth, setBrowseMonth] = useState(calendarMonth || currentIstMonth());
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const summary = periodSummaryLabel(period, calendarYear, calendarMonth, dateFrom, dateTo);
  const todayYmd = istTodayYmd();
  const showEntity = Boolean(onEntityChange && entityOptions && entityOptions.length > 1);
  const entityValue = entity || 'all';
  const showApplication = Boolean(onApplicationChange && applicationOptions && applicationOptions.length > 0);
  const applicationValue = application || 'all';

  const weekOptions = useMemo(() => weeksInMonth(browseYear, browseMonth), [browseYear, browseMonth]);
  const monthOptions = useMemo(() => availableMonthsForYear(browseYear), [browseYear]);
  const yearOptions = availableCalendarYears(5);
  const fyOptions = availableIndianFyStartYears(4);
  const currentFyStart = currentIndianFyStartYear();

  useEffect(() => {
    if (!open) return;
    setTab(tabForPeriod(period));
    setBrowseYear(calendarYear || currentIstYear());
    setBrowseMonth(calendarMonth || currentIstMonth());
  }, [open, period, calendarYear, calendarMonth]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPanelPos(null);
      return;
    }
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 320), 448);
      let left = r.left;
      if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
      const top = r.bottom + 8;
      setPanelPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const applyQuick = (id: DatePresetId) => {
    onPeriodChange(id);
    if (id === 'weekly') {
      const w = currentWeekBoundsIst();
      onDateFromChange(w.from);
      onDateToChange(w.to);
    }
    if (id === 'custom' && !dateFrom) {
      onDateFromChange(`${currentIstYear()}-01-01`);
      onDateToChange(istTodayYmd());
    }
    setOpen(false);
  };

  const applyWeek = (from: string, to: string) => {
    onDateFromChange(from);
    onDateToChange(to);
    onPeriodChange('weekly');
    setOpen(false);
  };

  const applyMonth = (year: number, month: number) => {
    onCalendarYearChange(year);
    onCalendarMonthChange(month);
    onPeriodChange('pick_month');
    setOpen(false);
  };

  const applyYear = (year: number) => {
    onCalendarYearChange(year);
    onPeriodChange('year');
    setOpen(false);
  };

  const applyFy = (startYear: number) => {
    if (startYear === currentFyStart) {
      onPeriodChange('fy');
    } else {
      const bounds = indianFyBounds(startYear);
      onDateFromChange(bounds.from);
      onDateToChange(bounds.to);
      onPeriodChange('custom');
    }
    setOpen(false);
  };

  const shiftBrowseMonth = (delta: number) => {
    let m = browseMonth + delta;
    let y = browseYear;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    const maxY = currentIstYear();
    const maxM = currentIstMonth();
    if (y > maxY || (y === maxY && m > maxM)) return;
    if (y < maxY - 4) return;
    setBrowseYear(y);
    setBrowseMonth(m);
  };

  const selectedWeekFrom = period === 'weekly' ? dateFrom || currentWeekBoundsIst().from : '';

  return (
    <div ref={rootRef} className="relative z-30 overflow-visible">
      <div className="flex flex-wrap items-center gap-2.5">
        {showEntity ? (
          <label className="relative inline-flex min-w-[9.5rem] max-w-[14rem] flex-1 sm:flex-none">
            <span className="sr-only">{entityLabel}</span>
            <select
              value={entityValue}
              onChange={(e) => onEntityChange?.(e.target.value)}
              className="h-11 w-full appearance-none rounded-2xl border border-emerald-200/80 bg-white/95 pl-3.5 pr-9 text-sm font-semibold text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.06)] outline-none ring-emerald-100/50 transition hover:border-emerald-300 focus:ring-2"
              style={{ borderColor: 'rgba(16, 185, 129, 0.45)' }}
            >
              {entityOptions!.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                  {typeof opt.count === 'number' && opt.id !== 'all' ? ` (${opt.count})` : ''}
                </option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </label>
        ) : null}

        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="group inline-flex h-11 min-w-[16rem] flex-1 items-center gap-3 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-left shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-md transition hover:border-teal-300 hover:shadow-[0_10px_28px_rgba(15,118,110,0.12)] sm:flex-none sm:min-w-[22rem]"
          aria-expanded={open}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 to-emerald-100 ring-1 ring-teal-100">
            <CalendarDays className="h-4 w-4 text-teal-700" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Period</span>
            <span className="block truncate text-sm font-semibold text-slate-900">{summary}</span>
          </span>
          {refreshing ? (
            <span className="text-[11px] font-medium text-teal-700">Updating…</span>
          ) : (
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
          )}
        </button>

        {showApplication ? (
          <label className="relative ml-auto inline-flex min-w-[11rem] max-w-[18rem] flex-1 sm:flex-none">
            <span className="sr-only">{applicationLabel}</span>
            <select
              value={applicationValue}
              onChange={(e) => onApplicationChange?.(e.target.value)}
              className="h-11 w-full appearance-none rounded-2xl border border-[#D0E0F5] bg-white/95 pl-3.5 pr-9 text-sm font-semibold text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.06)] outline-none transition hover:border-[#3977BE]/40 focus:ring-2 focus:ring-[#EAF2FF]"
            >
              {applicationOptions!.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </label>
        ) : null}
      </div>

      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[200] rounded-3xl border border-[#E6EBF2] bg-white p-4 shadow-[0_2px_8px_rgba(40,60,90,0.08),0_16px_40px_rgba(40,60,90,0.08)]"
              style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
            >
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Choose period type
          </p>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {DATE_PRESETS.filter((p) => QUICK_DATE_PRESETS.includes(p.id)).map((opt) => {
              const active = period === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.hint}
                  onClick={() => applyQuick(opt.id)}
                  className={`h-8 rounded-full px-3 text-[11px] font-semibold transition ${
                    active
                      ? 'bg-[#EAF2FF] text-[#3977BE] shadow-sm ring-1 ring-[#D0E0F5]'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
            {(
              [
                ['weekly', 'Weekly'],
                ['monthly', 'Monthly'],
                ['year', 'Year'],
                ['custom', 'Custom'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`h-9 rounded-xl text-xs font-semibold transition ${
                  tab === id ? 'bg-[#EAF2FF] text-[#3977BE] shadow-sm ring-1 ring-[#D0E0F5]' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'weekly' ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-slate-500">Weeks in month · Mon → Sun</p>
                  <p className="text-[10px] text-slate-400">
                    {weekOptions.length} weeks available · no future weeks
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    onClick={() => shiftBrowseMonth(-1)}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[7.5rem] text-center text-xs font-semibold text-slate-800">
                    {MONTH_NAMES[browseMonth - 1]} {browseYear}
                  </span>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    onClick={() => shiftBrowseMonth(1)}
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
                {weekOptions.map((w) => {
                  const active = selectedWeekFrom === w.from;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => applyWeek(w.from, w.to)}
                      className={`relative w-full rounded-2xl border px-3.5 py-3 text-left transition ${
                        active
                          ? 'border-slate-900 bg-white shadow-sm'
                          : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'
                      }`}
                    >
                      {active ? (
                        <Check className="absolute right-3 top-3 h-4 w-4 text-slate-900" />
                      ) : null}
                      <p className="text-sm font-semibold text-slate-900">{w.label}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {formatShortDay(w.from)} → {w.to === todayYmd ? 'Today' : formatShortDay(w.to)}
                      </p>
                      {w.badge ? (
                        <span
                          className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={{ background: 'rgba(15,118,110,0.12)', color: ACCENT }}
                        >
                          {w.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {!weekOptions.length ? (
                  <p className="py-6 text-center text-xs text-slate-400">No weeks in this month.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === 'monthly' ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-slate-500">Calendar months · January → December</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    onClick={() => setBrowseYear((y) => Math.max(y - 1, currentIstYear() - 4))}
                    aria-label="Previous year"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[3rem] text-center text-xs font-semibold text-slate-800">{browseYear}</span>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    onClick={() => setBrowseYear((y) => Math.min(y + 1, currentIstYear()))}
                    aria-label="Next year"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto overscroll-contain">
                {monthOptions.map((m) => {
                  const bounds = calendarMonthBounds(browseYear, m);
                  const active = period === 'pick_month' && calendarYear === browseYear && calendarMonth === m;
                  const isCurrent = browseYear === currentIstYear() && m === currentIstMonth();
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => applyMonth(browseYear, m)}
                      className={`rounded-2xl border px-3 py-3 text-left transition ${
                        active
                          ? 'border-slate-900 bg-white shadow-sm'
                          : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-900">{MONTH_NAMES[m - 1]}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {isCurrent ? `1 ${MONTH_NAMES[m - 1].slice(0, 3)} → Today` : 'Full month'}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {bounds.from.slice(8)} → {bounds.to.slice(8)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {tab === 'year' ? (
            <div className="max-h-72 space-y-3 overflow-y-auto overscroll-contain">
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-slate-500">
                  Indian financial year · 1 April → 31 March next year
                </p>
                <div className="space-y-2">
                  {fyOptions.map((start) => {
                    const bounds = indianFyBounds(start);
                    const active =
                      (period === 'fy' && start === currentFyStart) ||
                      (period === 'custom' && dateFrom === bounds.from);
                    return (
                      <button
                        key={start}
                        type="button"
                        onClick={() => applyFy(start)}
                        className={`relative w-full rounded-2xl border px-3.5 py-3 text-left transition ${
                          active
                            ? 'border-slate-900 bg-white shadow-sm'
                            : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'
                        }`}
                      >
                        {active ? <Check className="absolute right-3 top-3 h-4 w-4 text-slate-900" /> : null}
                        <p className="text-sm font-semibold text-slate-900">{bounds.label}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          1 Apr {start} → {start === currentFyStart ? 'Today' : `31 Mar ${start + 1}`}
                        </p>
                        {start === currentFyStart ? (
                          <span
                            className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                            style={{ background: 'rgba(15,118,110,0.12)', color: ACCENT }}
                          >
                            Current financial year
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-slate-500">Calendar year</p>
                <div className="grid grid-cols-2 gap-2">
                  {yearOptions.map((y) => {
                    const active = period === 'year' && calendarYear === y;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => applyYear(y)}
                        className={`rounded-2xl border px-3 py-3 text-left transition ${
                          active
                            ? 'border-slate-900 bg-white shadow-sm'
                            : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'
                        }`}
                      >
                        <p className="text-sm font-semibold text-slate-900">{y}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {y === currentIstYear() ? 'Jan → Today' : 'Full year'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'custom' ? (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-slate-500">Explicit date range (IST · capped at today)</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-500">Start</span>
                  <input
                    type="date"
                    max={todayYmd}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                    value={dateFrom || ''}
                    onChange={(e) => onDateFromChange(e.target.value > todayYmd ? todayYmd : e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-500">End</span>
                  <input
                    type="date"
                    max={todayYmd}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                    value={dateTo || ''}
                    onChange={(e) => onDateToChange(e.target.value > todayYmd ? todayYmd : e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!dateFrom) onDateFromChange(`${currentIstYear()}-01-01`);
                  if (!dateTo) onDateToChange(todayYmd);
                  onPeriodChange('custom');
                  setOpen(false);
                }}
                className="h-10 w-full rounded-2xl bg-[#EAF2FF] text-sm font-semibold text-[#3977BE] shadow-sm ring-1 ring-[#D0E0F5] hover:bg-[#DCE8FA]"
              >
                Apply custom range
              </button>
            </div>
          ) : null}
            </div>,
            document.body,
          )
        : null}

      {period !== 'all' && !hideHints ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Counts items <strong>created</strong> in this window (activity dates in IST). Sign-in today is always
          current-day and not changed by this filter.
        </p>
      ) : null}
    </div>
  );
}

export { formatExplicitRange } from '@/lib/executiveDateFilters';
