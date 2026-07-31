import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FolderOpen,
  LayoutGrid,
  PieChart as PieChartIcon,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { isBackendApiMode } from '@/services/backendApi';
import {
  loadDashboard,
  readDashboardCache,
  type DashboardApplication,
} from '@/services/dashboardApi';

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
    }),
    { total_users: 0, sign_in_today: 0, open_tickets: 0, closed_tickets: 0 },
  );
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
  styleIndex = 0,
}: {
  label: string;
  value: number;
  suffix?: string;
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
    { metric: labels.sign_in_today, value: m.sign_in_today },
    { metric: labels.sign_in_rate_overall, value: `${m.sign_in_rate_overall}%` },
    { metric: labels.sign_in_rate_today, value: `${m.sign_in_rate_today}%` },
    { metric: labels.open_tickets, value: m.open_tickets },
    { metric: labels.closed_tickets, value: m.closed_tickets },
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

  const applyDashboardData = useCallback((data: NonNullable<Awaited<ReturnType<typeof loadDashboard>>['data']>) => {
    setApplications(data.applications);
    setGeneratedAt(data.generated_at || null);
    setRefreshMode(data.refresh_mode || 'snapshot');
    setRefreshWarnings(data.warnings || []);
  }, []);

  const load = useCallback(async (live = false) => {
    let hadCachedSnapshot = false;

    if (live) {
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
    const result = await loadDashboard('production', { live, skipCache: live || hadCachedSnapshot });

    if (!result.ok || !result.data) {
      if (!hadCachedSnapshot) {
        setError(result.error || 'Could not load dashboard');
        setApplications([]);
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

  const filteredApps = useMemo(() => {
    if (selectedAppId === 'all') return applications;
    return applications.filter((a) => `${a.environment}-${a.application_id}` === selectedAppId);
  }, [applications, selectedAppId]);

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

  const donutData = useMemo(
    () =>
      [
        { name: 'Open', value: totals.open_tickets, color: OPEN_COLOR },
        { name: 'Closed', value: totals.closed_tickets, color: CLOSED_COLOR },
      ].filter((d) => d.value > 0),
    [totals],
  );

  const donutTotal = totals.open_tickets + totals.closed_tickets;

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
                  Kissflow metrics · {refreshMode === 'live' ? 'Live data' : 'Cached snapshot'}
                  {generatedAt ? ` · Updated ${formatWhen(generatedAt)}` : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {refreshMode === 'live' && (
                <span className="rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200 ring-1 ring-emerald-400/30">
                  Live
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={() => void load(true)}
                disabled={loading || refreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5 md:p-6">
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
              <AppSlicer apps={applications} selectedId={selectedAppId} onSelect={setSelectedAppId} />

              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard label="Total users" value={totals.total_users} styleIndex={0} />
                  <KpiCard label="Active / signed in today" value={totals.sign_in_today} styleIndex={1} />
                  <KpiCard label="Open items" value={totals.open_tickets} styleIndex={2} />
                  <KpiCard label="Closed items" value={totals.closed_tickets} styleIndex={3} />
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
