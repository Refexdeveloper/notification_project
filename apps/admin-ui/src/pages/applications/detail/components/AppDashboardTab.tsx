import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  Globe2,
  IndianRupee,
  Layers,
  Loader2,
  Mail,
  MessageCircle,
  Percent,
  Smartphone,
  Sparkles,
  Users,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { isBackendApiMode } from '@/services/backendApi';
import {
  appDashboardQueryKey,
  loadApplicationDashboard,
  readAppDashboardCache,
  refreshApplicationDashboardLive,
  type AppDashboardData,
} from '@/services/appDashboardApi';
import type { KissflowApplication } from '@/mocks/applications';
import ExecutiveDateFilterBar, { CARD_BORDER, MUTED } from '@/components/feature/ExecutiveDateFilterBar';
import DashboardLoadingOverlay from '@/components/feature/DashboardLoadingOverlay';
import UserWorkExpandPanel from '@/components/feature/UserWorkExpandPanel';
import {
  currentIstYear,
  istTodayYmd,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';

type Props = {
  app: KissflowApplication;
  /** Refexone embed shell — hide hints and extra metadata */
  embed?: boolean;
  /** Bumped by parent header Refresh — forces live refresh for this tab. */
  refreshNonce?: number;
  onRefreshingChange?: (busy: boolean) => void;
};

const CHART_GRID = '#e2e8f0';
const OPEN_COLOR = '#D4A574';
const CLOSED_COLOR = '#5BA88A';
const REJECTED_COLOR = '#C97B8C';

const KPI_STYLES = [
  { bg: '#EAF3FF', text: '#1E3A5F', muted: '#5B7A9D', iconBg: '#D6E8FF', iconColor: '#3977BE', icon: Layers },
  { bg: '#FFF2E4', text: '#7A4A1A', muted: '#A96A20', iconBg: '#FFE8CC', iconColor: '#A96A20', icon: FolderKanban },
  { bg: '#E8F7F1', text: '#1F5C45', muted: '#287B5D', iconBg: '#D3EFE3', iconColor: '#287B5D', icon: CheckCircle2 },
  { bg: '#FDECEF', text: '#7A3044', muted: '#B24E66', iconBg: '#F8D9E0', iconColor: '#B24E66', icon: XCircle },
] as const;

const SOURCE_META: Record<
  string,
  { color: string; bg: string; icon: typeof Mail; hint: string }
> = {
  Email: { color: '#3977BE', bg: 'from-[#EAF3FF] to-[#EEF3FA]', icon: Mail, hint: 'Inbox / mail' },
  WhatsApp: { color: '#287B5D', bg: 'from-[#E8F7F1] to-[#EDF8F3]', icon: MessageCircle, hint: 'WhatsApp' },
  Mobile: { color: '#5B4B9A', bg: 'from-[#F0EDFF] to-[#F3EFFC]', icon: Smartphone, hint: 'Mobile app' },
  Web: { color: '#2A7A8A', bg: 'from-[#E8F6F8] to-[#EEF8FA]', icon: Globe2, hint: 'Web portal' },
  Other: { color: '#64748b', bg: 'from-slate-100 to-slate-50', icon: Layers, hint: 'Other' },
};

const CATEGORY_COLORS: Record<string, string> = {
  Operation: '#5B9BD5',
  Finance: '#D4A574',
};

function closureRatioPct(open: number, closed: number): number {
  const den = open + closed;
  return den > 0 ? Math.round((closed / den) * 1000) / 10 : 0;
}

function sortByClosedDesc<T extends { open?: number; closed?: number; pending?: number; completed?: number; total?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ac = Number(a.closed ?? a.completed ?? 0);
    const bc = Number(b.closed ?? b.completed ?? 0);
    if (bc !== ac) return bc - ac;
    const ao = Number(a.open ?? a.pending ?? 0);
    const bo = Number(b.open ?? b.pending ?? 0);
    if (bo !== ao) return bo - ao;
    return Number(b.total || 0) - Number(a.total || 0);
  });
}

