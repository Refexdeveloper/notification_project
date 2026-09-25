import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, LayoutGrid, Users, X } from 'lucide-react';
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
import NeMobileFilterSheet, {
  NeMobileActiveFilterChips,
  NeMobileFilterField,
  NeMobileFiltersButton,
} from '@/components/feature/NeMobileFilterSheet';

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
  /** Optional entity filter (app dashboard / records) — Refex / Extrovis / Venwind. */
  entity?: string;
  onEntityChange?: (entity: string) => void;
  entityOptions?: Array<{ id: string; label: string; count?: number }>;
  entityLabel?: string;
  /** Optional company filter (29 Refex legal entities, scoped by entity). */
  company?: string;
  onCompanyChange?: (company: string) => void;
  companyOptions?: Array<{ id: string; label: string; count?: number }>;
  companyLabel?: string;
  /** Optional application filter (main dashboard) — rendered top-right. */
  application?: string;
  onApplicationChange?: (id: string) => void;
  applicationOptions?: Array<{ id: string; label: string }>;
  applicationLabel?: string;
  refreshing?: boolean;
  compact?: boolean;
  /** Refexone embed — hide filter hint paragraphs */
  hideHints?: boolean;
  /** Refexone embed shell — reference layout: labels, right-aligned filters, compare toggle */
  embedLayout?: boolean;
  user?: string;
  onUserChange?: (userId: string) => void;
  userOptions?: Array<{ id: string; label: string }>;
  compareEnabled?: boolean;
  onCompareChange?: (enabled: boolean) => void;
  /** Shown to the right of Period so filters stay on one row. */
  onClearFilters?: () => void;
};

export const CARD_BORDER = 'rgba(226, 232, 240, 0.9)';
export const MUTED = '#64748b';

