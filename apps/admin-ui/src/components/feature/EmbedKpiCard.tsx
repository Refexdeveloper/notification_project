import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, FolderKanban, Layers, Percent, UserCheck, Users, XCircle } from 'lucide-react';
import { displayDashCount, formatInr, formatInrExact } from '@/lib/dashboardEmpty';
import { iconForNeKpi, type NeAppKind } from '@/lib/neKpiIcons';
import { NE_TYPE } from '@/lib/neDashType';

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
 * Project Tracker DASHBOARD_CARD_GRID — 2-up on mobile.
 * 6+ cards split into two equal rows (10→5+5, 8→4+4, 12→6+6, 6→3+3).
 * 4 cards stay 4-up. 2–3 cards fill the row (no empty right cells).
 * Visual theme: P2P public insights (white card, left icon, share bar).
 */
export const NE_KPI_GRID_CLASS =
  'grid min-w-0 w-full grid-cols-2 items-stretch gap-2.5 sm:gap-4 md:gap-5 lg:grid-cols-4 [&>*]:min-w-0 [&>*]:h-full';

const NE_KPI_LG_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

const NE_KPI_GRID_BASE =
  'grid min-w-0 w-full items-stretch gap-2.5 sm:gap-4 md:gap-5 [&>*]:min-w-0 [&>*]:h-full';

/** Two equal rows when count >= 6; 2–4 fill the row; mobile stays 2-up. */
export function neKpiBalancedGridClass(count: number) {
  const n = Math.max(1, Number(count) || 0);
  if (n <= 4) {
    const lg = NE_KPI_LG_COLS[n] || 'lg:grid-cols-4';
    const mobile = n === 1 ? 'grid-cols-1' : 'grid-cols-2';
    return `${NE_KPI_GRID_BASE} ${mobile} ${lg}`;
  }
  const cols = Math.min(6, Math.max(3, Math.ceil(n / 2)));
  const lg = NE_KPI_LG_COLS[cols] || 'lg:grid-cols-4';
  return `${NE_KPI_GRID_BASE} grid-cols-2 ${lg}`;
}

/** Six primary KPIs in two rows of three on xl; mobile stays 2-up. */
export const NE_KPI_PRIMARY_ROW_CLASS = neKpiBalancedGridClass(6);

/** Section rows share the same 2-up mobile / balanced-desktop rule as the main KPI grid. */
export function neKpiSectionGridClass(count: number) {
  return neKpiBalancedGridClass(count);
}

/** Tall enough for left icon + value + optional share bar (P2P insights). */
export const NE_KPI_CARD_MIN_H = 'min-h-[128px] lg:min-h-[148px]';

/** @deprecated count is ignored — use neKpiBalancedGridClass */
export function neKpiGridClass(_count = 4) {
  return NE_KPI_GRID_CLASS;
}

/** Accent palette — same hues as before; used on icon / chip / bar only. */
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

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Display-only share. Never used as a KPI matcher. */
export function kpiSharePercent(value: number, shareOf?: number, percent?: number) {
  if (percent != null && Number.isFinite(percent)) return clampPct(percent);
  if (shareOf != null && shareOf > 0) return clampPct((Number(value) / shareOf) * 100);
  return null;
}

function percentFromSub(sub?: string) {
  const hit = String(sub || '').match(/(\d+(?:\.\d+)?)\s*%/);
  if (!hit) return null;
  return clampPct(Number(hit[1]));
}

type Props = {
  label: string;
  value: number;
  sub?: string;
  /** Small line under the title (period, status hint). */
  hint?: string;
  suffix?: string;
  /** `inr` shows ₹ rounded Indian grouping; default is a plain count. */
  valueFormat?: 'count' | 'inr';
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
  /** White card surface (Adoption / Users row). Values stay dark; accents stay on icon/bar. */
  surface?: 'themed' | 'white';
  /** Explicit 0–100 share for the chip / bar. */
  percent?: number;
  /** Denominator for a decorative share-of-total bar. Display only. */
  shareOf?: number;
};

/**
 * P2P public-insights card — embed + normal.
 * Left pastel icon, dark value, optional share chip + bar.
 * onClick stays immediate; no tilt / count-up / delayed navigation.
 */
