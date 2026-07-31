import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
  History,
  LayoutGrid,
  Mail,
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
import { fadeUpItem, springSoft, staggerContainer } from '@/lib/motion';
import { isBackendApiMode } from '@/services/backendApi';
import { loadDashboard, type DashboardApplication, type DashboardSendRow } from '@/services/dashboardApi';

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

function statusChip(status: string): string {
  if (status === 'delivered' || status === 'completed') return 'chip-success capitalize';
  if (status === 'failed') return 'chip-danger capitalize';
  return 'chip-warn capitalize';
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

function AnimatedValue({ value, suffix }: { value: number; suffix?: string }) {
  return (
    <motion.span
      key={`${value}${suffix ?? ''}`}
      initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="inline-block tabular-nums"
    >
      {value.toLocaleString()}
      {suffix}
    </motion.span>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  accent,
  action,
}: {
  icon: typeof LayoutGrid;
  title: string;
  accent: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className={`h-8 w-1 rounded-full bg-gradient-to-b ${accent}`} />
        <div className="flex items-center gap-2">
          <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${accent} shadow-sm`}>
            <Icon className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{title}</span>
        </div>
      </div>
      {action}
    </div>
  );
}

function DashboardCard({
  title,
  subtitle,
  icon: Icon,
  children,
  className = '',
  delay = 0,
}: {
  title: string;
  subtitle?: string;
  icon?: typeof BarChart3;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      variants={fadeUpItem}
      initial="initial"
      animate="animate"
      transition={{ ...springSoft, delay: reduceMotion ? 0 : delay }}
      className={`group flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-white/95 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-shadow duration-300 hover:shadow-[0_16px_40px_rgba(15,23,42,0.09)] ${className}`}
      style={{ borderColor: CARD_BORDER }}
    >
      <div
        className="relative shrink-0 overflow-hidden border-b px-5 py-3.5"
        style={{ borderColor: CARD_BORDER }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-50 via-white to-sky-50/80 opacity-100 transition-opacity duration-300 group-hover:opacity-90" />
        <div className="relative flex items-start gap-3">
          {Icon ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 ring-1 ring-slate-200/80">
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
    </motion.div>
  );
}

function KpiCard({
  label,
  value,
  suffix,
  styleIndex = 0,
  delay = 0,
}: {
  label: string;
  value: number;
  suffix?: string;
  styleIndex?: number;
  delay?: number;
}) {
  const style = KPI_STYLES[styleIndex % KPI_STYLES.length];
  const Icon = style.icon;
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      variants={fadeUpItem}
      initial="initial"
      animate="animate"
      transition={{ ...springSoft, delay: reduceMotion ? 0 : delay }}
      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.02 }}
      className={`relative min-w-0 overflow-hidden rounded-2xl bg-gradient-to-br ${style.accent} p-5 text-white shadow-xl ${style.glow} transition-shadow duration-300 hover:shadow-2xl`}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0"
        animate={reduceMotion ? undefined : { x: ['-120%', '120%'] }}
        transition={reduceMotion ? undefined : { duration: 4, repeat: Infinity, repeatDelay: 2, ease: 'easeInOut' }}
      />
      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/15 blur-sm" />
      <div className="pointer-events-none absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-black/10 blur-md" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-white/80">{label}</p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight">
            <AnimatedValue value={value} suffix={suffix} />
          </p>
        </div>
        <motion.div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm"
          whileHover={reduceMotion ? undefined : { rotate: 8, scale: 1.05 }}
          transition={springSoft}
        >
          <Icon className="h-5 w-5 text-white" />
        </motion.div>
      </div>
    </motion.div>
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
    <div className="rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)] backdrop-blur-md">
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
    <div className="rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)] backdrop-blur-md">
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[240px] rounded-2xl bg-slate-200/70" />
        ))}
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
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      variants={fadeUpItem}
      className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white/80 px-4 py-3 shadow-[0_4px_20px_rgba(15,23,42,0.05)] backdrop-blur-md"
      style={{ borderColor: CARD_BORDER }}
    >
      <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Application</span>
      {(['all', ...apps.map((a) => `${a.environment}-${a.application_id}`)] as const).map((id) => {
        const isAll = id === 'all';
        const active = selectedId === id;
        const label = isAll ? 'All apps' : apps.find((a) => `${a.environment}-${a.application_id}` === id)?.application_name ?? id;

        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => onSelect(isAll ? 'all' : id)}
            layout={!reduceMotion}
            whileTap={reduceMotion ? undefined : { scale: 0.97 }}
            className={`max-w-[180px] cursor-pointer truncate rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
              active
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {label}
          </motion.button>
        );
      })}
    </motion.div>
  );
}

