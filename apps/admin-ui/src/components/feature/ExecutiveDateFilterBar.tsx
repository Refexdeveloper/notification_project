import { CalendarDays, Filter } from 'lucide-react';
import {
  currentIstYear,
  DATE_PRESETS,
  formatExplicitRange,
  istTodayYmd,
  MONTH_NAMES,
  periodSummaryLabel,
  type DatePresetId,
} from '@/lib/executiveDateFilters';

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
  /** Optional entity filter (app dashboard only). */
  entity?: string;
  onEntityChange?: (entity: string) => void;
  entityOptions?: Array<{ id: string; label: string; count?: number }>;
  refreshing?: boolean;
  compact?: boolean;
};

const CARD_BORDER = 'rgba(226, 232, 240, 0.9)';
const MUTED = '#64748b';

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
  refreshing,
  compact,
}: Props) {
  const yearOptions = [currentIstYear(), currentIstYear() - 1, currentIstYear() - 2, currentIstYear() - 3];
  const summary = periodSummaryLabel(period, calendarYear, calendarMonth, dateFrom, dateTo);

  return (
    <div
      className="sticky top-0 z-20 rounded-2xl bg-white/95 p-4 shadow-sm backdrop-blur-md"
      style={{ border: `1px solid ${CARD_BORDER}` }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          <Filter className="h-3.5 w-3.5 text-blue-600" />
          Date scope
          {refreshing ? <span className="normal-case tracking-normal text-sky-600">· refreshing…</span> : null}
        </div>
        <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-800 ring-1 ring-indigo-100">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
          <span className="truncate">{summary}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {DATE_PRESETS.filter((p) => (compact ? !['fy', 'prev_fy', 'custom'].includes(p.id) : true)).map((opt) => {
          const active = period === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              title={opt.hint}
              onClick={() => {
                onPeriodChange(opt.id);
                if (opt.id === 'custom' && !dateFrom) {
                  onDateFromChange(`${currentIstYear()}-01-01`);
                  onDateToChange(istTodayYmd());
                }
              }}
              className={`h-9 rounded-full px-3.5 text-xs font-semibold transition ${
                active
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/25'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/50'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        {onEntityChange && entityOptions?.length ? (
          <label className="ml-auto flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white pl-3 pr-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Entity</span>
            <select
              className="h-7 max-w-[200px] truncate rounded-full border-0 bg-transparent pr-2 text-sm font-medium text-slate-800 outline-none"
              value={entity || 'all'}
              onChange={(e) => onEntityChange(e.target.value)}
            >
              {entityOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {(period === 'year' || period === 'pick_month' || period === 'custom') ? (
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {period === 'year' ? (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Year</span>
            <select
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"
              value={calendarYear}
              onChange={(e) => onCalendarYearChange(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {period === 'pick_month' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-500">Month</span>
              <select
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"
                value={calendarMonth}
                onChange={(e) => onCalendarMonthChange(Number(e.target.value))}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-500">Year</span>
              <select
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"
                value={calendarYear}
                onChange={(e) => onCalendarYearChange(Number(e.target.value))}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {period === 'custom' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-500">Start</span>
              <input
                type="date"
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-500">End</span>
              <input
                type="date"
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
              />
            </label>
          </div>
        ) : null}
      </div>
      ) : null}

      {period !== 'all' ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Filtered view counts items <strong>created</strong> in this window (Kissflow created date). Adoption today is
          always current-day sign-in, not affected by this filter.
        </p>
      ) : null}
    </div>
  );
}

export { formatExplicitRange, CARD_BORDER, MUTED };