export default function EmbedKpiCard({
  label,
  value,
  sub,
  hint,
  suffix,
  valueFormat = 'count',
  styleIndex = 0,
  themes = EMBED_KPI_THEMES,
  icon,
  appKind,
  iconContext,
  active = false,
  onClick,
  surface = 'themed',
  percent,
  shareOf,
}: Props) {
  const theme = themes[styleIndex % themes.length];
  const Icon = icon
    || (appKind ? iconForNeKpi(appKind, `${iconContext || ''} ${label}`, styleIndex) : theme.icon);
  const interactive = Boolean(onClick);
  const whiteSurface = surface === 'white';
  const resolvedPercent =
    kpiSharePercent(value, shareOf, percent)
    ?? (suffix === '%' ? clampPct(value) : null)
    ?? percentFromSub(sub);
  const showChip = resolvedPercent != null && suffix !== '%';
  const showBar = resolvedPercent != null;
  const foot =
    sub
    || (resolvedPercent != null && shareOf != null && suffix !== '%'
      ? `${resolvedPercent}% of total`
      : undefined);

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
      className={`ne-kpi-card group relative flex h-full w-full min-w-0 ${NE_KPI_CARD_MIN_H} flex-col overflow-hidden rounded-2xl border border-white/80 bg-white p-3 text-left sm:rounded-[18px] sm:p-3.5 ${
        interactive ? 'cursor-pointer' : ''
      } ${active ? 'ne-kpi-card-active' : ''}`}
      style={{
        '--ne-kpi-accent': theme.iconColor,
        '--ne-kpi-soft': theme.bg,
        '--i': styleIndex,
        boxShadow: active
          ? `0 0 0 2px ${theme.iconColor}33, 0 14px 28px -16px ${theme.iconColor}66`
          : '0 8px 24px -12px rgba(15, 23, 42, 0.12)',
      } as CSSProperties}
    >
      <span className="ne-kpi-shine" />
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 100% 0%, ${theme.bg}cc 0%, rgba(255,255,255,0) 55%)`,
        }}
      />
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <div className="flex items-start gap-2.5">
          <div
            className="ne-kpi-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-white shadow-sm sm:h-10 sm:w-10 sm:rounded-[13px]"
            style={{
              background: `linear-gradient(135deg, ${theme.iconBg}, ${theme.iconColor})`,
              boxShadow: `0 8px 16px -8px ${theme.iconColor}88`,
            }}
          >
            <Icon className="h-4 w-4 text-white sm:h-[18px] sm:w-[18px]" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[13px] font-semibold leading-tight text-slate-800 sm:text-sm">
              {label}
            </p>
            {hint ? (
              <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{hint}</p>
            ) : null}
          </div>
          {showChip ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-[11px] font-semibold tabular-nums sm:text-xs"
              style={{ color: theme.iconColor }}
              title="Share of total"
            >
              <i
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: theme.iconColor }}
              />
              {resolvedPercent}%
            </span>
          ) : null}
        </div>

        <div className="mt-3 min-w-0 sm:mt-3.5">
          <p
            className={`min-w-0 ${NE_TYPE.kpiValue}`}
            style={{ color: whiteSurface ? '#0f172a' : '#0e1726' }}
            title={valueFormat === 'inr' ? formatInrExact(value) : undefined}
          >
            {valueFormat === 'inr'
              ? formatInr(value)
              : displayDashCount(value).toLocaleString('en-IN')}
            {suffix}
          </p>
          {foot ? (
            <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-tight text-slate-400 sm:text-xs">
              {foot}
            </p>
          ) : null}
        </div>

        {showBar ? (
          <div className="ne-kpi-progress mt-auto flex items-center gap-2 pt-3">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span
                className="ne-kpi-progress-fill block h-full rounded-full"
                style={{
                  width: `${resolvedPercent}%`,
                  background: `linear-gradient(90deg, ${theme.iconBg}, ${theme.iconColor})`,
                }}
              />
            </div>
            <em
              className="min-w-[2rem] text-right text-[11px] font-semibold not-italic tabular-nums text-slate-400"
            >
              {resolvedPercent}%
            </em>
          </div>
        ) : (
          <div className="mt-auto" />
        )}
      </div>
    </div>
  );
}