function AppDetailCard({
  app,
  accentIndex,
  onOpen,
  delay,
}: {
  app: DashboardApplication;
  accentIndex: number;
  onOpen: () => void;
  delay: number;
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
    <DashboardCard title={app.application_name} subtitle={subtitle} delay={delay}>
      <div className={`mb-4 h-1 w-full rounded-full bg-gradient-to-r ${accent}`} />
      <div className="space-y-2">
        {rows.map((row, index) => (
          <motion.div
            key={row.metric}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: delay + index * 0.04, duration: 0.3 }}
            className="flex items-center justify-between rounded-xl bg-slate-50/80 px-3 py-2.5 ring-1 ring-slate-100 transition-colors hover:bg-slate-100/80"
          >
            <span className="text-xs font-medium text-slate-600">{row.metric}</span>
            <span className="text-sm font-bold tabular-nums text-slate-900">{row.value}</span>
          </motion.div>
        ))}
      </div>
      <motion.button
        type="button"
        onClick={onOpen}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={`mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r ${accent} px-3 py-2.5 text-xs font-semibold text-white shadow-md transition-shadow hover:shadow-lg`}
      >
        Open application
        <ArrowRight className="h-3.5 w-3.5" />
      </motion.button>
    </DashboardCard>
  );
}

function SendsTable({ rows, delay }: { rows: DashboardSendRow[]; delay: number }) {
  return (
    <DashboardCard
      title="Recent report sends"
      subtitle="Scheduled email deliveries from PostgreSQL"
      icon={Mail}
      delay={delay}
    >
      {rows.length === 0 ? (
        <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <Mail className="h-5 w-5 text-slate-400" />
          </div>
          <p className="text-sm text-slate-500">No scheduled report sends logged yet.</p>
        </div>
      ) : (
        <div className="-mx-1 space-y-2 overflow-x-auto">
          {rows.map((row, index) => (
            <motion.div
              key={row.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: delay + index * 0.04, duration: 0.28 }}
              className="grid grid-cols-1 items-center gap-2 rounded-xl border border-slate-100 bg-gradient-to-r from-white to-slate-50/80 px-4 py-3 transition-all duration-200 hover:border-slate-200 hover:shadow-sm md:grid-cols-[1.4fr_100px_160px]"
            >
              <p className="truncate text-sm font-semibold text-slate-900">{row.application_name}</p>
              <span className={`${statusChip(row.status)} w-fit`}>{row.status}</span>
              <p className="text-xs tabular-nums text-slate-500 md:text-right">{formatWhen(row.sent_at)}</p>
            </motion.div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const backendMode = isBackendApiMode();
  const reduceMotion = useReducedMotion();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [recentSends, setRecentSends] = useState<DashboardSendRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [refreshMode, setRefreshMode] = useState<'live' | 'snapshot' | null>(null);
  const [refreshWarnings, setRefreshWarnings] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | 'all'>('all');

  const load = useCallback(async (live = false) => {
    if (live) setRefreshing(true);
    else setLoading(true);
    setError('');
    const result = await loadDashboard('production', { live });
    if (!result.ok || !result.data) {
      setError(result.error || 'Could not load dashboard');
      setApplications([]);
      setRecentSends([]);
    } else {
      setApplications(result.data.applications);
      setRecentSends(result.data.recent_sends);
      setGeneratedAt(result.data.generated_at || null);
      setRefreshMode(result.data.refresh_mode || (live ? 'live' : 'snapshot'));
      setRefreshWarnings(result.data.warnings || []);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

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
        className="-mx-1 overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-50 via-white to-sky-50/40 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:mx-0"
        style={{ borderColor: CARD_BORDER }}
      >
        <div className="relative overflow-hidden border-b bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 px-5 py-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(129,140,248,0.22),transparent_40%)]" />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-wrap items-center justify-between gap-4"
          >
            <div className="flex min-w-0 items-center gap-4">
              <motion.div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm"
                whileHover={reduceMotion ? undefined : { scale: 1.05, rotate: -3 }}
              >
                <BarChart3 className="h-6 w-6 text-sky-200" />
              </motion.div>
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
                <motion.span
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200 ring-1 ring-emerald-400/30"
                >
                  Live
                </motion.span>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
                onClick={() => void load(true)}
                disabled={loading || refreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </motion.div>
        </div>

        <div className="relative space-y-6 p-5 md:p-6">
          <AnimatePresence>
            {refreshing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-x-5 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-slate-200 md:inset-x-6"
              >
                <motion.div
                  className="h-full w-1/3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                  animate={{ x: ['-100%', '400%'] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {refreshWarnings.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-1 rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
            >
              {refreshWarnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </motion.div>
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
            <motion.div
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              className="space-y-6"
            >
              <AppSlicer apps={applications} selectedId={selectedAppId} onSelect={setSelectedAppId} />

              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedAppId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: reduceMotion ? 0.01 : 0.32, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-6"
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard label="Total users" value={totals.total_users} styleIndex={0} delay={0.05} />
                    <KpiCard label="Active / signed in today" value={totals.sign_in_today} styleIndex={1} delay={0.1} />
                    <KpiCard label="Open items" value={totals.open_tickets} styleIndex={2} delay={0.15} />
                    <KpiCard label="Closed items" value={totals.closed_tickets} styleIndex={3} delay={0.2} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <DashboardCard
                      className="lg:col-span-2"
                      title="Open vs closed by application"
                      subtitle="Clustered column chart"
                      icon={TrendingUp}
                      delay={0.12}
                    >
                      {barChartData.length === 0 ? (
                        <p className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
                          No application data
                        </p>
                      ) : (
                        <ResponsiveContainer width="100%" height={240}>
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
                              animationDuration={reduceMotion ? 0 : 800}
                              animationEasing="ease-out"
                            />
                            <Bar
                              dataKey="closed"
                              name="Closed"
                              fill="url(#closedBarGradient)"
                              radius={[8, 8, 0, 0]}
                              maxBarSize={44}
                              animationDuration={reduceMotion ? 0 : 900}
                              animationEasing="ease-out"
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </DashboardCard>

                    <DashboardCard title="Work item mix" subtitle="Donut · selected scope" icon={PieChartIcon} delay={0.16}>
                      {donutData.length === 0 ? (
                        <p className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
                          No ticket data
                        </p>
                      ) : (
                        <div className="relative h-[240px]">
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
                                animationDuration={reduceMotion ? 0 : 900}
                                animationEasing="ease-out"
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

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filteredApps.length === 0 ? (
                      <motion.div
                        variants={fadeUpItem}
                        className="col-span-full rounded-2xl border bg-white/80 p-10 text-center text-sm text-slate-500 shadow-sm"
                        style={{ borderColor: CARD_BORDER }}
                      >
                        No registered applications yet.
                      </motion.div>
                    ) : (
                      filteredApps.map((app, index) => (
                        <AppDetailCard
                          key={`${app.environment}-${app.application_id}`}
                          app={app}
                          accentIndex={index}
                          delay={0.08 + index * 0.05}
                          onOpen={() => navigate(`/applications/${app.environment}-${app.application_id}`)}
                        />
                      ))
                    )}
                  </div>

                  <SectionHeader
                    icon={History}
                    title="Send history"
                    accent="from-violet-500 to-fuchsia-600"
                    action={
                      <button
                        type="button"
                        onClick={() => navigate('/history')}
                        className="cursor-pointer rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-blue-600 transition-all duration-200 hover:bg-blue-50 hover:shadow-sm"
                      >
                        View all
                      </button>
                    }
                  />

                  <SendsTable rows={recentSends} delay={0.2} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>
    </Layout>
  );
}