function sortByClosureRatio<T extends { open?: number; closed?: number; pending?: number; completed?: number; total?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ao = Number(a.open ?? a.pending ?? 0);
    const ac = Number(a.closed ?? a.completed ?? 0);
    const bo = Number(b.open ?? b.pending ?? 0);
    const bc = Number(b.closed ?? b.completed ?? 0);
    const ra = closureRatioPct(ao, ac);
    const rb = closureRatioPct(bo, bc);
    if (rb !== ra) return rb - ra;
    return Number(b.total || 0) - Number(a.total || 0);
  });
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatInr(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '₹0';
  if (value >= 1_00_00_000) {
    return `₹${(value / 1_00_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  }
  if (value >= 1_00_000) {
    return `₹${(value / 1_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  }
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function formatInrFull(value: number): string {
  if (!Number.isFinite(value)) return '₹0';
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function DashboardCard({
  title,
  children,
  className = '',
  right,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl bg-white p-5 shadow-sm ${className}`}
      style={{ border: `1px solid ${CARD_BORDER}` }}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {right}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  styleIndex = 0,
  delta,
}: {
  label: string;
  value: number;
  sub?: string;
  styleIndex?: number;
  delta?: number | null;
}) {
  const style = KPI_STYLES[styleIndex % KPI_STYLES.length];
  const Icon = style.icon;
  const deltaText =
    delta == null || !Number.isFinite(delta)
      ? null
      : delta === 0
        ? '±0 vs compare'
        : `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-IN')} vs compare`;
  return (
    <div
      className="relative min-w-0 overflow-hidden rounded-2xl p-5 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#E6EBF2]"
      style={{ background: style.bg }}
    >
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: style.muted }}>
            {label}
          </p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums" style={{ color: style.text }}>
            {value.toLocaleString('en-IN')}
          </p>
          {sub ? (
            <p className="mt-2 text-sm font-semibold" style={{ color: style.muted }}>
              {sub}
            </p>
          ) : null}
          {deltaText ? (
            <p
              className="mt-1 text-[11px] font-medium"
              style={{ color: delta != null && delta < 0 ? '#B24E66' : '#287B5D' }}
            >
              {deltaText}
            </p>
          ) : null}
        </div>
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-black/5"
          style={{ background: style.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: style.iconColor }} />
        </div>
      </div>
    </div>
  );
}

function SourceIconReport({
  rows,
  total,
}: {
  rows: Array<{ name: string; value: number }>;
  total: number;
}) {
  if (!rows.length) {
    return <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-slate-400">No source data</div>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((row) => {
        const meta = SOURCE_META[row.name] || SOURCE_META.Other;
        const Icon = meta.icon;
        const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
        return (
          <div
            key={row.name}
            className="relative overflow-hidden rounded-xl border border-slate-100 bg-slate-50/80 p-3"
          >
            <div
              className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${meta.bg} shadow-sm ring-1 ring-[#E6EBF2]`}
              style={{ color: meta.color }}
            >
              <Icon className="h-4 w-4" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{row.name}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{row.value.toLocaleString('en-IN')}</p>
            <p className="text-[11px] text-slate-500">{pct}%</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(6, (row.value / max) * 100)}%`, background: meta.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SourceComposedChart({ rows }: { rows: Array<{ name: string; value: number }> }) {
  if (!rows.length) {
    return <div className="flex h-full min-h-[140px] items-center justify-center text-sm text-slate-400">No source data</div>;
  }
  const chartData = rows.map((r) => ({
    name: r.name,
    tickets: r.value,
    fill: (SOURCE_META[r.name] || SOURCE_META.Other).color,
  }));
  return (
    <div className="h-[168px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: MUTED }} />
          <YAxis tick={{ fontSize: 11, fill: MUTED }} allowDecimals={false} width={36} />
          <Tooltip
            formatter={(v) => [Number(v).toLocaleString('en-IN'), 'Tickets']}
            contentStyle={{ borderRadius: 12, border: `1px solid ${CARD_BORDER}`, fontSize: 12 }}
          />
          <Bar dataKey="tickets" name="Tickets" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={false}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} fillOpacity={0.85} />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="tickets"
            name="Trend"
            stroke="#1e293b"
            strokeWidth={2}
            dot={{ r: 3.5, strokeWidth: 2, fill: '#fff', stroke: '#1e293b' }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PortfolioBand({
  title,
  hint,
  total,
  open,
  closed,
  totalLabel = 'Total',
  openLabel = 'In Progress',
  closedLabel = 'Completed',
}: {
  title: string;
  hint: string;
  total: number;
  open: number;
  closed: number;
  totalLabel?: string;
  openLabel?: string;
  closedLabel?: string;
}) {
  const cells = [
    { label: totalLabel, value: total, tone: 'text-slate-900 bg-slate-50 border-slate-200' },
    { label: openLabel, value: open, tone: 'text-amber-900 bg-amber-50 border-amber-200' },
    { label: closedLabel, value: closed, tone: 'text-emerald-900 bg-emerald-50 border-emerald-200' },
  ];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className={`rounded-xl border px-3 py-3 text-center ${c.tone}`}>
            <p className="text-xl font-bold tabular-nums">{c.value.toLocaleString('en-IN')}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type P2pDocRow = {
  key: string;
  title: string;
  hint: string;
  total: number;
  open: number;
  closed: number;
  rejected: number;
  amountTotal: number;
  amountOpen: number;
};

function P2pDocBand({ row }: { row: P2pDocRow }) {
  const amountClosed = Math.max(0, row.amountTotal - row.amountOpen);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{row.title}</h4>
          {row.hint ? <p className="mt-0.5 text-[11px] text-slate-500">{row.hint}</p> : null}
        </div>
        <div className="rounded-xl bg-[#EEF3FF] px-3 py-2 text-right text-slate-800 ring-1 ring-[#D7E2EF]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5B7A9D]">Total value</p>
          <p className="text-lg font-bold tabular-nums text-slate-900">{formatInr(row.amountTotal)}</p>
          <p className="text-[10px] text-slate-500">{formatInrFull(row.amountTotal)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Documents', value: row.total, tone: 'text-slate-900 bg-[#EAF3FF] border-[#D7E2EF]' },
          { label: 'Open', value: row.open, tone: 'text-[#A96A20] bg-[#FFF3DF] border-[#F5E0C0]' },
          { label: 'Closed', value: row.closed, tone: 'text-[#287B5D] bg-[#E8F7F0] border-[#CDEBD9]' },
          { label: 'Rejected', value: row.rejected, tone: 'text-[#B24E66] bg-[#FCECEF] border-[#F0D4DB]' },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl border px-3 py-3 text-center ${c.tone}`}>
            <p className="text-xl font-bold tabular-nums">{c.value.toLocaleString('en-IN')}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">{c.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Open pipeline</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-amber-950">{formatInr(row.amountOpen)}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Closed / approved value</p>
          <p className="mt-0.5 text-base font-bold tabular-nums text-emerald-950">{formatInr(amountClosed)}</p>
        </div>
      </div>
    </div>
  );
}

function P2pDocStatusChart({ row }: { row: P2pDocRow }) {
  const chart = [
    { name: 'Open', value: row.open, color: OPEN_COLOR },
    { name: 'Closed', value: row.closed, color: CLOSED_COLOR },
    { name: 'Rejected', value: row.rejected, color: REJECTED_COLOR },
  ].filter((entry) => entry.value > 0);

  return (
    <DashboardCard title={`${row.title} · status`}>
      <div className="relative h-[220px]">
        {chart.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">No status data</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chart} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}>
                  {chart.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => Number(v).toLocaleString('en-IN')} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</p>
              <p className="text-xl font-bold tabular-nums text-slate-900">{row.total.toLocaleString('en-IN')}</p>
              <p className="text-[10px] font-medium text-slate-500">{formatInr(row.amountTotal)}</p>
            </div>
          </>
        )}
      </div>
    </DashboardCard>
  );
}

function P2pAmountKpiCard({
  label,
  value,
  sub,
  styleIndex = 0,
}: {
  label: string;
  value: number;
  sub?: string;
  styleIndex?: number;
}) {
  const accents = ['#EEF3FA', '#FFF2E4', '#E8F7F1'] as const;
  const texts = ['#1E3A5F', '#7A4A1A', '#1F5C45'] as const;
  const muted = ['#5B7A9D', '#A96A20', '#287B5D'] as const;
  const bg = accents[styleIndex % accents.length];
  const text = texts[styleIndex % texts.length];
  const mute = muted[styleIndex % muted.length];
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#E6EBF2]"
      style={{ background: bg }}
    >
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: mute }}>
            {label}
          </p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums" style={{ color: text }}>
            {formatInr(value)}
          </p>
          {sub ? (
            <p className="mt-2 text-sm font-semibold" style={{ color: mute }}>
              {sub}
            </p>
          ) : null}
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/70 ring-1 ring-[#E6EBF2]">
          <IndianRupee className="h-5 w-5" style={{ color: text }} />
        </div>
      </div>
    </div>
  );
}

