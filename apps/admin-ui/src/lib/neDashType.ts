/**
 * Dashboard type scale — Inter family from the Projects dashboard, readable sizes.
 * Dark grey = titles / KPI labels. Low grey = hints / meta. Values keep accent color.
 * Responsive: mobile stays compact; sm+ steps up. Do not change KPI matchers here.
 */
export const NE_DASH_FONT =
  "Inter, 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

/** Dark grey — card titles, KPI labels, table heads. */
export const NE_INK = 'text-slate-700';
/** Mid grey — body / row labels. */
export const NE_INK_SOFT = 'text-slate-600';
/** Low grey — hints, subtitles, meta. */
export const NE_MUTED = 'text-slate-400';

export const NE_TYPE = {
  pageTitle: 'text-lg font-semibold leading-snug tracking-tight text-slate-800 sm:text-2xl md:text-3xl',
  pageSubtitle: 'text-xs font-medium text-slate-500 sm:text-sm',
  sectionTitle: 'text-sm font-semibold tracking-tight text-slate-800 sm:text-base',
  sectionSubtitle: 'text-xs text-slate-400 sm:text-sm',
  body: 'text-sm text-slate-700',
  meta: 'text-xs font-medium text-slate-400 sm:text-sm',
  label: 'text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600 sm:text-xs sm:tracking-[0.12em]',
  kpiValue: 'ne-kpi-value font-bold tabular-nums leading-none tracking-tight',
  kpiLabel:
    'text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600 sm:text-xs sm:tracking-[0.1em]',
  kpiSub: 'mt-1 line-clamp-2 text-[11px] font-medium leading-tight text-slate-400 sm:text-xs',
  tableHead:
    'bg-gradient-to-b from-[#f1f5f9] to-[#e8edf2] text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate-600',
  tableHeadCell: 'whitespace-nowrap px-3 py-3 sm:px-4',
  tableCell: 'px-3 py-2 align-middle text-sm font-medium leading-none text-slate-700 sm:px-4',
};

export const NE_DASH_CLASS = 'ne-dash';
