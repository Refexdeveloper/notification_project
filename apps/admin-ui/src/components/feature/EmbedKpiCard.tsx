import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, FolderKanban, Layers, Percent, UserCheck, Users, XCircle } from 'lucide-react';
import { displayDashCount, formatInr, formatInrExact } from '@/lib/dashboardEmpty';
import { iconForNeKpi, type NeAppKind } from '@/lib/neKpiIcons';
import { NE_TYPE } from '@/lib/neDashType';
import { neKpiClickKind, playNeKpiClickFx } from '@/lib/neKpiClickFx';

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

/** Same floor as the Kissflow CEO cards. Content (bars) sets the visible height. */
export const NE_KPI_CARD_MIN_H = 'min-h-[96px] lg:min-h-[120px]';

/** @deprecated count is ignored — use neKpiBalancedGridClass */
export function neKpiGridClass(_count = 4) {
  return NE_KPI_GRID_CLASS;
}

/** Accent palette — same hues as before; used on icon / chip / bar only. */
export const EMBED_KPI_THEMES: EmbedKpiTheme[] = [
  {
    bg: '#eef4ff',
    border: '#dbe4ff',
    value: '#0F6B7A',
    iconBg: '#0F6B7A',
    iconColor: '#0F6B7A',
    icon: Layers,
  },
  {
    bg: '#fff7ed',
    border: '#fed7aa',
    value: '#F58A2A',
    iconBg: '#F58A2A',
    iconColor: '#F58A2A',
    icon: FolderKanban,
  },
  {
    bg: '#ecfdf5',
    border: '#bbf7d0',
    value: '#14B87A',
    iconBg: '#14B87A',
    iconColor: '#14B87A',
    icon: CheckCircle2,
  },
  {
    bg: '#fff1f2',
    border: '#fecdd3',
    value: '#EF3B4B',
    iconBg: '#EF3B4B',
    iconColor: '#EF3B4B',
    icon: XCircle,
  },
];

export const EMBED_ADOPTION_THEME: EmbedKpiTheme = {
  bg: '#f5f3ff',
  border: '#ddd6fe',
  value: '#138899',
  iconBg: '#138899',
  iconColor: '#138899',
  icon: Percent,
};

export const EMBED_EXEC_KPI_THEMES: EmbedKpiTheme[] = [
  {
    bg: '#eef4ff',
    border: '#dbe4ff',
    value: '#0F6B7A',
    iconBg: '#0F6B7A',
    iconColor: '#0F6B7A',
    icon: Users,
  },
  {
    bg: '#ecfeff',
    border: '#a5f3fc',
    value: '#0F6B7A',
    iconBg: '#0F6B7A',
    iconColor: '#0F6B7A',
    icon: UserCheck,
  },
  {
    bg: '#fff7ed',
    border: '#fed7aa',
    value: '#F58A2A',
    iconBg: '#F58A2A',
    iconColor: '#F58A2A',
    icon: FolderKanban,
  },
  {
    bg: '#ecfdf5',
    border: '#bbf7d0',
    value: '#14B87A',
    iconBg: '#14B87A',
    iconColor: '#14B87A',
    icon: CheckCircle2,
  },
];

const DASH_SCENE: Record<NeAppKind, { soft: string; deep: string; ink: string }> = {
  consolidated: { soft: '#d5e3f8', deep: '#8eafdf', ink: '#ffffff' },
  itsm: { soft: '#7ecfe4', deep: '#3eb4d0', ink: '#ffffff' },
  travel: { soft: '#c5e4ff', deep: '#7eb6ef', ink: '#ffffff' },
  expense: { soft: '#ffe0bf', deep: '#f0b27a', ink: '#fff7ef' },
  solar: { soft: '#ffe7a3', deep: '#f6c453', ink: '#fffdf6' },
  p2p: { soft: '#c9efe8', deep: '#7dcec2', ink: '#ffffff' },
  pm: { soft: '#ddd4fb', deep: '#b7a6ef', ink: '#ffffff' },
  lead: { soft: '#cfeedd', deep: '#8ed4ae', ink: '#ffffff' },
  default: { soft: '#d7dee8', deep: '#aeb8c6', ink: '#ffffff' },
};

