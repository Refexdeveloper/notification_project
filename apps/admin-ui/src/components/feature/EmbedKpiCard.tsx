import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, FolderKanban, Layers, Percent, UserCheck, Users, XCircle } from 'lucide-react';
import { displayDashCount } from '@/lib/dashboardEmpty';
import { iconForNeKpi, type NeAppKind } from '@/lib/neKpiIcons';

export type EmbedKpiTheme = {
  bg: string;
  border: string;
  value: string;
  iconBg: string;
  iconColor: string;
  icon: LucideIcon;
  defaultHint?: string;
};

/**
 * Project Tracker DASHBOARD_CARD_GRID — always 4-up on xl.
 * Count is ignored so 3/6 cards stay the same width as 4 (never stretch to 1/3).
 * Reference: /Users/mohamedaasik/Desktop/Cursor/ProjectTracker/src/ProjectDashboardPage.jsx
 */
export const NE_KPI_GRID_CLASS =
  'grid min-w-0 w-full grid-cols-2 items-stretch gap-2.5 sm:gap-4 md:gap-5 xl:grid-cols-4 [&>*]:min-w-0 [&>*]:h-full';

/** Six primary KPIs in one desktop row; mobile stays 2-up. */
export const NE_KPI_PRIMARY_ROW_CLASS =
  'grid min-w-0 w-full grid-cols-2 items-stretch gap-2.5 sm:gap-4 md:gap-5 xl:grid-cols-6 [&>*]:min-w-0 [&>*]:h-full';

/** P2P / Project Tracker section rows — fill the row so leftover 4-up cells are not empty. */
export function neKpiSectionGridClass(count: number) {
  const n = Math.max(1, Number(count) || 0);
  if (n <= 2) {
    return 'grid min-w-0 w-full grid-cols-2 items-stretch gap-2.5 sm:gap-4 md:gap-5 [&>*]:min-w-0 [&>*]:h-full';
  }
  if (n === 3) {
    return 'grid min-w-0 w-full grid-cols-2 items-stretch gap-2.5 sm:gap-4 md:gap-5 xl:grid-cols-3 [&>*]:min-w-0 [&>*]:h-full';
  }
  return NE_KPI_GRID_CLASS;
}

export const NE_KPI_CARD_MIN_H = 'min-h-[96px] lg:min-h-[112px]';

/** @deprecated count is ignored — always returns NE_KPI_GRID_CLASS */
export function neKpiGridClass(_count = 4) {
  return NE_KPI_GRID_CLASS;
}

/** Project Tracker KPI_THEME palette (UserSpecificPT / ProjectDashboardPage). */
export const EMBED_KPI_THEMES: EmbedKpiTheme[] = [
  {
    bg: '#eef4ff',
    border: '#dbe4ff',
    value: '#2B5AED',
    iconBg: '#2B5AED',
    iconColor: '#2B5AED',
    icon: Layers,
  },
  {
    bg: '#fff7ed',
    border: '#fed7aa',
    value: '#F97316',
    iconBg: '#F97316',
    iconColor: '#F97316',
    icon: FolderKanban,
  },
  {
    bg: '#ecfdf5',
    border: '#bbf7d0',
    value: '#22C55E',
    iconBg: '#22C55E',
    iconColor: '#22C55E',
    icon: CheckCircle2,
  },
  {
    bg: '#fff1f2',
    border: '#fecdd3',
    value: '#EF4444',
    iconBg: '#EF4444',
    iconColor: '#EF4444',
    icon: XCircle,
  },
];

export const EMBED_ADOPTION_THEME: EmbedKpiTheme = {
  bg: '#f5f3ff',
  border: '#ddd6fe',
  value: '#8B5CF6',
  iconBg: '#8B5CF6',
  iconColor: '#8B5CF6',
  icon: Percent,
};

