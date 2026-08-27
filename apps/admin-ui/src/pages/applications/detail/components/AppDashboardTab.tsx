import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import {
  currentIstYear,
  istTodayYmd,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';

type Props = {
  app: KissflowApplication;
  /** Bumped by parent header Refresh — forces live refresh for this tab. */
  refreshNonce?: number;
  onRefreshingChange?: (busy: boolean) => void;
};

const CHART_GRID = '#e2e8f0';
const OPEN_COLOR = '#f97316';
const CLOSED_COLOR = '#10b981';
const REJECTED_COLOR = '#ef4444';

const SOURCE_META: Record<
  string,
  { color: string; bg: string; icon: typeof Mail; hint: string }
> = {
  Email: { color: '#2563eb', bg: 'from-blue-500 to-indigo-600', icon: Mail, hint: 'Inbox / mail' },
  WhatsApp: { color: '#16a34a', bg: 'from-emerald-500 to-green-600', icon: MessageCircle, hint: 'WhatsApp' },
  Mobile: { color: '#9333ea', bg: 'from-violet-500 to-purple-600', icon: Smartphone, hint: 'Mobile app' },
  Web: { color: '#0891b2', bg: 'from-cyan-500 to-sky-600', icon: Globe2, hint: 'Web portal' },
  Other: { color: '#64748b', bg: 'from-slate-500 to-slate-600', icon: Layers, hint: 'Other' },
};

const CATEGORY_COLORS: Record<string, string> = {
  Operation: '#0ea5e9',
  Finance: '#f59e0b',
};

function closureRatioPct(open: number, closed: number): number {
  const den = open + closed;
  return den > 0 ? Math.round((closed / den) * 1000) / 10 : 0;
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

const KPI_STYLES = [
  { accent: 'from-sky-500 via-blue-600 to-indigo-700', glow: 'shadow-blue-500/25', icon: Layers },
  { accent: 'from-amber-400 via-orange-500 to-rose-500', glow: 'shadow-orange-500/25', icon: FolderKanban },
  { accent: 'from-emerald-400 via-teal-500 to-cyan-600', glow: 'shadow-emerald-500/25', icon: CheckCircle2 },
  { accent: 'from-rose-500 via-red-600 to-pink-700', glow: 'shadow-rose-500/25', icon: XCircle },
] as const;

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
      className={`relative min-w-0 overflow-hidden rounded-2xl bg-gradient-to-br ${style.accent} p-5 text-white shadow-lg ${style.glow}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/15" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-white/80">{label}</p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums">
            {value.toLocaleString('en-IN')}
          </p>
          {sub ? <p className="mt-2 text-sm font-semibold text-white/95">{sub}</p> : null}
          {deltaText ? (
            <p className={`mt-1 text-[11px] font-medium ${delta != null && delta < 0 ? 'text-rose-100' : 'text-emerald-100'}`}>
              {deltaText}
            </p>
          ) : null}
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">
          <Icon className="h-5 w-5 text-white" />
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
            <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${meta.bg} text-white shadow-sm`}>
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
        <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
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
          <p className="mt-0.5 text-[11px] text-slate-500">{row.hint}</p>
        </div>
        <div className="rounded-xl bg-slate-900 px-3 py-2 text-right text-white">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">Total value</p>
          <p className="text-lg font-bold tabular-nums">{formatInr(row.amountTotal)}</p>
          <p className="text-[10px] text-slate-400">{formatInrFull(row.amountTotal)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Documents', value: row.total, tone: 'text-slate-900 bg-slate-50 border-slate-200' },
          { label: 'Open', value: row.open, tone: 'text-amber-900 bg-amber-50 border-amber-200' },
          { label: 'Closed', value: row.closed, tone: 'text-emerald-900 bg-emerald-50 border-emerald-200' },
          { label: 'Rejected', value: row.rejected, tone: 'text-rose-900 bg-rose-50 border-rose-200' },
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
  const accents = [
    'from-slate-700 via-slate-800 to-slate-900',
    'from-amber-500 via-orange-600 to-rose-600',
    'from-emerald-500 via-teal-600 to-cyan-700',
  ] as const;
  const accent = accents[styleIndex % accents.length];
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${accent} p-5 text-white shadow-lg`}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-white/80">{label}</p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums">{formatInr(value)}</p>
          {sub ? <p className="mt-2 text-sm font-semibold text-white/90">{sub}</p> : null}
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">
          <IndianRupee className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
}

export default function AppDashboardTab({ app, refreshNonce = 0, onRefreshingChange }: Props) {
  const appId = app.appId || app.id;
  const [entity, setEntity] = useState('all');
  const [period, setPeriod] = useState<DatePresetId>('all');
  const [calendarYear, setCalendarYear] = useState(() => currentIstYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth() + 1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
    const base = [{ id: 'all', label: 'All entities', count: 0 }, ...rows];
    // Keep the current selection visible while a filtered response only returns one entity.
    if (entity !== 'all' && !base.some((o) => o.id === entity)) {
      base.push({ id: entity, label: entity.replace(/_/g, ' '), count: 0 });
    }
    return base;
  }, [data?.entities, entity]);

  // Do not auto-reset entity when the filtered payload temporarily omits other entities.

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
      hint: row.process_id === 'purchase_requests'
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
  }, [data?.by_process, isP2pLayout]);

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

  const misUsers = useMemo(() => sortByClosureRatio(data?.users || []), [data?.users]);

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
    <div className="rounded-3xl bg-gradient-to-br from-slate-50 via-white to-sky-50/40 p-1">
      <div className="space-y-4">
        {!isP2pApp && data?.report_layout?.kind !== 'p2p' ? (
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
            onEntityChange={setEntity}
            entityOptions={entityOptions}
            refreshing={refreshing}
          />
        ) : (
          <div
            className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm"
            style={{ border: `1px solid ${CARD_BORDER}` }}
          >
            Live Procurement to Pay snapshot from MySQL · all PR/PO documents (date filters do not apply).
          </div>
        )}

        {data?.snapshot_at ? (
          <p className="text-xs text-slate-500">
            Last synced {formatWhen(data.snapshot_at)}
            {data.data_source ? ` · ${data.data_source.replace(/_/g, ' ')}` : ''}
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
          <div
            className="flex items-center justify-center gap-2 rounded-2xl bg-white p-10 text-slate-500 shadow-sm"
            style={{ border: `1px solid ${CARD_BORDER}` }}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading live snapshot…
          </div>
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
                <KpiCard label="Projects" value={Number(data.metrics.projects)} styleIndex={0} sub="Distinct Project_ID" />
              ) : null}
            </div>

            {isP2pLayout ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <P2pAmountKpiCard
                  label="Total PR + PO value"
                  value={p2pAmountTotal}
                  sub={formatInrFull(p2pAmountTotal)}
                  styleIndex={0}
                />
                <P2pAmountKpiCard
                  label="Open pipeline value"
                  value={p2pAmountOpen}
                  sub={`${openVal.toLocaleString('en-IN')} open documents`}
                  styleIndex={1}
                />
                <P2pAmountKpiCard
                  label="Closed / approved value"
                  value={p2pAmountClosed}
                  sub={`${closedVal.toLocaleString('en-IN')} closed documents`}
                  styleIndex={2}
                />
              </div>
            ) : null}

            {isP2pLayout && p2pDocRows.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <IndianRupee className="h-3.5 w-3.5 text-emerald-600" />
                  PR & PO breakdown · counts and INR value
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {p2pDocRows.map((row) => (
                    <P2pDocBand key={row.key} row={row} />
                  ))}
                </div>
              </div>
            ) : null}

            {isPmLayout && portfolio ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <FolderKanban className="h-3.5 w-3.5 text-violet-600" />
                  Portfolio breakdown · matches scheduled PM email report
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <PortfolioBand
                    title="Projects"
                    hint="In Progress = at least one pending task · Completed = all linked tasks done"
                    total={portfolio.projects_total}
                    open={portfolio.projects_open}
                    closed={portfolio.projects_closed}
                    totalLabel="Total Projects"
                  />
                  <PortfolioBand
                    title="All Tasks"
                    hint="Every task on Project Task process (linked to a project or not)"
                    total={portfolio.tasks_total}
                    open={portfolio.tasks_open}
                    closed={portfolio.tasks_closed}
                    totalLabel="Total Tasks"
                  />
                  <PortfolioBand
                    title="Individual Tasks"
                    hint="Tasks with no linked Project ID — stand-alone work"
                    total={portfolio.individual_total}
                    open={portfolio.individual_open}
                    closed={portfolio.individual_closed}
                    totalLabel="Total Individual"
                  />
                  <PortfolioBand
                    title="Sub-tasks"
                    hint="Child work under a parent task (Sub Task process)"
                    total={portfolio.subtasks_total}
                    open={portfolio.subtasks_open}
                    closed={portfolio.subtasks_closed}
                    totalLabel="Total Sub-tasks"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Project-linked tasks: <strong>{portfolio.linked_tasks.toLocaleString('en-IN')}</strong>
                  {' · '}
                  Individual: <strong>{portfolio.individual_total.toLocaleString('en-IN')}</strong>
                  {' · '}
                  Sub-tasks: <strong>{portfolio.subtasks_total.toLocaleString('en-IN')}</strong>
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {!isP2pLayout ? (
                <>
                  <div className="relative col-span-2 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-700 px-4 py-4 text-white shadow-lg">
                    <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/15" />
                    <div className="relative">
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-100">
                        <Percent className="h-3.5 w-3.5" />
                        Adoption · overall
                      </div>
                      <p className="mt-2 text-4xl font-bold tabular-nums leading-none">{adoptionOverall}%</p>
                      <p className="mt-2 text-sm text-violet-100">
                        Ever signed in ÷ app users (not today-only)
                      </p>
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
                    <p className="mt-0.5 text-[10px] text-slate-400">Today only · not affected by date filter</p>
                  </div>
                </>
              ) : (
                <div className="col-span-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                  Direct MySQL read-only · document counts and INR values from live P2P tables. User adoption is not
                  tracked on this dashboard.
                </div>
              )}
            </div>

            {data.report_layout?.note ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {data.report_layout.note}
              </p>
            ) : null}

            {data.board_filter_note ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {data.board_filter_note}
              </p>
            ) : null}

            <div className={`grid grid-cols-1 gap-4 ${isItsmLayout ? 'xl:grid-cols-12' : isP2pLayout ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
              {!isP2pLayout ? (
                <DashboardCard title="By entity" className={isItsmLayout ? 'xl:col-span-7' : 'lg:col-span-2'}>
                  <div className={isItsmLayout ? 'h-[220px]' : 'h-[220px]'}>
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
              ) : (
                p2pDocRows.map((row) => <P2pDocStatusChart key={row.key} row={row} />)
              )}

              <DashboardCard title={isP2pLayout ? 'Combined status · PR + PO' : 'Status split'} className={isItsmLayout ? 'xl:col-span-5' : undefined}>
                <div className={`relative ${isItsmLayout ? 'h-[220px]' : 'h-[220px]'}`}>
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
                            innerRadius={isItsmLayout ? 52 : 52}
                            outerRadius={isItsmLayout ? 78 : 78}
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
              <DashboardCard title="By process · Payment Request / Expense / Travel">
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
              right={<span className="text-xs text-slate-500">Sorted by closure ratio</span>}
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

            {!isP2pLayout ? (
            <DashboardCard
              title="MIS · Users"
              right={
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Users className="h-3.5 w-3.5" />
                  {misUsers.length}
                  {entity !== 'all' || period !== 'all' ? ' · same filters' : ''}
                  {' · by closure % · totals = KPI cards'}
                </span>
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
                      return (
                        <tr key={user.user_id || user.user_name} className="border-t border-slate-100">
                          <td className="px-5 py-2.5 font-medium text-slate-900">{user.user_name}</td>
                          <td className="px-5 py-2.5 text-sm tabular-nums text-slate-600">
                            {formatWhen(user.last_sign_in)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-orange-600">{open}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-emerald-600">{closed}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-rose-600">{rejected}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{user.total || open + closed + rejected}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-slate-700">
                            {closureRatioPct(open, closed)}%
                          </td>
                        </tr>
                      );
                    })}
                    {misUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                          No users for this filter. Try All entities / All resources.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </DashboardCard>
            ) : null}

            <p className="px-1 text-[11px] text-slate-400">
              Snapshot {formatWhen(data.snapshot_at)} · entity={data.filters.entity} · period={data.filters.period}
              {data.data_source ? ` · ${data.data_source}` : ''}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
