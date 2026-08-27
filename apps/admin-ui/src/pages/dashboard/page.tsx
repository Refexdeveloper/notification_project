import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FolderOpen,
  LayoutGrid,
  Percent,
  PieChart as PieChartIcon,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { isBackendApiMode } from '@/services/backendApi';
import {
  loadDashboard,
  readDashboardCache,
  refreshDashboardLive,
  type DashboardApplication,
} from '@/services/dashboardApi';
import { loadApplicationDashboard } from '@/services/appDashboardApi';
import ExecutiveDateFilterBar from '@/components/feature/ExecutiveDateFilterBar';
import {
  currentIstYear,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';

const CARD_BORDER = 'rgba(226, 232, 240, 0.9)';
const MUTED = '#64748b';
const CHART_GRID = '#e2e8f0';

const KPI_STYLES = [
  { accent: 'from-sky-500 via-blue-600 to-indigo-700', glow: 'shadow-blue-500/25', icon: Users },
  { accent: 'from-emerald-400 via-teal-500 to-cyan-600', glow: 'shadow-emerald-500/25', icon: UserCheck },
  { accent: 'from-amber-400 via-orange-500 to-rose-500', glow: 'shadow-orange-500/25', icon: FolderOpen },
  { accent: 'from-emerald-400 via-green-500 to-teal-600', glow: 'shadow-emerald-500/25', icon: CheckCircle2 },
] as const;

const OPEN_COLOR = '#f97316';
const CLOSED_COLOR = '#10b981';

const APP_CARD_ACCENTS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-rose-500',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-blue-600',
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

function aggregateMetrics(apps: DashboardApplication[]) {
  return apps.reduce(
    (acc, app) => ({
      total_users: acc.total_users + app.metrics.total_users,
      sign_in_today: acc.sign_in_today + app.metrics.sign_in_today,
      open_tickets: acc.open_tickets + app.metrics.open_tickets,
      closed_tickets: acc.closed_tickets + app.metrics.closed_tickets,
      rejected: acc.rejected + (app.metrics.rejected || 0),
      opened_today: acc.opened_today + (app.metrics.opened_today || 0),
      closed_today: acc.closed_today + (app.metrics.closed_today || 0),
    }),
    { total_users: 0, sign_in_today: 0, open_tickets: 0, closed_tickets: 0, rejected: 0, opened_today: 0, closed_today: 0 },
  );
}

function appTotalItems(m: DashboardApplication['metrics']): number {
  if (m.total_items != null && m.total_items > 0) return m.total_items;
  return (m.open_tickets || 0) + (m.closed_tickets || 0) + (m.rejected || 0);
}

function SectionHeader({
  icon: Icon,
  title,
  accent,
}: {
  icon: typeof LayoutGrid;
  title: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`h-8 w-1 rounded-full bg-gradient-to-b ${accent}`} />
      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${accent} shadow-sm`}>
          <Icon className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{title}</span>
      </div>
    </div>
  );
}

function DashboardCard({
  title,
  subtitle,
  icon: Icon,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  icon?: typeof BarChart3;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`group flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_4px_20px_rgba(15,23,42,0.05)] ${className}`}
      style={{ borderColor: CARD_BORDER }}
    >
      <div className="relative shrink-0 border-b px-5 py-3.5" style={{ borderColor: CARD_BORDER }}>
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 ring-1 ring-slate-200/80">
              <Icon className="h-4 w-4 text-slate-600" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {subtitle ? <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      <div className="min-h-[220px] flex-1 p-4">{children}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  suffix,
  sub,
  styleIndex = 0,
}: {
  label: string;
  value: number;
  suffix?: string;
  sub?: string;
  styleIndex?: number;
}) {
  const style = KPI_STYLES[styleIndex % KPI_STYLES.length];
  const Icon = style.icon;

  return (
    <div
      className={`relative min-w-0 overflow-hidden rounded-2xl bg-gradient-to-br ${style.accent} p-5 text-white shadow-lg ${style.glow}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/15" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-white/80">{label}</p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums">
            {value.toLocaleString()}
            {suffix}
          </p>
          {sub ? <p className="mt-2 text-sm font-semibold text-white/95">{sub}</p> : null}
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      {label ? <p className="mb-1.5 text-xs font-semibold text-slate-900">{label}</p> : null}
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.name)} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-slate-500">{entry.name}</span>
            <span className="ml-auto font-bold tabular-nums text-slate-900">{entry.value?.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: { fullName?: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const fullName = payload[0]?.payload?.fullName as string | undefined;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      {fullName ? <p className="mb-1.5 text-xs font-semibold text-slate-900">{fullName}</p> : null}
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.name)} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-slate-500">{entry.name}</span>
            <span className="ml-auto font-bold tabular-nums text-slate-900">{entry.value?.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonutCenter({ total }: { total: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</p>
      <p className="text-2xl font-bold tabular-nums text-slate-900">{total.toLocaleString()}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="h-12 rounded-2xl bg-slate-200/70" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[108px] rounded-2xl bg-slate-200/70" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-[280px] rounded-2xl bg-slate-200/70 lg:col-span-2" />
        <div className="h-[280px] rounded-2xl bg-slate-200/70" />
      </div>
    </div>
  );
}

function AppSlicer({
  apps,
  selectedId,
  onSelect,
}: {
  apps: DashboardApplication[];
  selectedId: string | 'all';
  onSelect: (id: string | 'all') => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white px-4 py-3 shadow-sm"
      style={{ borderColor: CARD_BORDER }}
    >
      <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Application</span>
      {(['all', ...apps.map((a) => `${a.environment}-${a.application_id}`)] as const).map((id) => {
        const isAll = id === 'all';
        const active = selectedId === id;
        const label = isAll ? 'All apps' : apps.find((a) => `${a.environment}-${a.application_id}` === id)?.application_name ?? id;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(isAll ? 'all' : id)}
            className={`max-w-[180px] cursor-pointer truncate rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function AppDetailCard({
  app,
  accentIndex,
  onOpen,
}: {
  app: DashboardApplication;
  accentIndex: number;
  onOpen: () => void;
}) {
  const m = app.metrics;
  const labels = app.metric_labels;
  const accent = APP_CARD_ACCENTS[accentIndex % APP_CARD_ACCENTS.length];
  const rows = [
    { metric: 'Total items', value: appTotalItems(m) },
    { metric: labels.sign_in_today, value: m.sign_in_today },
    { metric: labels.sign_in_rate_overall, value: `${m.sign_in_rate_overall}%` },
    { metric: labels.sign_in_rate_today, value: `${m.sign_in_rate_today}%` },
    { metric: labels.open_tickets, value: m.open_tickets },
    { metric: 'Opened today', value: m.opened_today ?? 0 },
    { metric: labels.closed_tickets, value: m.closed_tickets },
    { metric: 'Closed today', value: m.closed_today ?? 0 },
  ];

  const subtitle = `${m.total_users} users · ${
    app.data_source === 'live' && app.fetched_at
      ? `Live ${formatWhen(app.fetched_at)}`
      : app.snapshot_at
        ? `Snapshot ${formatWhen(app.snapshot_at)}`
        : 'No timestamp'
  }${app.snapshot_stale ? ' · stale' : ''}`;

  return (
    <DashboardCard title={app.application_name} subtitle={subtitle}>
      <div className={`mb-4 h-1 w-full rounded-full bg-gradient-to-r ${accent}`} />
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.metric}
            className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100"
          >
            <span className="text-xs font-medium text-slate-600">{row.metric}</span>
            <span className="text-sm font-bold tabular-nums text-slate-900">{row.value}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className={`mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r ${accent} px-3 py-2.5 text-xs font-semibold text-white shadow-md hover:shadow-lg transition-shadow`}
      >
        Open application
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </DashboardCard>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const backendMode = isBackendApiMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [refreshMode, setRefreshMode] = useState<'live' | 'snapshot' | null>(null);
  const [refreshWarnings, setRefreshWarnings] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | 'all'>('all');
  const [period, setPeriod] = useState<DatePresetId>('all');
  const [calendarYear, setCalendarYear] = useState(() => currentIstYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth() + 1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filteredApplications, setFilteredApplications] = useState<DashboardApplication[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  const resolvedDates = useMemo(
    () => resolveDateScope({ period, calendarYear, calendarMonth, dateFrom, dateTo }),
    [period, calendarYear, calendarMonth, dateFrom, dateTo],
  );

  const applyDashboardData = useCallback((data: NonNullable<Awaited<ReturnType<typeof loadDashboard>>['data']>) => {
    setApplications(data.applications);
    setGeneratedAt(data.generated_at || null);
    setRefreshMode(data.refresh_mode || 'snapshot');
    setRefreshWarnings(data.warnings || []);
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    let hadCachedSnapshot = false;

    if (forceRefresh) {
      setRefreshing(true);
    } else {
      const cached = readDashboardCache('production');
      if (cached) {
        hadCachedSnapshot = true;
        applyDashboardData(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }

    setError('');
    // Soft landing: paint from cache/snapshot first. Explicit Refresh runs related-user live overlay.
    if (forceRefresh) {
      const live = await refreshDashboardLive('production');
      if (live.ok && live.data?.applications) {
        applyDashboardData(live.data);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (live.error) {
        setRefreshWarnings((prev) => {
          const msg = `Live refresh: ${live.error} — falling back to snapshot`;
          return prev.includes(msg) ? prev : [...prev, msg];
        });
      }
    }

    const result = await loadDashboard('production', {
      live: false,
      skipCache: forceRefresh || hadCachedSnapshot,
    });

    if (!result.ok || !result.data) {
      if (!hadCachedSnapshot) {
        setError(result.error || 'Could not load dashboard');
        setApplications([]);
      } else if (result.error) {
        setRefreshWarnings((prev) => {
          const msg = `Could not refresh dashboard: ${result.error}`;
          return prev.includes(msg) ? prev : [...prev, msg];
        });
      }
    } else {
      applyDashboardData(result.data);
    }

    setLoading(false);
    setRefreshing(false);
  }, [applyDashboardData]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (period === 'all') {
      setFilteredApplications(null);
      return;
    }
    if (!applications.length) return;
    let cancelled = false;
    setFilterLoading(true);
    void (async () => {
      const scoped = await Promise.all(
        applications.map(async (app) => {
          try {
            const result = await loadApplicationDashboard({
              applicationId: app.application_id,
              environment: 'production',
              period: resolvedDates.period,
              dateFrom: resolvedDates.from,
              dateTo: resolvedDates.to,
              entity: 'all',
              skipCache: true,
            });
            const dash = result.data;
            if (!dash) return app;
            const m = dash.metrics;
            return {
              ...app,
              snapshot_at: dash.snapshot_at,
              data_source: dash.data_source === 'live_overlay' ? 'live' : 'snapshot',
              metrics: {
                ...app.metrics,
                open_tickets: Number(m.open ?? m.pending ?? 0),
                closed_tickets: Number(m.closed ?? m.completed ?? 0),
                rejected: Number(m.rejected || 0),
                total_items: Number(m.total || 0),
              },
            } satisfies DashboardApplication;
          } catch {
            return app;
          }
        }),
      );
      if (!cancelled) {
        setFilteredApplications(scoped);
        setFilterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applications, period, resolvedDates]);

  const displayApplications = filteredApplications ?? applications;

  const filteredApps = useMemo(() => {
    if (selectedAppId === 'all') return displayApplications;
    return displayApplications.filter((a) => `${a.environment}-${a.application_id}` === selectedAppId);
  }, [displayApplications, selectedAppId]);

  const totals = useMemo(() => aggregateMetrics(filteredApps), [filteredApps]);

  const barChartData = useMemo(
    () =>
      filteredApps.map((app) => ({
        name: app.application_name.length > 14 ? `${app.application_name.slice(0, 12)}…` : app.application_name,
        fullName: app.application_name,
        open: app.metrics.open_tickets,
        closed: app.metrics.closed_tickets,
        signInToday: app.metrics.sign_in_today,
      })),
    [filteredApps],
  );

  /** Precomputed open/closed % so tooltip/axis show 80% not raw ticket counts. */
  const workloadShareData = useMemo(
    () =>
      filteredApps.map((app) => {
        const open = Number(app.metrics.open_tickets || 0);
        const closed = Number(app.metrics.closed_tickets || 0);
        const total = open + closed;
        const openPct = total > 0 ? Math.round((open / total) * 1000) / 10 : 0;
        const closedPct = total > 0 ? Math.round((closed / total) * 1000) / 10 : 0;
        return {
          name: app.application_name.length > 14 ? `${app.application_name.slice(0, 12)}…` : app.application_name,
          fullName: app.application_name,
          openPct,
          closedPct,
          open,
          closed,
          total,
        };
      }),
    [filteredApps],
  );

  const donutData = useMemo(
    () =>
      [
        { name: 'Open', value: totals.open_tickets, color: OPEN_COLOR },
        { name: 'Closed', value: totals.closed_tickets, color: CLOSED_COLOR },
      ].filter((d) => d.value > 0),
    [totals],
  );

  const donutTotal = totals.open_tickets + totals.closed_tickets + totals.rejected;

  if (!backendMode) {
    return (
      <Layout breadcrumbs={[{ label: 'Dashboard' }]}>
        <EmptyState
          variant="activity"
          title="Dashboard requires backend mode"
          description="Switch to PostgreSQL backend-api mode to view live engagement metrics."
          primaryLabel="Go to applications"
          onPrimary={() => navigate('/applications')}
        />
      </Layout>
    );
  }

  return (
    <Layout breadcrumbs={[{ label: 'Dashboard' }]}>
      <div
        className="overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-50 via-white to-sky-50/40 shadow-[0_12px_40px_rgba(15,23,42,0.06)]"
        style={{ borderColor: CARD_BORDER }}
      >
        <div className="relative overflow-hidden border-b bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 px-5 py-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(129,140,248,0.22),transparent_40%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                <BarChart3 className="h-6 w-6 text-sky-200" />
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-sky-300" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300/90">
                    Engagement dashboard
                  </span>
                </div>
                <h1 className="truncate text-xl font-bold tracking-tight text-white">Engagement overview</h1>
                <p className="truncate text-xs text-slate-300">
                  {refreshMode === 'live' ? 'Live Kissflow overlay' : 'PostgreSQL snapshot'} · fast landing
                  {generatedAt ? ` · Updated ${formatWhen(generatedAt)}` : ''}
                  {refreshing ? ' · refreshing…' : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={() => void load(true)}
                disabled={loading || refreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing live…' : 'Refresh live'}
              </Button>
            </div>
          </div>
        </div>

        <div className="relative space-y-6 p-5 md:p-6">
          {refreshing ? (
            <div className="pointer-events-none absolute inset-x-5 top-5 z-10 overflow-hidden rounded-2xl border border-sky-200/80 bg-white/90 p-4 shadow-lg backdrop-blur-sm md:inset-x-6 md:top-6">
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600">
                  <div className="absolute inset-0 animate-pulse bg-white/20" />
                  <RefreshCw className="absolute inset-0 m-auto h-5 w-5 animate-spin text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">Refreshing live Kissflow overlay…</p>
                  <p className="text-xs text-slate-500">Updating adoption, open/closed, and per-app workload for executives</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full w-2/5 animate-[pulse_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500" />
                  </div>
                </div>
                <img
                  src="https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif"
                  alt=""
                  className="hidden h-2 w-28 rounded-full sm:block"
                />
              </div>
            </div>
          ) : null}

          {refreshing && (
            <div className="h-0.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" />
            </div>
          )}

          {refreshWarnings.length > 0 && (
            <div className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {refreshWarnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}

          {error ? (
            <EmptyState
              variant="activity"
              title="Could not load dashboard"
              description={error}
              primaryLabel="Retry"
              onPrimary={() => void load()}
            />
          ) : loading && applications.length === 0 ? (
            <DashboardSkeleton />
          ) : (
            <div className="space-y-6">
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
                refreshing={refreshing || filterLoading}
                compact
              />

              <AppSlicer apps={displayApplications} selectedId={selectedAppId} onSelect={setSelectedAppId} />

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <KpiCard
                      label="Total items"
                      value={totals.open_tickets + totals.closed_tickets + totals.rejected}
                      sub={
                        period === 'all'
                          ? selectedAppId === 'all'
                            ? 'All applications · open + closed + rejected'
                            : 'Selected application'
                          : 'Filtered by created date'
                      }
                      styleIndex={0}
                    />
                    <KpiCard
                      label="Total users"
                      value={totals.total_users}
                      sub={`${totals.sign_in_today} of ${totals.total_users} today`}
                      styleIndex={1}
                    />
                    <KpiCard label="Active / signed in today" value={totals.sign_in_today} styleIndex={2} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="relative min-w-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-700 p-5 text-white shadow-lg shadow-violet-500/25">
                      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/15" />
                      <div className="relative flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-100">
                            Adoption today
                          </p>
                          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums">
                            {totals.total_users
                              ? Math.round((totals.sign_in_today / totals.total_users) * 100)
                              : 0}
                            %
                          </p>
                          <p className="mt-2 text-sm font-semibold text-white/95">
                            Signed in today ÷ total users · not affected by date filter
                          </p>
                        </div>
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">
                          <Percent className="h-5 w-5 text-white" />
                        </div>
                      </div>
                    </div>
                    <KpiCard label="Open items" value={totals.open_tickets} sub={`${totals.opened_today} today`} styleIndex={2} />
                    <KpiCard label="Closed items" value={totals.closed_tickets} sub={`${totals.closed_today} today`} styleIndex={3} />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <DashboardCard
                    className="lg:col-span-2"
                    title="Open vs closed by application"
                    subtitle="Clustered column chart"
                    icon={TrendingUp}
                  >
                    {barChartData.length === 0 ? (
                      <p className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
                        No application data
                      </p>
                    ) : (
                      <div className="h-[240px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={barChartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={6}>
                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 11, fill: MUTED }}
                              axisLine={{ stroke: CHART_GRID }}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: MUTED }}
                              axisLine={{ stroke: CHART_GRID }}
                              tickLine={false}
                            />
                            <Tooltip content={<BarChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)', radius: 8 }} />
                            <Legend
                              verticalAlign="top"
                              align="right"
                              iconType="circle"
                              wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                            />
                            <defs>
                              <linearGradient id="openBarGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#fb923c" />
                                <stop offset="100%" stopColor="#ea580c" />
                              </linearGradient>
                              <linearGradient id="closedBarGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#34d399" />
                                <stop offset="100%" stopColor="#059669" />
                              </linearGradient>
                            </defs>
                            <Bar
                              dataKey="open"
                              name="Open"
                              fill="url(#openBarGradient)"
                              radius={[8, 8, 0, 0]}
                              maxBarSize={44}
                              isAnimationActive={false}
                            />
                            <Bar
                              dataKey="closed"
                              name="Closed"
                              fill="url(#closedBarGradient)"
                              radius={[8, 8, 0, 0]}
                              maxBarSize={44}
                              isAnimationActive={false}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </DashboardCard>

                  <DashboardCard title="Work item mix" subtitle="Donut · selected scope" icon={PieChartIcon}>
                    {donutData.length === 0 ? (
                      <p className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
                        No ticket data
                      </p>
                    ) : (
                      <div className="relative h-[240px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={donutData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={58}
                              outerRadius={82}
                              paddingAngle={4}
                              stroke="rgba(255,255,255,0.9)"
                              strokeWidth={3}
                              isAnimationActive={false}
                            >
                              {donutData.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                            <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                          </PieChart>
                        </ResponsiveContainer>
                        <DonutCenter total={donutTotal} />
                      </div>
                    )}
                  </DashboardCard>
                </div>

                <DashboardCard
                  title="Executive workload share"
                  subtitle="Per-app open vs closed mix"
                  icon={BarChart3}
                >
                  {workloadShareData.length === 0 ? (
                    <p className="flex h-full min-h-[160px] items-center justify-center text-sm text-slate-500">
                      No application data
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <div className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={workloadShareData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: MUTED }} />
                            <YAxis
                              domain={[0, 100]}
                              tickFormatter={(v) => `${v}%`}
                              tick={{ fontSize: 11, fill: MUTED }}
                              width={40}
                            />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const row = payload[0]?.payload as {
                                  fullName?: string;
                                  openPct?: number;
                                  closedPct?: number;
                                  open?: number;
                                  closed?: number;
                                };
                                return (
                                  <div
                                    className="rounded-xl border bg-white px-3 py-2.5 shadow-lg"
                                    style={{ borderColor: CARD_BORDER }}
                                  >
                                    <p className="mb-1.5 text-xs font-semibold text-slate-900">{row.fullName}</p>
                                    <div className="space-y-1 text-xs">
                                      <div className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full" style={{ background: OPEN_COLOR }} />
                                        <span className="text-slate-500">Open</span>
                                        <span className="ml-auto font-bold tabular-nums text-slate-900">
                                          {row.openPct}% ({Number(row.open || 0).toLocaleString('en-IN')})
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full" style={{ background: CLOSED_COLOR }} />
                                        <span className="text-slate-500">Closed</span>
                                        <span className="ml-auto font-bold tabular-nums text-slate-900">
                                          {row.closedPct}% ({Number(row.closed || 0).toLocaleString('en-IN')})
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="openPct" name="Open %" fill={OPEN_COLOR} radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                            <Bar dataKey="closedPct" name="Closed %" fill={CLOSED_COLOR} radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                        {workloadShareData.map((row) => (
                          <div
                            key={row.fullName}
                            className="relative overflow-hidden rounded-xl border border-slate-100 bg-slate-50/80 p-3"
                          >
                            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              {row.fullName}
                            </p>
                            <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{row.closedPct}%</p>
                            <p className="text-[11px] text-slate-500">Closed share · {row.openPct}% open</p>
                            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full" style={{ width: `${row.openPct}%`, background: OPEN_COLOR }} />
                              <div className="h-full" style={{ width: `${row.closedPct}%`, background: CLOSED_COLOR }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </DashboardCard>

                <SectionHeader icon={LayoutGrid} title="Application detail" accent="from-blue-500 to-indigo-600" />

                <div
                  className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '0 400px' }}
                >
                  {filteredApps.length === 0 ? (
                    <div
                      className="col-span-full rounded-2xl border bg-white p-10 text-center text-sm text-slate-500 shadow-sm"
                      style={{ borderColor: CARD_BORDER }}
                    >
                      No registered applications yet.
                    </div>
                  ) : (
                    filteredApps.map((app, index) => (
                      <AppDetailCard
                        key={`${app.environment}-${app.application_id}`}
                        app={app}
                        accentIndex={index}
                        onOpen={() => navigate(`/applications/${app.environment}-${app.application_id}`)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
