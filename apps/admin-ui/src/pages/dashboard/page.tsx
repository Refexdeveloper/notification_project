import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  LayoutGrid,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
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
import ExecutiveDateFilterBar from '@/components/feature/ExecutiveDateFilterBar';
import DashboardLoadingOverlay from '@/components/feature/DashboardLoadingOverlay';
import {
  currentIstYear,
  istTodayYmd,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';
import { buildAppOpenPath, readEmbedFromSearch, withEmbedParams } from '@/lib/embedMode';
import EmbedDashboardHero from '@/components/feature/EmbedDashboardHero';
import EmbedKpiCard, { EMBED_ADOPTION_THEME, EMBED_EXEC_KPI_THEMES, NE_KPI_GRID_CLASS } from '@/components/feature/EmbedKpiCard';
import { displayDashCount, displayWhen } from '@/lib/dashboardEmpty';
import { buildEntityBucketOptions, sortCompanyFilterOptions } from '@/lib/refexCompanies';
import { loadApplicationRecordInventory } from '@/services/appRecordsApi';
import type { AppRecordRow } from '@/services/appRecordsApi';
import {
  companyCountsFromRecords,
  countTodayActivity,
  ensureFilterOption,
  entityCountsFromRecords,
  filterAppRecords,
  summarizeAppRecords,
} from '@/lib/appDashboardClientFilter';

const CARD_BORDER = 'rgba(226, 232, 240, 0.9)';

const APP_CARD_ACCENTS = [
  { bg: '#EAF3FF', text: '#3977BE' },
  { bg: '#E8F7F1', text: '#287B5D' },
  { bg: '#FFF2E4', text: '#A96A20' },
  { bg: '#F0EDFF', text: '#5B4B9A' },
  { bg: '#EAF7FB', text: '#2A7A8C' },
] as const;

function formatWhen(value: string | null | undefined): string {
  return displayWhen(value);
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
  return (
    <EmbedKpiCard
      label={label}
      value={value}
      sub={sub}
      suffix={suffix}
      styleIndex={styleIndex}
      themes={EMBED_EXEC_KPI_THEMES}
      appKind="consolidated"
    />
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
    { metric: 'Total items', value: displayDashCount(appTotalItems(m)) },
    { metric: labels.sign_in_today, value: displayDashCount(m.sign_in_today) },
    { metric: labels.sign_in_rate_overall, value: `${displayDashCount(m.sign_in_rate_overall)}%` },
    { metric: labels.sign_in_rate_today, value: `${displayDashCount(m.sign_in_rate_today)}%` },
    { metric: labels.open_tickets, value: displayDashCount(m.open_tickets) },
    { metric: 'Opened today', value: displayDashCount(m.opened_today) },
    { metric: labels.closed_tickets, value: displayDashCount(m.closed_tickets) },
    { metric: 'Closed today', value: displayDashCount(m.closed_today) },
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
      subtitle={subtitle}
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
  const [entity, setEntity] = useState('all');
  const [company, setCompany] = useState('all');
  const [filteredApplications, setFilteredApplications] = useState<DashboardApplication[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [catalogRecords, setCatalogRecords] = useState<AppRecordRow[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);

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
      skipCache: Boolean(forceRefresh),
    });
    if (forceRefresh) {
      void refreshDashboardLive('production').catch(() => undefined);
    }

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
    if (!applications.length || !backendMode) return;
    let cancelled = false;
    void (async () => {
      const batchSize = 3;
      const rows: AppRecordRow[] = [];
      for (let i = 0; i < applications.length; i += batchSize) {
        if (cancelled) return;
        const batch = applications.slice(i, i + batchSize);
        const part = await Promise.all(
          batch.map(async (app) => {
            try {
              const inv = await loadApplicationRecordInventory({
                applicationId: app.application_id,
                environment: app.environment as 'production' | 'development',
                skipCache: false,
              });
              return (inv.ok ? inv.items : []).map((row) => ({
                ...row,
                application_id: app.application_id,
              }));
            } catch {
              return [];
            }
          }),
        );
        rows.push(...part.flat());
      }
      if (!cancelled) {
        setCatalogRecords(rows);
        setCatalogReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applications, backendMode]);

  useEffect(() => {
    // All time + All entities/companies: use overview snapshot.
    if (period === 'all' && entity === 'all' && company === 'all') {
      setFilteredApplications(null);
      setFilterLoading(false);
      return;
    }

    if (!applications.length) return;

    // Today with no entity/company: opened_today / closed_today on the overview payload.
    if (period === 'daily' && entity === 'all' && company === 'all') {
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

    if (!catalogReady) {
      // Keep snapshot KPIs on screen — do not block landing while inventories load.
      setFilterLoading(false);
      return;
    }

    setFilterLoading(false);
    const scoped = applications.map((app) => {
      const isItsm = /itsm|service_management/i.test(app.application_id || app.application_name || '');
      const isTravel = /travel|expense_and_travel/i.test(app.application_id || app.application_name || '');
      const mine = catalogRecords.filter(
        (r) => String(r.application_id || '') === app.application_id,
      );
      const filtered = filterAppRecords(mine, {
        entity,
        company,
        dateFrom: resolvedDates.from,
        dateTo: resolvedDates.to,
        itsmCompanyMode: isItsm,
        travelMode: isTravel,
        activityDates: period === 'daily',
      });
      const sum = summarizeAppRecords(filtered);
      const today = countTodayActivity(filtered, istTodayYmd());
      return {
        ...app,
        metrics: {
          ...app.metrics,
          open_tickets: sum.open,
          closed_tickets: sum.closed,
          rejected: sum.rejected,
          total_items: sum.total,
          opened_today: today.opened,
          closed_today: today.closed,
        },
      } satisfies DashboardApplication;
    });
    setFilteredApplications(scoped);
  }, [applications, catalogReady, catalogRecords, period, resolvedDates, entity, company]);

  const entityOptions = useMemo(() => {
    const rows = entityCountsFromRecords(catalogRecords);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.id] = r.count;
    return ensureFilterOption(
      buildEntityBucketOptions(counts, { mode: 'all_buckets', allLabel: 'All entities' }),
      entity,
    );
  }, [catalogRecords, entity]);
  const companyOptions = useMemo(() => {
    const rows = companyCountsFromRecords(catalogRecords, { entity });
    return sortCompanyFilterOptions(ensureFilterOption(
      [{ id: 'all', label: 'All companies' }, ...rows.map((r) => ({ id: r.id, label: r.label }))],
      company,
    ));
  }, [catalogRecords, company, entity]);

  const displayApplications = filteredApplications ?? applications;

  const applicationFilterOptions = useMemo(
    () => [
      { id: 'all', label: 'All apps' },
      ...displayApplications.map((a) => ({
        id: `${a.environment}-${a.application_id}`,
        label: a.application_name,
      })),
    ],
    [displayApplications],
  );

  const handleEntityChange = (next: string) => {
    setEntity(next);
    setCompany('all');
  };

  const dashboardFilterBar = (
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
      onEntityChange={handleEntityChange}
      entityOptions={entityOptions}
      entityLabel="Entity"
      company={company}
      onCompanyChange={setCompany}
      companyOptions={companyOptions}
      companyLabel="Company"
      application={selectedAppId}
      onApplicationChange={(id) => {
        const next = id === 'all' ? 'all' : id;
        setSelectedAppId(next);
        if (embed) {
          setSearchParams(withEmbedParams(searchParams, { app: next === 'all' ? null : next }), { replace: true });
        }
      }}
      applicationOptions={applicationFilterOptions}
      applicationLabel="Application"
      refreshing={refreshing || filterLoading}
      hideHints
      embedLayout
      onClearFilters={() => {
        setPeriod('fy');
        setSelectedAppId('all');
        setEntity('all');
        setCompany('all');
        setDateFrom('');
        setDateTo('');
        if (embed) {
          setSearchParams(withEmbedParams(searchParams, { app: null }), { replace: true });
        }
      }}
    />
  );

  const filteredApps = useMemo(() => {
    if (selectedAppId === 'all') return displayApplications;
    return displayApplications.filter((a) => `${a.environment}-${a.application_id}` === selectedAppId);
  }, [displayApplications, selectedAppId]);

  const totals = useMemo(() => aggregateMetrics(filteredApps), [filteredApps]);

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
      <div className="relative rounded-3xl border border-slate-100 bg-transparent shadow-none">
        <DashboardLoadingOverlay
          show={Boolean(refreshing || filterLoading || (loading && applications.length === 0))}
          mode="fixed"
          label={
            refreshing
              ? 'Updating dashboard…'
              : filterLoading
                ? 'Applying date filters…'
                : 'Loading dashboard…'
          }
        />
        <div className="relative space-y-4 px-0 py-0 md:px-0">
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
          ) : loading && applications.length === 0 ? null : (
            <div className="space-y-4">
              <EmbedDashboardHero
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void load(true)}
                    disabled={loading || refreshing}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Updating…' : 'Refresh'}
                  </Button>
                }
                filters={dashboardFilterBar}
              />

              <div className="space-y-4">
                <div className="space-y-4">
                  <div className={NE_KPI_GRID_CLASS}>
                    <KpiCard
                      label="Total items"
                      value={totals.open_tickets + totals.closed_tickets + totals.rejected}
                      styleIndex={0}
                    />
                    <KpiCard label="Total users" value={totals.total_users} styleIndex={1} />
                    <KpiCard label="Active / signed in today" value={totals.sign_in_today} styleIndex={2} />
                    <EmbedKpiCard
                      label="Adoption today"
                      value={
                        totals.total_users
                          ? Math.round((totals.sign_in_today / totals.total_users) * 100)
                          : 0
                      }
                      suffix="%"
                      sub="Signed in today ÷ total users"
                      themes={[EMBED_ADOPTION_THEME]}
                      styleIndex={0}
                    />
                    <KpiCard label="Open items" value={totals.open_tickets} styleIndex={2} />
                    <KpiCard label="Closed items" value={totals.closed_tickets} styleIndex={3} />
                    <KpiCard label="Opened today" value={totals.opened_today} styleIndex={0} />
                    <KpiCard label="Closed today" value={totals.closed_today} styleIndex={2} />
                  </div>
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
                        embed={embed}
                        onOpen={() =>
                          navigate(
                            buildAppOpenPath({
                              environment: app.environment,
                              applicationId: app.application_id,
                              tab: 'dashboard',
                              embed,
                              fromSearch: searchParams,
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