export const EMBED_EXEC_KPI_THEMES: EmbedKpiTheme[] = [
  {
    bg: '#eef4ff',
    border: '#dbe4ff',
    value: '#2B5AED',
    iconBg: '#2B5AED',
    iconColor: '#2B5AED',
    icon: Users,
  },
  {
    bg: '#ecfeff',
    border: '#a5f3fc',
    value: '#0084AD',
    iconBg: '#0084AD',
    iconColor: '#0084AD',
    icon: UserCheck,
  },
  {
    bg: '#fff7ed',
    border: '#fed7aa',
    value: '#F97316',
    iconBg: '#F97316',
    iconColor: '#F97316',
    icon: FolderKanban,
  },
  {
    bg: '#ecfdf5',
    border: '#bbf7d0',
    value: '#22C55E',
    iconBg: '#22C55E',
    iconColor: '#22C55E',
    icon: CheckCircle2,
  },
];

type Props = {
  label: string;
  value: number;
  sub?: string;
  suffix?: string;
  styleIndex?: number;
  themes?: EmbedKpiTheme[];
  /** Overrides the theme icon (e.g. calendar for Opened today). */
  icon?: LucideIcon;
  /** Picks a project-specific icon from the label when `icon` is omitted. */
  appKind?: NeAppKind;
  /** Extra text for icon matching (e.g. PM section title) — not shown. */
  iconContext?: string;
  active?: boolean;
  onClick?: () => void;
  /** White card surface (Adoption / Users row). Values and icons keep accent color. */
  surface?: 'themed' | 'white';
};

/**
 * Project Tracker PremiumKPICard (UserSpecificPT) — embed + normal.
 * Label + value left, icon badge right. Inter / slate-400 / themed value.
 */
export default function EmbedKpiCard({
  label,
  value,
  sub,
  suffix,
  styleIndex = 0,
  themes = EMBED_KPI_THEMES,
  icon,
  appKind,
  iconContext,
  active = false,
  onClick,
  surface = 'themed',
}: Props) {
  const theme = themes[styleIndex % themes.length];
  const Icon = icon
    || (appKind ? iconForNeKpi(appKind, `${iconContext || ''} ${label}`, styleIndex) : theme.icon);
  const interactive = Boolean(onClick);
  const whiteSurface = surface === 'white';

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`ne-kpi-card group relative flex h-full w-full min-w-0 ${NE_KPI_CARD_MIN_H} items-start overflow-hidden rounded-xl border p-2.5 text-left sm:rounded-2xl sm:p-3 ${
        whiteSurface ? 'bg-white' : 'bg-gradient-to-br from-white via-white to-slate-50'
      } ${
        interactive ? 'cursor-pointer' : ''
      } ${active ? 'border-[#1E88E5] ring-2 ring-[#1E88E5]/35' : ''}`}
      style={{
        fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        borderColor: active ? undefined : (whiteSurface ? '#e2e8f0' : theme.border),
        backgroundImage: whiteSurface
          ? 'none'
          : `linear-gradient(to bottom right, ${theme.bg}eb, #ffffff 42%, ${theme.bg}b8)`,
        backgroundColor: whiteSurface ? '#ffffff' : undefined,
        boxShadow: whiteSurface
          ? '0 4px 18px rgba(112,144,176,0.12)'
          : '0 10px 28px -14px rgba(15,23,42,0.18)',
      }}
    >
      <div className="relative flex w-full items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 sm:text-[11px] sm:tracking-[0.14em]">
            {label}
          </p>
          <p
            className="mt-1 text-[22px] font-bold leading-none tracking-tight tabular-nums sm:mt-1.5 sm:text-[26px]"
            style={{ color: whiteSurface ? '#0f172a' : theme.value }}
          >
            {displayDashCount(value).toLocaleString('en-IN')}
            {suffix}
          </p>
          {sub ? (
            <p className="mt-1 line-clamp-1 text-[10px] font-medium leading-tight text-slate-400 sm:text-[11px]">
              {sub}
            </p>
          ) : null}
        </div>
        <div
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/90 shadow-sm sm:h-10 sm:w-10 sm:rounded-xl"
          style={{
            backgroundColor: `${theme.iconBg}8c`,
            boxShadow: `0 6px 14px -8px ${theme.iconColor}33`,
          }}
        >
          <Icon className="h-3.5 w-3.5 text-white sm:h-4.5 sm:w-4.5" strokeWidth={2.25} />
        </div>
      </div>
    </div>
  );
}