/** Decorative wash for one application. Does not cover names or cards. */
export function NeP2pBackdrop({ kind = 'consolidated' }: { kind?: NeAppKind }) {
  const tone = DASH_SCENE[kind] || DASH_SCENE.default;
  return (
    <div className={`ne-p2p-art ne-scene-art-${kind}`} aria-hidden>
    <svg className="h-full w-full" viewBox="0 0 1440 360" preserveAspectRatio="none">
      <circle cx="120" cy="70" r="42" fill={tone.ink} opacity="0.7" />
      <circle cx="1288" cy="84" r="64" fill={tone.soft} opacity="0.7" />
      {kind === 'itsm' ? (
        <>
          <path className="ne-p2p-wave" d="M-40 168 C 180 70, 360 230, 620 130 S 980 40, 1180 120 S 1360 190, 1480 110 V 300 H -40 Z" fill={tone.soft} opacity="0.8" />
          <path className="ne-p2p-wave ne-p2p-wave-2" d="M-40 205 C 220 120, 420 250, 700 170 S 1040 90, 1260 160 S 1400 210, 1480 170 V 320 H -40 Z" fill={tone.deep} opacity="0.45" />
        </>
      ) : null}
      {kind === 'travel' || kind === 'expense' ? (
        <>
          <path className="ne-p2p-wave" d="M-40 168 C 180 70, 360 230, 620 130 S 980 40, 1180 120 S 1360 190, 1480 110 V 300 H -40 Z" fill="#7ecfe4" opacity="0.55" />
          <path className="ne-p2p-wave ne-p2p-wave-2" d="M-40 205 C 220 120, 420 250, 700 170 S 1040 90, 1260 160 S 1400 210, 1480 170 V 320 H -40 Z" fill="#3eb4d0" opacity="0.28" />
        </>
      ) : null}
      {kind === 'solar' ? (
        <circle cx="1240" cy="78" r="36" fill={tone.deep} opacity="0.85" />
      ) : null}
      {kind === 'pm' ? (
        <>
          <rect x="1188" y="90" width="18" height="70" rx="4" fill={tone.deep} opacity="0.7" />
          <rect x="1216" y="58" width="18" height="102" rx="4" fill={tone.deep} opacity="0.5" />
          <rect x="1244" y="74" width="18" height="86" rx="4" fill={tone.deep} opacity="0.8" />
        </>
      ) : null}
      {kind === 'p2p' || kind === 'lead' || kind === 'consolidated' || kind === 'default' ? (
        <path className="ne-p2p-wave" d="M-20 210 C 240 150, 480 250, 760 190 S 1180 120, 1480 200 V 340 H -20 Z" fill={tone.soft} opacity="0.55" />
      ) : null}
    </svg>
    {kind === 'travel' ? (
      <svg viewBox="0 0 280 140" preserveAspectRatio="xMaxYMin meet" className="pointer-events-none absolute right-2 top-2 h-[140px] w-[min(280px,42vw)]">
        <g transform="translate(20 18) scale(2.2)" fill="#3eb4d0" opacity="0.75">
          <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
        </g>
        <g transform="translate(120 62) scale(1.5)" fill="#3eb4d0" opacity="0.4">
          <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
        </g>
        <g transform="translate(190 12) scale(1.7)" fill="#0F6B7A" opacity="0.45">
          <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
        </g>
      </svg>
    ) : null}
    {kind === 'expense' ? (
      <svg viewBox="0 0 280 140" preserveAspectRatio="xMaxYMin meet" className="pointer-events-none absolute right-2 top-2 h-[140px] w-[min(280px,42vw)]">
        <g opacity="0.9">
          <circle cx="54" cy="48" r="22" fill="#ffffff" />
          <text x="54" y="56" textAnchor="middle" fontSize="22" fontWeight="700" fill="#3eb4d0">₹</text>
          <rect x="96" y="28" width="36" height="48" rx="6" fill="#ffffff" />
          <rect x="104" y="40" width="20" height="4" rx="2" fill="#7ecfe4" />
          <rect x="104" y="50" width="14" height="4" rx="2" fill="#7ecfe4" />
          <rect x="104" y="60" width="16" height="4" rx="2" fill="#7ecfe4" />
        </g>
        <g opacity="0.5">
          <circle cx="200" cy="88" r="16" fill="#ffffff" />
          <text x="200" y="94" textAnchor="middle" fontSize="16" fontWeight="700" fill="#0F6B7A">₹</text>
        </g>
      </svg>
    ) : null}
    </div>
  );
}

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
  const showBar = resolvedPercent != null;
  const showShare = resolvedPercent != null && suffix !== '%';
  const runClick = (el: HTMLElement) => {
    playNeKpiClickFx(neKpiClickKind(label), el);
    onClick?.();
  };

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? (event) => runClick(event.currentTarget) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                runClick(e.currentTarget);
              }
            }
          : undefined
      }
      className={`ne-kpi-card group relative flex h-full w-full min-w-0 ${NE_KPI_CARD_MIN_H} flex-col overflow-hidden rounded-2xl border border-white/80 bg-white p-2.5 text-left sm:rounded-[18px] sm:p-3 ${
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
            className="ne-kpi-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-white shadow-sm sm:h-9 sm:w-9 sm:rounded-[11px]"
            style={{
              background: `linear-gradient(135deg, ${theme.iconBg}, ${theme.iconColor})`,
              boxShadow: `0 8px 16px -8px ${theme.iconColor}88`,
            }}
          >
            <Icon className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="ne-kpi-label truncate text-[15px] font-semibold leading-tight text-[#111a28]">
              {label}
            </p>
            {hint ? (
              <p className="ne-kpi-sub mt-0.5 truncate text-[11px] font-medium leading-tight text-[#6B7684]">{hint}</p>
            ) : null}
            {sub && sub !== hint ? (
              <p className="ne-kpi-sub mt-0.5 truncate text-[11px] font-medium leading-tight text-[#6B7684]">{sub}</p>
            ) : null}
          </div>
        </div>

        <div className="ne-kpi-metrics mt-2 flex min-w-0 flex-nowrap items-center justify-between gap-2">
          <div className="ne-kpi-figures flex min-w-0 flex-1 flex-nowrap items-baseline gap-2">
            <p
              className={`shrink-0 ${NE_TYPE.kpiValue}`}
              style={{ color: whiteSurface ? '#0f172a' : '#0e1726' }}
              title={valueFormat === 'inr' ? formatInrExact(value) : undefined}
            >
              {valueFormat === 'inr'
                ? formatInr(value)
                : displayDashCount(value).toLocaleString('en-IN')}
              {suffix}
            </p>
            {showShare ? (
              <p className="ne-kpi-foot min-w-0 truncate text-[10px] font-medium leading-none text-slate-500">
                <i style={{ backgroundColor: theme.iconColor }} />
                <b style={{ color: theme.iconColor }}>{resolvedPercent}%</b>
                <span>
                  {shareOf != null
                    ? ` of ${Number(shareOf).toLocaleString('en-IN')} total`
                    : ' of total'}
                </span>
              </p>
            ) : null}
          </div>
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