const ACCENT = '#0f766e'; // teal-green (normal mode)
const EMBED_BLUE = '#0f6cbd';
const EMBED_ICON_BG = '#eef3ff';

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
  entityLabel,
  company,
  onCompanyChange,
  companyOptions,
  companyLabel = 'Company',
  application,
  onApplicationChange,
  applicationOptions,
  applicationLabel = 'Application',
  refreshing,
  hideHints,
  embedLayout = false,
  user,
  onUserChange,
  userOptions,
  compareEnabled = false,
  onCompareChange,
  onClearFilters,
}: Props) {
  const resolvedEntityLabel = entityLabel ?? 'Entity';
  const resolvedCompanyLabel = companyLabel ?? 'Company';
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<PeriodTab>(() => tabForPeriod(period));
  const [browseYear, setBrowseYear] = useState(calendarYear || currentIstYear());
  const [browseMonth, setBrowseMonth] = useState(calendarMonth || currentIstMonth());
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const summary = periodSummaryLabel(period, calendarYear, calendarMonth, dateFrom, dateTo);
  const embedSummary =
    embedLayout && period === 'all'
      ? 'All time'
      : embedLayout
        ? summary.split('·')[0]?.trim() || summary
        : summary;
  const todayYmd = istTodayYmd();
  const showEntity = Boolean(onEntityChange && entityOptions && entityOptions.length > 0);
  const entityValue = entity || 'all';
  const showCompany = Boolean(onCompanyChange && companyOptions && companyOptions.length > 0);
  const companyValue = company || 'all';
  const showApplication = Boolean(onApplicationChange && applicationOptions && applicationOptions.length > 0);
  const applicationValue = application || 'all';
  const userValue = user || 'all';
  const entitySelectOptions = useMemo(() => {
    const rows = entityOptions || [];
    if (rows.some((o) => o.id === entityValue)) return rows;
    return [...rows, { id: entityValue, label: entityValue }];
  }, [entityOptions, entityValue]);
  const companySelectOptions = useMemo(() => {
    const rows = companyOptions || [];
    if (rows.some((o) => o.id === companyValue)) return rows;
    return [...rows, { id: companyValue, label: companyValue }];
  }, [companyOptions, companyValue]);
  const userSelectOptions = useMemo(() => {
    const rows = userOptions || [];
    if (rows.some((o) => o.id === userValue)) return rows;
    return [...rows, { id: userValue, label: userValue }];
  }, [userOptions, userValue]);

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

  const showUser = embedLayout
    ? Boolean(onUserChange && userOptions)
  const showUser = embedLayout
    ? Boolean(onUserChange && userOptions)
    : Boolean(onUserChange && userOptions && userOptions.length > 1);

  useEffect(() => {
    triggerRef.current = sheetOpen ? mobileTriggerRef.current : desktopTriggerRef.current;
  }, [sheetOpen, open]);

  const entityLabelText = entitySelectOptions.find((o) => o.id === entityValue)?.label || entityValue;
  const companyLabelText = companySelectOptions.find((o) => o.id === companyValue)?.label || companyValue;
  const userLabelText = userSelectOptions.find((o) => o.id === userValue)?.label || userValue;
  const applicationLabelText = applicationOptions?.find((o) => o.id === applicationValue)?.label || applicationValue;
  const periodIsDefault = period === 'all' || period === 'fy';
  const activeFilterCount = [
    showEntity && entityValue !== 'all',
    showCompany && companyValue !== 'all',
    showUser && userValue !== 'all',
    showApplication && applicationValue !== 'all',
    !periodIsDefault,
  ].filter(Boolean).length;
  const filterChips = [
    showEntity && entityValue !== 'all' ? { key: 'entity', label: entityLabelText, onRemove: () => onEntityChange?.('all') } : null,
    showCompany && companyValue !== 'all' ? { key: 'company', label: companyLabelText, onRemove: () => onCompanyChange?.('all') } : null,
    showUser && userValue !== 'all' ? { key: 'user', label: userLabelText, onRemove: () => onUserChange?.('all') } : null,
    showApplication && applicationValue !== 'all' ? { key: 'app', label: applicationLabelText, onRemove: () => onApplicationChange?.('all') } : null,
    !periodIsDefault ? { key: 'period', label: embedSummary, onRemove: () => onPeriodChange('all') } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; onRemove: () => void }>;

  const clearAllFilters = () => {
    if (onClearFilters) onClearFilters();
    else {
      onEntityChange?.('all');
      onCompanyChange?.('all');
      onUserChange?.('all');
      onApplicationChange?.('all');
      onPeriodChange('all');
    }
    setSheetOpen(false);
    setOpen(false);
  };

  const sheetSelectClass = embedLayout
    ? 'h-11 w-full appearance-none rounded-2xl border border-slate-100 bg-white pl-3.5 pr-8 text-sm font-medium text-slate-700 shadow-[0_4px_18px_rgba(112,144,176,0.12)] outline-none'
    : 'h-11 w-full appearance-none rounded-2xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm font-semibold text-slate-800 outline-none';
    ? 'h-11 w-full min-w-[8.5rem] appearance-none rounded-2xl border border-slate-100 bg-white pl-10 pr-8 text-sm font-medium text-slate-700 shadow-[0_4px_18px_rgba(112,144,176,0.12)] outline-none transition hover:border-[#c7daf5] focus:ring-2 focus:ring-[#dbeafe]'
    : 'h-11 w-full appearance-none rounded-2xl border border-emerald-200/80 bg-white/95 pl-3.5 pr-9 text-sm font-semibold text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.06)] outline-none ring-emerald-100/50 transition hover:border-emerald-300 focus:ring-2';

  const filterLabelClass = embedLayout
    ? 'mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400'
    : 'mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400';

  const embedPeriodBtnClass =
    'group inline-flex h-11 w-full min-w-[8.75rem] items-center gap-2 rounded-2xl border border-slate-100 bg-white px-2.5 text-left shadow-[0_4px_18px_rgba(112,144,176,0.12)] transition hover:border-[#c7daf5] sm:min-w-[10.5rem]';

  const embedIconWrap = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#eef3ff]';

  return (
    <div ref={rootRef} className="relative z-30 overflow-visible">
      <div className={`flex items-end gap-2 ${embedLayout ? 'flex-nowrap justify-end overflow-x-auto pb-0.5' : 'flex-wrap gap-2.5'}`}>
        {showEntity ? (
      <div className="flex w-full flex-col gap-2 lg:hidden">
        <NeMobileFiltersButton count={activeFilterCount} onClick={() => setSheetOpen(true)} />
        <NeMobileActiveFilterChips chips={filterChips} />
      </div>
      <div className={`hidden items-end gap-2 lg:flex ${embedLayout ? 'flex-nowrap justify-end overflow-x-auto pb-0.5' : 'flex-wrap gap-2.5'}`}>
            <span className={filterLabelClass}>{resolvedEntityLabel}</span>
            {embedLayout ? (
              <Building2 className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-[#0f6cbd]" aria-hidden />
            ) : null}
            <select
              value={entityValue}
              onChange={(e) => onEntityChange?.(e.target.value)}
              className={filterSelectClass}
              style={embedLayout ? undefined : { borderColor: 'rgba(16, 185, 129, 0.45)' }}
            >
              {entitySelectOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown
              className={`pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400 ${embedLayout ? 'bottom-3.5' : 'top-1/2 -translate-y-1/2'}`}
            />
          </label>
        ) : null}

        {showCompany ? (
          <label className={`relative inline-flex flex-col ${embedLayout ? 'w-[10.5rem] shrink-0 sm:w-[12rem]' : 'min-w-[11rem] max-w-[16rem] flex-1 sm:flex-none'}`}>
            <span className={filterLabelClass}>{resolvedCompanyLabel}</span>
            {embedLayout ? (
              <Building2 className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-[#0f6cbd]" aria-hidden />
            ) : null}
            <select
              value={companyValue}
              onChange={(e) => onCompanyChange?.(e.target.value)}
              className={filterSelectClass}
              style={embedLayout ? undefined : { borderColor: 'rgba(57, 119, 190, 0.45)' }}
            >
              {companySelectOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown
              className={`pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400 ${embedLayout ? 'bottom-3.5' : 'top-1/2 -translate-y-1/2'}`}
            />
          </label>
        ) : null}

        {showUser ? (
          <label className="relative inline-flex w-[8.75rem] shrink-0 flex-col sm:w-[9.75rem]">
            <span className={filterLabelClass}>User</span>
            <Users className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-[#0f6cbd]" aria-hidden />
            <select
              value={userValue}
              onChange={(e) => onUserChange?.(e.target.value)}
              className={filterSelectClass}
            >
              {userSelectOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute bottom-3.5 right-2.5 h-4 w-4 text-slate-400" />
          </label>
        ) : null}

        {embedLayout && showApplication ? (
          <label className="relative inline-flex w-[8.75rem] shrink-0 flex-col sm:w-[10rem]">
            {embedLayout ? <span className={filterLabelClass}>Application</span> : <span className="sr-only">{applicationLabel}</span>}
            {embedLayout ? (
              <LayoutGrid className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-[#0f6cbd]" aria-hidden />
            ) : null}
            <select
              value={applicationValue}
              onChange={(e) => onApplicationChange?.(e.target.value)}
              className={embedLayout ? filterSelectClass : 'h-11 w-full appearance-none rounded-2xl border border-[#D0E0F5] bg-white/95 pl-3.5 pr-9 text-sm font-semibold text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.06)] outline-none transition hover:border-[#3977BE]/40 focus:ring-2 focus:ring-[#EAF2FF]'}
            >
              {applicationOptions!.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown className={`pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400 ${embedLayout ? 'bottom-3.5' : 'top-1/2 -translate-y-1/2'}`} />
          </label>
        ) : null}

        <div className={embedLayout ? 'inline-flex w-[8.75rem] shrink-0 flex-col sm:w-[11rem]' : 'contents'}>
          {embedLayout ? <span className={filterLabelClass}>Period</span> : null}
        <button
          ref={triggerRef}
          type="button"
          ref={desktopTriggerRef}
          className={
            embedLayout
              ? embedPeriodBtnClass
              : `group inline-flex h-11 min-w-[16rem] flex-1 items-center gap-3 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-left shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-md transition hover:border-teal-300 hover:shadow-[0_10px_28px_rgba(15,118,110,0.12)] sm:flex-none sm:min-w-[22rem]`
          }
          aria-expanded={open}
        >
          <span className={embedLayout ? embedIconWrap : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 to-emerald-100 ring-1 ring-teal-100'}>
            <CalendarDays className={`h-4 w-4 ${embedLayout ? 'text-[#0f6cbd]' : 'text-teal-700'}`} />
          </span>
          <span className="min-w-0 flex-1">
            {!embedLayout ? (
              <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Period</span>
            ) : null}
            <span className={`block truncate ${embedLayout ? 'text-sm font-medium text-slate-700' : 'text-sm font-semibold text-slate-900'}`}>
              {embedLayout ? embedSummary : summary}
            </span>
          </span>
          {refreshing ? (
            <span className="text-[11px] font-medium text-teal-700">Updating…</span>
          ) : (
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
          )}
        </button>
        </div>

        {onClearFilters ? (
          <div className="inline-flex shrink-0 flex-col">
            {embedLayout ? <span className={filterLabelClass} aria-hidden>&nbsp;</span> : null}
            <button
              type="button"
              onClick={onClearFilters}
              className={
                embedLayout
                  ? 'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl border border-slate-100 bg-white px-3 text-xs font-semibold text-slate-700 shadow-[0_4px_18px_rgba(112,144,176,0.12)] transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
                  : 'inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
              }
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          </div>
        ) : null}

        {showApplication && !embedLayout ? (
          <label className={`relative inline-flex flex-col ${embedLayout ? 'min-w-[10.5rem] max-w-[15rem]' : 'ml-auto min-w-[11rem] max-w-[18rem] flex-1 sm:flex-none'}`}>
            {embedLayout ? <span className={filterLabelClass}>Application</span> : <span className="sr-only">{applicationLabel}</span>}
            {embedLayout ? (
              <LayoutGrid className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-[#0f6cbd]" aria-hidden />
            ) : null}
            <select
              value={applicationValue}
              onChange={(e) => onApplicationChange?.(e.target.value)}
              className={embedLayout ? filterSelectClass : 'h-11 w-full appearance-none rounded-2xl border border-[#D0E0F5] bg-white/95 pl-3.5 pr-9 text-sm font-semibold text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.06)] outline-none transition hover:border-[#3977BE]/40 focus:ring-2 focus:ring-[#EAF2FF]'}
            >
              {applicationOptions!.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown className={`pointer-events-none absolute right-3 h-4 w-4 text-slate-400 ${embedLayout ? 'bottom-4' : 'top-1/2 -translate-y-1/2'}`} />
          </label>
        ) : null}
      </div>

      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[200] rounded-3xl border border-[#E6EBF2] bg-white p-4 shadow-[0_2px_8px_rgba(40,60,90,0.08),0_16px_40px_rgba(40,60,90,0.08)]"
              style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
              className="fixed z-[10050] rounded-3xl border border-[#E6EBF2] bg-white p-4 shadow-[0_2px_8px_rgba(40,60,90,0.08),0_16px_40px_rgba(40,60,90,0.08)]"
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
      <NeMobileFilterSheet
        open={sheetOpen}
        title="Dashboard filters"
        onClose={() => setSheetOpen(false)}
        onClear={clearAllFilters}
        onApply={() => setSheetOpen(false)}
      >
        {showEntity ? (
          <NeMobileFilterField label={resolvedEntityLabel}>
            <select value={entityValue} onChange={(e) => onEntityChange?.(e.target.value)} className={sheetSelectClass}>
              {entitySelectOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </NeMobileFilterField>
        ) : null}
        {showCompany ? (
          <NeMobileFilterField label={resolvedCompanyLabel}>
            <select value={companyValue} onChange={(e) => onCompanyChange?.(e.target.value)} className={sheetSelectClass}>
              {companySelectOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </NeMobileFilterField>
        ) : null}
        {showUser ? (
          <NeMobileFilterField label="User">
            <select value={userValue} onChange={(e) => onUserChange?.(e.target.value)} className={sheetSelectClass}>
              {userSelectOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </NeMobileFilterField>
        ) : null}
        {showApplication ? (
          <NeMobileFilterField label={applicationLabel}>
            <select value={applicationValue} onChange={(e) => onApplicationChange?.(e.target.value)} className={sheetSelectClass}>
              {applicationOptions!.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </NeMobileFilterField>
        ) : null}
        <NeMobileFilterField label="Period">
          <button
            ref={mobileTriggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-11 w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-800"
          >
            <span className="min-w-0 truncate">{embedLayout ? embedSummary : summary}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} />
          </button>
        </NeMobileFilterField>
      </NeMobileFilterSheet>

          Counts items <strong>created</strong> in this window (activity dates in IST). Sign-in today is always
          current-day and not changed by this filter.
        </p>
      ) : null}
    </div>
  );
}

export { formatExplicitRange } from '@/lib/executiveDateFilters';
