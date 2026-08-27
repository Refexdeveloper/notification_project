import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  readDashboardCacheSoft,
  isDashboardCacheFresh,
  refreshDashboardLive,
  type DashboardApplication,
} from '@/services/dashboardApi';
import { loadApplicationDashboard } from '@/services/appDashboardApi';
import ExecutiveDateFilterBar from '@/components/feature/ExecutiveDateFilterBar';
import DashboardLoadingOverlay from '@/components/feature/DashboardLoadingOverlay';
import {
  currentIstYear,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';
import { buildAppOpenPath, readEmbedFromSearch, withEmbedParams } from '@/lib/embedMode';
import { EMBED_EXECUTIVE, personalGreeting } from '@/lib/timeGreeting';

const CARD_BORDER = 'rgba(226, 232, 240, 0.9)';
const MUTED = '#64748b';
const CHART_GRID = '#e2e8f0';

const KPI_STYLES = [
  { bg: '#EAF3FF', text: '#1E3A5F', muted: '#5B7A9D', iconBg: '#D6E8FF', iconColor: '#3977BE', icon: Users },
  { bg: '#E8F7F1', text: '#1F5C45', muted: '#287B5D', iconBg: '#D3EFE3', iconColor: '#287B5D', icon: UserCheck },
  { bg: '#FFF2E4', text: '#7A4A1A', muted: '#A96A20', iconBg: '#FFE8CC', iconColor: '#A96A20', icon: FolderOpen },
  { bg: '#E8F7F1', text: '#1F5C45', muted: '#287B5D', iconBg: '#D3EFE3', iconColor: '#287B5D', icon: CheckCircle2 },
] as const;

const OPEN_COLOR = '#D4A574';
const CLOSED_COLOR = '#5BA88A';

const APP_CARD_ACCENTS = [
  { bg: '#EAF3FF', text: '#3977BE' },
  { bg: '#E8F7F1', text: '#287B5D' },
  { bg: '#FFF2E4', text: '#A96A20' },
  { bg: '#F0EDFF', text: '#5B4B9A' },
  { bg: '#EAF7FB', text: '#2A7A8C' },
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
      <div className="h-8 w-1 rounded-full bg-[#B8D0F0]" />
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EAF2FF] shadow-sm ring-1 ring-[#D0E0F5]">
          <Icon className="h-3.5 w-3.5 text-[#3977BE]" />
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
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: typeof BarChart3;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
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
          {action ? <div className="shrink-0">{action}</div> : null}
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
      className="relative min-w-0 overflow-hidden rounded-2xl p-5 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#E6EBF2]"
      style={{ background: style.bg }}
    >
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: style.muted }}>
            {label}
          </p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums" style={{ color: style.text }}>
            {value.toLocaleString()}
            {suffix}
          </p>
          {sub ? (
            <p className="mt-2 text-sm font-semibold" style={{ color: style.muted }}>
              {sub}
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

function AppDetailCard({
  app,
  accentIndex,
  onOpen,
  embed = false,
}: {
  app: DashboardApplication;
  accentIndex: number;
  onOpen: () => void;
  embed?: boolean;
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
    <DashboardCard
      title={app.application_name}
      subtitle={embed ? undefined : subtitle}
      action={
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 rounded-full bg-[#E9F1FF] px-2.5 py-1 text-[10px] font-semibold text-[#3977BE] ring-1 ring-[#D0E0F5] hover:bg-[#DCE8FA]"
        >
          Open
          <ArrowRight className="h-3 w-3" />
        </button>
      }
    >
      <div className="mb-4 h-1 w-full rounded-full" style={{ background: accent.bg }} />
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
        className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#D0E0F5] transition-shadow hover:shadow-md"
        style={{ background: accent.bg, color: accent.text }}
      >
        Open {app.application_name}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </DashboardCard>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const embed = readEmbedFromSearch(searchParams);
  const backendMode = isBackendApiMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [refreshMode, setRefreshMode] = useState<'live' | 'snapshot' | null>(null);
  const [refreshWarnings, setRefreshWarnings] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | 'all'>(() => {
    const fromUrl = searchParams.get('app');
    return fromUrl && fromUrl !== 'all' ? fromUrl : 'all';
  });
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
  const [filteredApplications, setFilteredApplications] = useState<DashboardApplication[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  useEffect(() => {
    const fromUrl = searchParams.get('app');
    if (fromUrl && fromUrl !== 'all') setSelectedAppId(fromUrl);
  }, [searchParams]);

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
    if (forceRefresh) {
      setRefreshing(true);
      setError('');
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
    } else if (isDashboardCacheFresh('production')) {
      // Fresh within 5 minutes — paint from cache and skip network entirely.
      const cached = readDashboardCache('production');
      if (cached) {
        applyDashboardData(cached);
        setLoading(false);
        setRefreshing(false);
        setError('');
        return;
      }
    }

    // Soft paint from any prior snapshot while a network fetch runs (only when stale/missing).
    const soft = readDashboardCacheSoft('production');
    if (soft) {
      applyDashboardData(soft);
      setLoading(false);
    } else {
      setLoading(true);
    }

    setError('');
    const result = await loadDashboard('production', {
      live: false,
      skipCache: true,
    });

    if (!result.ok || !result.data) {
      if (!soft) {
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
    // Default FY + All time: use overview snapshot (already fast) — no N-way API fan-out.
    if (period === 'all' || period === 'fy') {
      setFilteredApplications(null);
      setFilterLoading(false);
      return;
    }

    if (!applications.length) return;

    // Today: use opened_today / closed_today already on the overview payload (instant).
    if (period === 'daily') {
      setFilterLoading(false);
      setFilteredApplications(
        applications.map((app) => {
          const opened = Number(app.metrics.opened_today || 0);
          const closed = Number(app.metrics.closed_today || 0);
          return {
            ...app,
            metrics: {
              ...app.metrics,
              open_tickets: opened,
              closed_tickets: closed,
              total_items: opened + closed + Number(app.metrics.rejected || 0),
            },
          } satisfies DashboardApplication;
        }),
      );
      return;
    }

    // Weekly / MTD / QTD / Month / Year / Custom → scoped app dashboards (5‑min cache).

    let cancelled = false;
    setFilterLoading(true);
    void (async () => {
      // Prefer session cache (5 min). Never skipCache — that caused multi-minute filter waits.
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
              skipCache: false,
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

  const embedAppTitle = useMemo(() => {
    if (!embed) return undefined;
    if (selectedAppId !== 'all') {
      const match = displayApplications.find((a) => `${a.environment}-${a.application_id}` === selectedAppId);
      return match?.application_name || 'Engagement overview';
    }
    return 'Engagement overview';
  }, [embed, selectedAppId, displayApplications]);

  if (!backendMode) {
    return (
      <Layout breadcrumbs={[{ label: 'Dashboard' }]} embed={embed} embedAppTitle={embedAppTitle}>
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
    <Layout breadcrumbs={[{ label: 'Dashboard' }]} embed={embed} embedAppTitle={embedAppTitle}>
      <div
        className="relative rounded-3xl border bg-gradient-to-br from-slate-50 via-white to-sky-50/40 shadow-[0_12px_40px_rgba(15,23,42,0.06)]"
        style={{ borderColor: CARD_BORDER }}
      >
        <DashboardLoadingOverlay
          show={Boolean(refreshing || filterLoading || (loading && applications.length === 0))}
          mode="fixed"
          label={
            refreshing
              ? 'Refreshing live metrics…'
              : filterLoading
                ? 'Applying date filters…'
                : 'Loading dashboard…'
          }
        />
        <div className="relative overflow-hidden rounded-t-3xl border-b border-[#D7E2EF] bg-[#EEF3FF] px-5 py-5">
          {embed ? (
            <div className="mb-4 border-b border-[#D7E2EF] pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3977BE]">
                {personalGreeting()}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800 sm:text-base">
                {EMBED_EXECUTIVE.name} · {EMBED_EXECUTIVE.title}
              </p>
            </div>
          ) : null}
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white ring-1 ring-[#D7E2EF]">
                <BarChart3 className="h-6 w-6 text-[#3977BE]" />
              </div>
              <div className="min-w-0">
                {!embed ? (
                  <div className="mb-1 flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-[#3977BE]" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3977BE]/80">
                      Engagement dashboard
                    </span>
                  </div>
                ) : null}
                {!embed ? (
                  <h1 className="truncate text-xl font-bold tracking-tight text-slate-900">Engagement overview</h1>
                ) : null}
                {!embed ? (
                  <p className="truncate text-xs text-slate-500">
                    {refreshMode === 'live' ? 'Live overlay' : 'PostgreSQL snapshot'} · fast landing
                    {generatedAt ? ` · Updated ${formatWhen(generatedAt)}` : ''}
                    {refreshing ? ' · refreshing…' : ''}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
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
            <div className="min-h-[280px]" />
          ) : (
            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-md sm:p-4">
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
                  application={selectedAppId}
                  onApplicationChange={(id) => {
                    const next = id === 'all' ? 'all' : id;
                    setSelectedAppId(next);
                    if (embed) {
                      setSearchParams(
                        withEmbedParams(searchParams, { app: next === 'all' ? null : next }),
                        { replace: true },
                      );
                    }
                  }}
                  applicationOptions={[
                    { id: 'all', label: 'All apps' },
                    ...displayApplications.map((a) => ({
                      id: `${a.environment}-${a.application_id}`,
                      label: a.application_name,
                    })),
                  ]}
                  refreshing={refreshing || filterLoading}
                  hideHints={embed}
                />
                {period !== 'fy' || selectedAppId !== 'all' ? (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setPeriod('fy');
                        setSelectedAppId('all');
                        setDateFrom('');
                        setDateTo('');
                        if (embed) {
                          setSearchParams(withEmbedParams(searchParams, { app: null }), { replace: true });
                        }
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : null}
              </div>

              {selectedAppId !== 'all' ? (
                <button
                  type="button"
                  onClick={() => {
                    const appId = filteredApps[0]?.application_id || selectedAppId;
                    navigate(
                      buildAppOpenPath({
                        environment: filteredApps[0]?.environment,
                        applicationId: appId,
                        tab: 'dashboard',
                        embed,
                      }),
                    );
                  }}
                  className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-[#D0E0F5] bg-[#EEF3FF] px-4 py-3.5 text-left text-slate-800 shadow-[0_2px_8px_rgba(40,60,90,0.04)] transition hover:bg-[#EAF2FF] sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B7A9D]">
                      {embed ? 'Open project dashboard' : 'Go to application'}
                    </p>
                    <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">
                      {filteredApps[0]?.application_name || 'Open dashboard'}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#3977BE] ring-1 ring-[#D0E0F5] group-hover:bg-[#EAF2FF]">
                    Open
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {displayApplications.map((app) => {
                    const id = `${app.environment}-${app.application_id}`;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          navigate(
                            buildAppOpenPath({
                              environment: app.environment,
                              applicationId: app.application_id,
                              tab: 'dashboard',
                              embed,
                            }),
                          )
                        }
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                      >
                        <span className="truncate">{app.application_name}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <KpiCard
                      label="Total items"
                      value={totals.open_tickets + totals.closed_tickets + totals.rejected}
                      sub={
                        embed
                          ? undefined
                          : period === 'all'
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
                      sub={embed ? undefined : `${totals.sign_in_today} of ${totals.total_users} today`}
                      styleIndex={1}
                    />
                    <KpiCard label="Active / signed in today" value={totals.sign_in_today} styleIndex={2} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="relative min-w-0 overflow-hidden rounded-2xl bg-[#F0EDFF] p-5 text-slate-800 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#E0D9F5]">
                      <div className="relative flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5B4B9A]">
                            Adoption today
                          </p>
                          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums text-slate-900">
                            {totals.total_users
                              ? Math.round((totals.sign_in_today / totals.total_users) * 100)
                              : 0}
                            %
                          </p>
                          {!embed ? (
                            <p className="mt-2 text-sm font-semibold text-slate-500">
                              Signed in today ÷ total users · not affected by date filter
                            </p>
                          ) : null}
                        </div>
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/80 ring-1 ring-[#E0D9F5]">
                          <Percent className="h-5 w-5 text-[#5B4B9A]" />
                        </div>
                      </div>
                    </div>
                    <KpiCard
                      label="Open items"
                      value={totals.open_tickets}
                      sub={embed ? undefined : `${totals.opened_today} today`}
                      styleIndex={2}
                    />
                    <KpiCard
                      label="Closed items"
                      value={totals.closed_tickets}
                      sub={embed ? undefined : `${totals.closed_today} today`}
                      styleIndex={3}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <DashboardCard
                    className="lg:col-span-2"
                    title="Open vs closed by application"
                    subtitle={embed ? undefined : 'Clustered column chart'}
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

                  <DashboardCard title="Work item mix" subtitle={embed ? undefined : 'Donut · selected scope'} icon={PieChartIcon}>
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
                  subtitle={embed ? undefined : 'Per-app open vs closed mix'}
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
                            {!embed ? (
                              <p className="text-[11px] text-slate-500">Closed share · {row.openPct}% open</p>
                            ) : null}
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
                        embed={embed}
                        onOpen={() =>
                          navigate(
                            buildAppOpenPath({
                              environment: app.environment,
                              applicationId: app.application_id,
                              tab: 'dashboard',
                              embed,
                            }),
                          )
                        }
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