export default function AppDashboardTab({ app, embed = false, refreshNonce = 0, onRefreshingChange }: Props) {
  const appId = app.appId || app.id;
  const [entity, setEntity] = useState('all');
  const [entityCatalog, setEntityCatalog] = useState<Array<{ id: string; label: string; count?: number }>>([]);
  const [period, setPeriod] = useState<DatePresetId>('fy');
  const [calendarYear, setCalendarYear] = useState(() => currentIstYear());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    try {
      return Number(
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(new Date()),
      );
    } catch {
      return new Date().getMonth() + 1;
    }
  });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AppDashboardData | null>(null);

  const resolvedDates = useMemo(
    () => resolveDateScope({ period, calendarYear, calendarMonth, dateFrom, dateTo }),
    [period, calendarYear, calendarMonth, dateFrom, dateTo],
  );

  const refresh = useCallback(
    async (forceRefresh = false) => {
      if (!isBackendApiMode() || !appId) {
        setError(!appId ? 'Missing application id' : 'Backend API mode is required');
        return;
      }

      const loadOpts = {
        applicationId: appId,
        environment: (app.environment as 'production' | 'development') || 'production',
        entity,
        processId: 'all',
        resourceType: 'all',
        resourceId: 'all',
        period: resolvedDates.period,
        dateFrom: resolvedDates.from || undefined,
        dateTo: resolvedDates.to || undefined,
      };

      const queryKey = appDashboardQueryKey(loadOpts);

      let hadCachedSnapshot = false;
      if (!forceRefresh) {
        const cached = readAppDashboardCache(appId, queryKey);
        if (cached) {
          hadCachedSnapshot = true;
          setData(cached);
          setLoading(false);
          // Soft revalidate — keep KPIs visible under the center overlay.
          setRefreshing(true);
        } else {
          // Drop previous filter's KPIs immediately so the UI never looks "stuck" on old data.
          setData(null);
          setLoading(true);
        }
      } else {
        setRefreshing(true);
        onRefreshingChange?.(true);
      }

      setError(null);
      try {
        if (forceRefresh) {
          try {
            const liveDash = await refreshApplicationDashboardLive({
              applicationId: appId,
              environment: loadOpts.environment,
            });
            // Paint unfiltered live immediately when filters are all/all/all.
            if (
              entity === 'all'
              && period === 'all'
              && liveDash
            ) {
              setData(liveDash);
            }
          } catch (liveErr) {
            setError(liveErr instanceof Error ? liveErr.message : String(liveErr));
          }
        }
        const result = await loadApplicationDashboard({
          ...loadOpts,
          skipCache: true,
        });
        if (result.data) setData(result.data);
      } catch (err) {
        if (!hadCachedSnapshot) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
        onRefreshingChange?.(false);
      }
    },
    [app.environment, appId, entity, onRefreshingChange, period, resolvedDates],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!refreshNonce) return;
    void refresh(true);
  }, [refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps -- only fire on header Refresh

  const entityOptions = useMemo(() => {
    const rows = data?.entities || [];
    // Always keep the full catalog once seen, so selecting Refex never drops Extrovis (etc.).
    const map = new Map<string, { id: string; label: string; count?: number }>();
    for (const o of entityCatalog) map.set(o.id, o);
    for (const e of rows) {
      map.set(e.id, {
        id: e.id,
        label: e.label || e.id,
        count: e.count,
      });
    }
    if (entity !== 'all' && !map.has(entity)) {
      map.set(entity, { id: entity, label: entity.replace(/_/g, ' '), count: 0 });
    }
    const merged = [{ id: 'all', label: 'All entities', count: 0 }, ...map.values()];
    return merged;
  }, [data?.entities, entity, entityCatalog]);

  useEffect(() => {
    const rows = data?.entities || [];
    if (!rows.length) return;
    setEntityCatalog((prev) => {
      const map = new Map(prev.map((e) => [e.id, e]));
      for (const e of rows) {
        const prevRow = map.get(e.id);
        // Prefer larger inventory counts so a filtered response doesn't zero out siblings.
        if (!prevRow || Number(e.count || 0) >= Number(prevRow.count || 0)) {
          map.set(e.id, { id: e.id, label: e.label || e.id, count: e.count });
        } else if (prevRow && !map.has(e.id)) {
          map.set(e.id, prevRow);
        }
      }
      return [...map.values()];
    });
  }, [data?.entities]);

  const openVal = Number(data?.metrics.open ?? data?.metrics.pending ?? 0);
  const closedVal = Number(data?.metrics.closed ?? data?.metrics.completed ?? 0);
  const rejectedVal = Number(data?.metrics.rejected || 0);
  const adoptionOverall = Number(data?.metrics.sign_in_rate_overall ?? data?.metrics.user_adoption_pct ?? 0);
  const adoptionToday = Number(data?.metrics.sign_in_rate_today || 0);
  const isPmLayout = data?.report_layout?.kind === 'pm';
  const isP2pLayout = data?.report_layout?.kind === 'p2p';
  const portfolio = data?.portfolio;

  const p2pDocRows = useMemo((): P2pDocRow[] => {
    if (!isP2pLayout) return [];
    return (data?.by_process || []).map((row) => ({
      key: String(row.process_id || row.process_name || row.process_label),
      title: String(row.process_label || row.process_name || row.process_id),
      hint: embed
        ? ''
        : row.process_id === 'purchase_requests'
          ? 'Purchase requisitions · total_amount'
          : row.process_id === 'purchase_orders'
            ? 'Purchase orders · grand_total'
            : 'Procurement documents',
      total: Number(row.total || 0),
      open: Number(row.open_count ?? row.pending ?? row.open ?? 0),
      closed: Number(row.closed ?? row.completed ?? 0),
      rejected: Number(row.rejected || 0),
      amountTotal: Number((row as { amount_total?: number }).amount_total || 0),
      amountOpen: Number((row as { amount_open?: number }).amount_open || 0),
    }));
  }, [data?.by_process, isP2pLayout, embed]);

  const p2pAmountTotal = Number(data?.metrics.amount_total ?? data?.amounts?.total ?? 0);
  const p2pAmountOpen = Number(data?.metrics.amount_open ?? data?.amounts?.open ?? 0);
  const p2pAmountClosed = Math.max(0, p2pAmountTotal - p2pAmountOpen);

  const statusChart = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'Open', value: openVal, color: OPEN_COLOR },
      { name: 'Closed', value: closedVal, color: CLOSED_COLOR },
      { name: 'Rejected', value: rejectedVal, color: REJECTED_COLOR },
    ].filter((row) => row.value > 0);
  }, [data, openVal, closedVal, rejectedVal]);

  const entityRows = useMemo(() => {
    const raw = data?.by_entity?.length
      ? data.by_entity
      : (data?.by_process || []).map((row) => ({
          entity_id: row.process_id,
          entity_label: row.process_label || row.process_name || row.process_id,
          total: row.total,
          open: Number(row.open_count ?? row.pending ?? 0),
          closed: Number(row.closed ?? row.completed ?? 0),
          rejected: Number(row.rejected || 0),
        }));
    return sortByClosureRatio(raw);
  }, [data?.by_entity, data?.by_process]);

  const entityChart = useMemo(
    () =>
      entityRows.map((row) => ({
        name: String(row.entity_label || row.entity_id).slice(0, 14),
        fullName: row.entity_label || row.entity_id,
        open: Number(row.open || 0),
        closed: Number(row.closed || 0),
        rejected: Number(row.rejected || 0),
      })),
    [entityRows],
  );

  const misUsers = useMemo(() => sortByClosedDesc(data?.users || []), [data?.users]);
  const isSolarLayout = data?.report_layout?.kind === 'solar'
    || /solar|reinvestment|site_expense/i.test(appId || '');
  const showEntityFilter = data?.filters?.supports_entity_filter !== false && !isSolarLayout;

  const kpiLabels = data?.report_layout?.kpi_labels;
  const totalLabel = kpiLabels?.total || 'Total items';
  const openLabel = kpiLabels?.open || 'Open';
  const closedLabel = kpiLabels?.closed || 'Closed';
  const rejectedLabel = kpiLabels?.rejected || 'Rejected';

  const sourceRows = useMemo(
    () =>
      (data?.by_source || []).map((row) => ({
        name: row.name,
        value: row.count,
      })),
    [data?.by_source],
  );

  const sourceTotal = useMemo(() => sourceRows.reduce((s, r) => s + r.value, 0), [sourceRows]);
  const isItsmLayout = data?.report_layout?.kind === 'itsm' || sourceRows.length > 0;

  const categoryChart = useMemo(
    () =>
      (data?.by_category || []).map((row) => ({
        name: row.name,
        value: row.count,
        color: CATEGORY_COLORS[row.name] || '#0ea5e9',
      })),
    [data?.by_category],
  );

  const processChart = useMemo(
    () =>
      (data?.by_process || [])
        .filter((row) => Number(row.total || 0) > 0 || String(row.process_id || '').includes('Advance_Payment') || String(row.process_id || '').includes('Expense_Management') || String(row.process_id || '').includes('Travel_Management'))
        .map((row) => ({
          name: String(row.process_label || row.process_name || row.process_id).slice(0, 18),
          fullName: row.process_label || row.process_name || row.process_id,
          open: Number(row.open_count ?? row.pending ?? 0),
          closed: Number(row.closed ?? row.completed ?? 0),
          rejected: Number(row.rejected || 0),
          total: Number(row.total || 0),
        })),
    [data?.by_process],
  );

  const isTravelLayout = Boolean(
    processChart.length > 0
      && (appId.includes('Expense_and_Travel') || data?.by_process?.some((p) => String(p.process_id).includes('Travel_Management') || String(p.process_id).includes('Advance_Payment'))),
  );

  if (!isBackendApiMode()) {
    return (
      <div className="surface p-6 text-sm text-foreground-600">
        Switch to backend API mode to load the live application dashboard.
      </div>
    );
  }

  const isP2pApp =
    /procurement|p2p/i.test(appId || '')
    || /procurement/i.test(app.applicationName || app.name || '');

  return (
    <div className="relative rounded-3xl bg-gradient-to-br from-slate-50 via-white to-sky-50/40 p-1">
      <DashboardLoadingOverlay
        show={(loading && !data) || refreshing}
        mode="fixed"
        label={refreshing ? 'Refreshing live metrics…' : 'Loading dashboard…'}
      />
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:p-4">
          <ExecutiveDateFilterBar
            period={period}
            onPeriodChange={setPeriod}
            calendarYear={calendarYear}
            onCalendarYearChange={setCalendarYear}
            calendarMonth={calendarMonth}
            onCalendarMonthChange={setCalendarMonth}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            entity={entity}
            onEntityChange={showEntityFilter ? setEntity : undefined}
            entityOptions={showEntityFilter ? entityOptions : undefined}
            refreshing={refreshing}
            hideHints={embed}
          />
          {(entity !== 'all' || period !== 'fy' || dateFrom || dateTo) && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setEntity('all');
                  setPeriod('fy');
                  setDateFrom('');
                  setDateTo('');
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
        {data?.snapshot_at && !embed ? (
          <p className="text-xs text-slate-500">
            Last synced {formatWhen(data.snapshot_at)}
          </p>
        ) : null}

        {error && (
          <div className="flex gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Dashboard failed to load</div>
              <div className="mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {loading && !data ? (
          <div className="min-h-[240px]" />
        ) : null}

        {data && (
          <>
            <div
              className={`grid grid-cols-2 gap-3 md:grid-cols-4 ${
                !isPmLayout && !isP2pLayout && Number(data.metrics.projects || 0) > 0 ? 'xl:grid-cols-5' : ''
              }`}
            >
              <KpiCard label={isPmLayout ? 'All work items' : totalLabel} value={data.metrics.total} styleIndex={0} />
              <KpiCard label={openLabel} value={openVal} styleIndex={1} />
              <KpiCard label={closedLabel} value={closedVal} styleIndex={2} />
              <KpiCard label={rejectedLabel} value={rejectedVal} styleIndex={3} />
              {!isPmLayout && !isP2pLayout && Number(data.metrics.projects || 0) > 0 ? (
                <KpiCard
                  label="Projects"
                  value={Number(data.metrics.projects)}
                  styleIndex={0}
                  sub={embed ? undefined : 'Distinct Project_ID'}
                />
              ) : null}
            </div>

            {isP2pLayout ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <P2pAmountKpiCard
                  label="Total PR + PO value"
                  value={p2pAmountTotal}
                  sub={embed ? undefined : formatInrFull(p2pAmountTotal)}
                  styleIndex={0}
                />
                <P2pAmountKpiCard
                  label="Open pipeline value"
                  value={p2pAmountOpen}
                  sub={embed ? undefined : `${openVal.toLocaleString('en-IN')} open documents`}
                  styleIndex={1}
                />
                <P2pAmountKpiCard
                  label="Closed / approved value"
                  value={p2pAmountClosed}
                  sub={embed ? undefined : `${closedVal.toLocaleString('en-IN')} closed documents`}
                  styleIndex={2}
                />
              </div>
            ) : null}

            {isP2pLayout && p2pDocRows.length > 0 ? (
              <div className="space-y-3">
                {!embed ? (
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <IndianRupee className="h-3.5 w-3.5 text-emerald-600" />
                    PR & PO breakdown · counts and INR value
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {p2pDocRows.map((row) => (
                    <P2pDocBand key={row.key} row={row} />
                  ))}
                </div>
              </div>
            ) : null}

            {isPmLayout && portfolio ? (
              <div className="space-y-3">
                {!embed ? (
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <FolderKanban className="h-3.5 w-3.5 text-violet-600" />
                    Portfolio breakdown · matches scheduled PM email report
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <PortfolioBand
                    title="Projects"
                    hint={embed ? '' : 'In Progress = at least one pending task · Completed = all linked tasks done'}
                    total={portfolio.projects_total}
                    open={portfolio.projects_open}
                    closed={portfolio.projects_closed}
                    totalLabel="Total Projects"
                  />
                  <PortfolioBand
                    title="All Tasks"
                    hint={embed ? '' : 'Every task on Project Task process (linked to a project or not)'}
                    total={portfolio.tasks_total}
                    open={portfolio.tasks_open}
                    closed={portfolio.tasks_closed}
                    totalLabel="Total Tasks"
                  />
                  <PortfolioBand
                    title="Individual Tasks"
                    hint={embed ? '' : 'Tasks with no linked Project ID — stand-alone work'}
                    total={portfolio.individual_total}
                    open={portfolio.individual_open}
                    closed={portfolio.individual_closed}
                    totalLabel="Total Individual"
                  />
                  <PortfolioBand
                    title="Sub-tasks"
                    hint={embed ? '' : 'Child work under a parent task (Sub Task process)'}
                    total={portfolio.subtasks_total}
                    open={portfolio.subtasks_open}
                    closed={portfolio.subtasks_closed}
                    totalLabel="Total Sub-tasks"
                  />
                </div>
                {!embed ? (
                  <p className="text-[11px] text-slate-500">
                    Project-linked tasks: <strong>{portfolio.linked_tasks.toLocaleString('en-IN')}</strong>
                    {' · '}
                    Individual: <strong>{portfolio.individual_total.toLocaleString('en-IN')}</strong>
                    {' · '}
                    Sub-tasks: <strong>{portfolio.subtasks_total.toLocaleString('en-IN')}</strong>
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="relative col-span-2 overflow-hidden rounded-2xl bg-[#F0EDFF] px-4 py-4 text-slate-800 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#E0D9F5]">
                <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/15" />
                <div className="relative">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#5B4B9A]">
                    <Percent className="h-3.5 w-3.5" />
                    {isP2pLayout ? 'Users · P2P app' : 'Adoption · overall'}
                  </div>
                  <p className="mt-2 text-4xl font-bold tabular-nums leading-none text-slate-900">
                    {isP2pLayout
                      ? Number(data.metrics.total_users || 0).toLocaleString('en-IN')
                      : `${adoptionOverall}%`}
                  </p>
                  {!embed ? (
                    <p className="mt-2 text-sm text-slate-500">
                      {isP2pLayout
                        ? `${Number(data.metrics.signed_in_today || 0).toLocaleString('en-IN')} signed in today`
                        : 'Ever signed in ÷ app users (not today-only)'}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm" style={{ border: `1px solid ${CARD_BORDER}` }}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Users className="h-3.5 w-3.5 text-sky-600" />
                  Users
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                  {Number(data.metrics.total_users || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm" style={{ border: `1px solid ${CARD_BORDER}` }}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Signed in today
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                  {Number(data.metrics.signed_in_today || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm" style={{ border: `1px solid ${CARD_BORDER}` }}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                  Adoption today
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                  {adoptionToday}%
                </div>
                {!embed ? (
                  <p className="mt-0.5 text-[10px] text-slate-400">Today only · not affected by date filter</p>
                ) : null}
              </div>
            </div>

            {!embed && data.report_layout?.note ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {data.report_layout.note}
              </p>
            ) : null}

            {!embed && data.board_filter_note ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {data.board_filter_note}
              </p>
            ) : null}

            <div className={`grid grid-cols-1 gap-4 ${isItsmLayout || isP2pLayout ? 'xl:grid-cols-12' : 'lg:grid-cols-3'}`}>
              <DashboardCard
                title={isSolarLayout ? 'By category · Operation / Finance' : isP2pLayout ? 'By entity · PR + PO' : 'By entity'}
                className={isItsmLayout || isP2pLayout ? 'xl:col-span-7' : 'lg:col-span-2'}
              >
                <div className="h-[220px]">
                  {entityChart.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">No entity data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={entityChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: MUTED }} interval={0} />
                        <YAxis tick={{ fontSize: 10, fill: MUTED }} allowDecimals={false} width={32} />
                        <Tooltip />
                        <Bar dataKey="open" name="Open" fill={OPEN_COLOR} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="closed" name="Closed" fill={CLOSED_COLOR} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="rejected" name="Rejected" fill={REJECTED_COLOR} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </DashboardCard>

              <DashboardCard
                title={isP2pLayout ? 'Combined status · PR + PO' : 'Status split'}
                className={isItsmLayout || isP2pLayout ? 'xl:col-span-5' : undefined}
              >
                <div className="relative h-[220px]">
                  {statusChart.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">No status data</div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statusChart}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={52}
                            outerRadius={78}
                            paddingAngle={2}
                          >
                            {statusChart.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => Number(v).toLocaleString('en-IN')} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</p>
                        <p className="text-xl font-bold tabular-nums text-slate-900">
                          {data.metrics.total.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </DashboardCard>
            </div>

            {isP2pLayout && p2pDocRows.length > 0 ? (
              <DashboardCard title="PR vs PO · document count & value">
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={p2pDocRows.map((row) => ({
                        name: row.title.replace('Purchase ', ''),
                        total: row.total,
                        open: row.open,
                        closed: row.closed,
                        amount: row.amountTotal,
                      }))}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      barCategoryGap="22%"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: MUTED }} />
                      <YAxis yAxisId="count" tick={{ fontSize: 11, fill: MUTED }} allowDecimals={false} width={36} />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === 'amount') return [formatInrFull(Number(value)), 'Total value'];
                          return [Number(value).toLocaleString('en-IN'), String(name)];
                        }}
                      />
                      <Bar yAxisId="count" dataKey="total" name="Total docs" fill="#334155" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="count" dataKey="open" name="Open" fill={OPEN_COLOR} radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="count" dataKey="closed" name="Closed" fill={CLOSED_COLOR} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {p2pDocRows.map((row) => (
                    <div key={row.key} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <p className="text-[11px] font-semibold text-slate-600">{row.title}</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                        {row.total.toLocaleString('en-IN')} docs · {formatInr(row.amountTotal)}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {row.open} open · {row.closed} closed · {row.rejected} rejected
                      </p>
                    </div>
                  ))}
                </div>
              </DashboardCard>
            ) : null}

            {isTravelLayout ? (
              <DashboardCard title="By process · Travel request / advance / expense">
                <div className="h-[220px]">
                  {processChart.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">No process data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={processChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: MUTED }} interval={0} />
                        <YAxis tick={{ fontSize: 10, fill: MUTED }} allowDecimals={false} width={32} />
                        <Tooltip />
                        <Bar dataKey="open" name="Open" fill={OPEN_COLOR} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="closed" name="Closed" fill={CLOSED_COLOR} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="rejected" name="Rejected" fill={REJECTED_COLOR} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {processChart.map((row) => (
                    <div key={row.fullName} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <p className="text-[11px] font-semibold text-slate-600">{row.fullName}</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{row.total.toLocaleString('en-IN')}</p>
                      <p className="text-[10px] text-slate-500">
                        {row.open} open · {row.closed} closed
                      </p>
                    </div>
                  ))}
                </div>
              </DashboardCard>
            ) : null}

            {isItsmLayout || sourceRows.length > 0 ? (
              <DashboardCard
                title="Ticket source"
                right={<span className="text-xs text-slate-500">{sourceTotal.toLocaleString('en-IN')} tickets</span>}
              >
                <div className={`grid grid-cols-1 gap-4 ${isItsmLayout ? 'xl:grid-cols-12' : ''}`}>
                  <div className={isItsmLayout ? 'xl:col-span-7' : ''}>
                    <SourceComposedChart rows={sourceRows} />
                  </div>
                  <div className={isItsmLayout ? 'xl:col-span-5' : ''}>
                    <SourceIconReport rows={sourceRows} total={sourceTotal || data.metrics.total} />
                  </div>
                </div>
              </DashboardCard>
            ) : null}

            {categoryChart.length > 0 ? (
              <DashboardCard title="Operation vs Finance">
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryChart} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: MUTED }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11, fill: MUTED }} />
                      <Tooltip formatter={(v) => Number(v).toLocaleString('en-IN')} />
                      <Bar dataKey="value" name="Items" radius={[0, 4, 4, 0]}>
                        {categoryChart.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashboardCard>
            ) : null}

            {!isP2pLayout ? (
            <DashboardCard
              title="Entity matrix"
              right={embed ? undefined : <span className="text-xs text-slate-500">Sorted by closure ratio</span>}
            >
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">Entity</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Open</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Closed</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Rejected</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Closure %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entityRows.map((row) => {
                      const open = Number(row.open || 0);
                      const closed = Number(row.closed || 0);
                      return (
                        <tr key={row.entity_id} className="border-t border-slate-100">
                          <td className="px-5 py-2.5 font-medium text-slate-900">{row.entity_label || row.entity_id}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{row.total}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-orange-500">{open}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-emerald-600">{closed}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-rose-600">
                            {Number(row.rejected || 0)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-slate-700">
                            {closureRatioPct(open, closed)}%
                          </td>
                        </tr>
                      );
                    })}
                    {entityRows.length > 0 ? (
                      <tr className="border-t border-slate-200 bg-slate-50/80">
                        <td className="px-5 py-2.5 font-semibold text-slate-900">All (matches KPIs)</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{data.metrics.total}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-orange-500">{openVal}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-emerald-600">{closedVal}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-rose-600">{rejectedVal}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-slate-700">
                          {closureRatioPct(openVal, closedVal)}%
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </DashboardCard>
            ) : (
              <DashboardCard title="PR / PO summary · counts & INR">
                <div className="-mx-5 -mb-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-2.5 font-semibold">Document</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Open</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Closed</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Rejected</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Total value</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Open value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p2pDocRows.map((row) => (
                        <tr key={row.key} className="border-t border-slate-100">
                          <td className="px-5 py-2.5 font-medium text-slate-900">{row.title}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{row.total}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-orange-500">{row.open}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-emerald-600">{row.closed}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-rose-600">{row.rejected}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{formatInrFull(row.amountTotal)}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{formatInrFull(row.amountOpen)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 bg-slate-50/80">
                        <td className="px-5 py-2.5 font-semibold text-slate-900">All (matches KPIs)</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{data.metrics.total}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-orange-500">{openVal}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-emerald-600">{closedVal}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-rose-600">{rejectedVal}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{formatInrFull(p2pAmountTotal)}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{formatInrFull(p2pAmountOpen)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </DashboardCard>
            )}

            <DashboardCard
              title={isP2pLayout ? 'MIS · P2P users (requesters / PO creators)' : 'MIS · Users'}
              right={
                embed ? (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Users className="h-3.5 w-3.5" />
                    {misUsers.length}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Users className="h-3.5 w-3.5" />
                    {misUsers.length}
                    {entity !== 'all' || period !== 'all' ? ' · same filters' : ''}
                    {' · closed ↓'}
                  </span>
                )
              }
            >
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">User</th>
                      <th className="px-5 py-2.5 font-semibold">Last sign-in</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Open</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Closed</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Rejected</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Closure %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {misUsers.map((user) => {
                      const open = Number(user.open ?? user.pending ?? 0);
                      const closed = Number(user.closed ?? user.completed ?? 0);
                      const rejected = Number(user.rejected || 0);
                      const lastSignIn = user.last_sign_in;
                      const inactive = !lastSignIn;
                      const rowKey = String(user.user_id || user.user_name);
                      const expanded = expandedUserId === rowKey;
                      return (
                        <Fragment key={rowKey}>
                          <tr
                            className="cursor-pointer border-t border-slate-100 hover:bg-[#EEF5FF]/70"
                            onClick={() => setExpandedUserId(expanded ? null : rowKey)}
                          >
                            <td className="px-5 py-2.5 font-medium text-slate-900">
                              <span className="inline-flex items-center gap-1.5">
                                <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
                                {user.user_name}
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-sm tabular-nums text-slate-600">
                              {inactive ? (
                                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                                  Inactive
                                </span>
                              ) : (
                                formatWhen(lastSignIn)
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-[#A96A20]">{open}</td>
                            <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-[#287B5D]">{closed}</td>
                            <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-[#B24E66]">{rejected}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums">{user.total || open + closed + rejected}</td>
                            <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-slate-700">
                              {closureRatioPct(open, closed)}%
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-t border-slate-100">
                              <td colSpan={7} className="max-w-0 p-0">
                                <div className="max-w-full overflow-hidden">
                                  <UserWorkExpandPanel
                                    userName={user.user_name}
                                    applicationId={appId}
                                    applicationName={app.name || appId}
                                    environment={app.environment}
                                  />
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                    {misUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                          No users for this filter. Try All entities or This FY.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </DashboardCard>

            {!embed ? (
              <p className="px-1 text-[11px] text-slate-400">
                Snapshot {formatWhen(data.snapshot_at)}
                {data.filters.entity && data.filters.entity !== 'all' ? ` · ${data.filters.entity}` : ''}
                {data.filters.period && data.filters.period !== 'all' ? ` · ${data.filters.period}` : ''}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
