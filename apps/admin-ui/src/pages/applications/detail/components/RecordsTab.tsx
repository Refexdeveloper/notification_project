import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  LayoutDashboard,
  RefreshCw,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import EmbedKpiCard, { NE_KPI_GRID_CLASS } from '@/components/feature/EmbedKpiCard';
import type { KissflowApplication } from '@/mocks/applications';
import { resolveBackendApplicationId } from '@/services/applicationsApi';
import { isBackendApiMode } from '@/services/backendApi';
import {
  loadApplicationRecordInventory,
  type AppRecordsResponse,
} from '@/services/appRecordsApi';
import { buildEntityBucketOptions, buildRefexCompanyOptions, sortCompanyFilterOptions } from '@/lib/refexCompanies';
import {
  assignedRecordLabel,
  companyCountsFromRecords,
  websiteCountsFromRecords,
  ensureFilterOption,
  entityCountsFromRecords,
  filterAppRecords,
  stampRecordsWithAssigneeCompany,
  summarizeAppRecords,
} from '@/lib/appDashboardClientFilter';
import DashboardLoadingOverlay from '@/components/feature/DashboardLoadingOverlay';
import { MisMobileRecordCard } from '@/components/feature/MisMobileCards';
import ExecutiveDateFilterBar from '@/components/feature/ExecutiveDateFilterBar';
import {
  currentIstYear,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';
import { displayDashCount, displayDashText, displayPersonCell, displayWhen } from '@/lib/dashboardEmpty';
import { personLabelMatches, uniquePersonLabels } from '@/lib/personName';
import { duration, easeOutSoft } from '@/lib/motion';
import EmbedDashboardHero from '@/components/feature/EmbedDashboardHero';
import { buildEmbedDashboardPath, readEmbedReturnUrl } from '@/lib/embedMode';
import {
  RecordsColumnDateFilter,
  RecordsColumnHeaderFilter,
  isDateRecordColumn,
} from '@/components/feature/RecordsColumnHeaderFilter';

type Props = {
  app: KissflowApplication;
  embed?: boolean;
};

const STATUS_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'rejected', label: 'Rejected' },
] as const;

function formatWhen(value: string | null | undefined): string {
  return displayWhen(value);
}

function formatInr(n: number | null | undefined): string {
  return `₹${Math.round(displayDashCount(n)).toLocaleString('en-IN')}`;
}

function statusTone(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'open') return 'bg-[#FFF3DF] text-[#A96A20] ring-[#F5E0C0]';
  if (s === 'closed') return 'bg-[#E8F7F0] text-[#287B5D] ring-[#CDEBD9]';
  if (s === 'rejected') return 'bg-[#FCECEF] text-[#B24E66] ring-[#F0D4DB]';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}


export default function RecordsTab({ app, embed = false }: Props) {
  const navigate = useNavigate();
  const backendAppId = resolveBackendApplicationId(app);
  const itsmCompanyMode = /itsm|service_management/i.test(String(app.appId || app.id || backendAppId || ''));
  const travelMode = /travel|expense_and_travel/i.test(String(app.appId || app.id || backendAppId || ''));
  const leadMode = /lead/i.test(String(app.appId || app.id || backendAppId || ''));
  const { id: routeAppId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const embedReturnTo = readEmbedReturnUrl(searchParams);
  const [data, setData] = useState<AppRecordsResponse | null>(null);
  const [inventory, setInventory] = useState<AppRecordsResponse['items']>([]);
  const [recordColumns, setRecordColumns] = useState<AppRecordsResponse['columns']>([]);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<string>('all');
  const [entity, setEntity] = useState('all');
  const [company, setCompany] = useState('all');
  const [assigned, setAssigned] = useState('');
  const [requester, setRequester] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
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
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [dateColumnFilters, setDateColumnFilters] = useState<Record<string, { from: string; to: string }>>({});
  const pageSize = 100;

  const resolvedDates = useMemo(
    () => resolveDateScope({ period, calendarYear, calendarMonth, dateFrom, dateTo }),
    [period, calendarYear, calendarMonth, dateFrom, dateTo],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 280);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [status, entity, company, assigned, requester, debouncedSearch, period, resolvedDates.from, resolvedDates.to, app.id, columnFilters, dateColumnFilters]);

  useEffect(() => {
    if (!isBackendApiMode()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    loadApplicationRecordInventory({
      applicationId: backendAppId,
      environment: app.environment,
      skipCache: refreshKey > 0,
      forceLive: refreshKey > 0,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error || 'Failed to load records');
        setInventory([]);
        setRecordColumns([]);
      } else {
        setInventory(result.items);
        setRecordColumns(result.columns);
      }
      setInventoryReady(true);
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [backendAppId, app.environment, refreshKey]);

  const stampedInventory = useMemo(
    () => stampRecordsWithAssigneeCompany(inventory, [], { itsmCompanyMode }),
    [inventory, itsmCompanyMode],
  );

  const filteredRows = useMemo(() => {
    if (!inventoryReady) return [];
    return filterAppRecords(stampedInventory, {
      entity,
      company,
      status,
      assigned: assigned || undefined,
      dateFrom: resolvedDates.from,
      dateTo: resolvedDates.to,
      itsmCompanyMode,
      travelMode,
      leadWebsiteMode: leadMode,
      activityDates: period === 'daily',
    }).filter((row) => {
      if (!debouncedSearch) return true;
      const q = debouncedSearch.toLowerCase();
      const hay = [
        row.request_id,
        row.subject,
        row.assigned_to,
        row.requested_by,
        row.entity,
        row.website,
        row.website_name,
        row.status,
      ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    }).filter((row) => {
      if (!requester) return true;
      return personLabelMatches(row.requested_by, requester);
    }).filter((row) => {
      const valueOk = Object.entries(columnFilters).every(([colId, wanted]) => {
        if (!wanted || wanted === 'all') return true;
        const raw = colId === 'assigned_to'
          ? assignedRecordLabel(row, { itsmCompanyMode })
          : String((row as Record<string, unknown>)[colId] ?? '');
        return String(raw).trim() === wanted;
      });
      if (!valueOk) return false;
      return Object.entries(dateColumnFilters).every(([colId, range]) => {
        if (!range.from && !range.to) return true;
        const key = String((row as Record<string, unknown>)[colId] || '').slice(0, 10);
        if (!key) return false;
        if (range.from && key < range.from) return false;
        if (range.to && key > range.to) return false;
        return true;
      });
    });
  }, [
    stampedInventory,
    inventoryReady,
    entity,
    company,
    status,
    assigned,
    requester,
    debouncedSearch,
    resolvedDates.from,
    resolvedDates.to,
    app.appId,
    app.id,
    backendAppId,
    itsmCompanyMode,
    leadMode,
    travelMode,
    columnFilters,
    dateColumnFilters,
  ]);

  useEffect(() => {
    if (!inventoryReady) return;
    const pageRows = filteredRows.slice(page * pageSize, page * pageSize + pageSize);
    const summary = summarizeAppRecords(filteredRows);
    setData({
      application_id: backendAppId,
      environment: String(app.environment),
      data_source: 'client_inventory',
      total: filteredRows.length,
      limit: pageSize,
      offset: page * pageSize,
      columns: recordColumns,
      items: pageRows,
      summary,
      inventory_summary: summary,
    });
  }, [filteredRows, page, pageSize, recordColumns, inventoryReady, backendAppId, app.environment]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const totalPages = useMemo(() => {
    const total = filteredRows.length;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [filteredRows.length, pageSize]);

  const entityOptions = useMemo(() => {
    const mode = travelMode ? 'refex_venwind' : itsmCompanyMode ? 'refex_extrovis' : 'all_buckets';
    const rows = entityCountsFromRecords(stampedInventory, { itsmCompanyMode, travelMode });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.id] = r.count;
    return ensureFilterOption(
      buildEntityBucketOptions(counts, { mode, allLabel: 'All entities' }),
      entity,
    );
  }, [entity, stampedInventory, itsmCompanyMode, travelMode]);

  const companyOptions = useMemo(() => {
    if (leadMode) {
      const rows = websiteCountsFromRecords(stampedInventory);
      return sortCompanyFilterOptions(ensureFilterOption(
        [{ id: 'all', label: 'All websites' }, ...rows.map((r) => ({ id: r.id, label: r.label }))],
        company,
      ));
    }
    const rows = companyCountsFromRecords(stampedInventory, { itsmCompanyMode, entity });
    if (itsmCompanyMode) {
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.id] = r.count;
      const catalog = buildRefexCompanyOptions(counts, { allLabel: 'All companies', entity });
      const extras = rows.filter(
        (r) => String(r.id).startsWith('raw:') && !catalog.some((c) => c.id === r.id),
      );
      return sortCompanyFilterOptions(ensureFilterOption([...catalog, ...extras], company));
    }
    if (!rows.length) {
      return buildRefexCompanyOptions({}, { allLabel: 'All companies', entity });
    }
    return sortCompanyFilterOptions(ensureFilterOption(
      [{ id: 'all', label: 'All companies' }, ...rows.map((r) => ({ id: r.id, label: r.label }))],
      company,
    ));
  }, [company, entity, stampedInventory, itsmCompanyMode, leadMode]);

  const assigneeOptions = useMemo(
    () => uniquePersonLabels(stampedInventory.map((row) => row.assigned_to)),
    [stampedInventory],
  );
  const requesterOptions = useMemo(
    () => uniquePersonLabels(stampedInventory.map((row) => row.requested_by)),
    [stampedInventory],
  );
  const showEntity = !leadMode;
  const showCompany = !(itsmCompanyMode && entity === 'extrovis');
  const showAssigned = assigneeOptions.length > 0;
  const showRequester = requesterOptions.length > 0;

  const summary = data?.summary || {
    total: Number(data?.total || 0),
    open: 0,
    closed: 0,
    rejected: 0,
  };

  const defaultPeriod: DatePresetId = 'fy';
  const filtersActive =
    status !== 'all'
    || entity !== 'all'
    || company !== 'all'
    || assigned
    || requester
    || search.trim()
    || period !== defaultPeriod
    || Object.values(columnFilters).some((v) => v && v !== 'all')
    || Object.values(dateColumnFilters).some((range) => range.from || range.to);

  const clearHeroFilters = () => {
    setEntity('all');
    setCompany('all');
    setPeriod(defaultPeriod);
    setDateFrom('');
    setDateTo('');
    setColumnFilters({});
    setDateColumnFilters({});
    setPage(0);
  };

  const clearFilters = () => {
    setStatus('all');
    setEntity('all');
    setCompany('all');
    setAssigned('');
    setRequester('');
    setSearch('');
    setDebouncedSearch('');
    setPeriod(defaultPeriod);
    setDateFrom('');
    setDateTo('');
    setColumnFilters({});
    setDateColumnFilters({});
    setPage(0);
  };

  const columns = data?.columns?.length
    ? data.columns
    : [
        { id: 'request_id', label: 'Request ID' },
        { id: 'subject', label: 'Subject' },
        { id: 'assigned_to', label: 'Assigned to' },
        { id: 'requested_by', label: 'Requested by' },
        { id: 'status', label: 'Status' },
        { id: 'entity', label: 'Entity' },
        { id: leadMode ? 'website' : 'company_name', label: leadMode ? 'Website' : 'Company name' },
        { id: 'created_at', label: 'Created' },
      ];

  const handleEntityChange = (next: string) => {
    setEntity(next);
    setCompany('all');
    setPage(0);
  };

  const filterBar = (
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
      onEntityChange={showEntity ? handleEntityChange : undefined}
      entityOptions={showEntity ? entityOptions : undefined}
      entityLabel="Entity"
      company={company}
      onCompanyChange={showCompany ? setCompany : undefined}
      companyOptions={showCompany ? companyOptions : undefined}
      companyLabel={leadMode ? 'Website' : 'Company'}
      refreshing={loading && Boolean(data)}
      embedLayout
      hideHints
      onClearFilters={clearHeroFilters}
    />
  );

  const embedHeroActions = embed ? (
    <>
      <button
        type="button"
        onClick={() => navigate(buildEmbedDashboardPath(routeAppId || app.id, embedReturnTo, searchParams), { replace: true })}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#EAF2FF] px-3 text-xs font-semibold text-[#3977BE] ring-1 ring-[#D0E0F5] hover:bg-[#DCE8FA]"
      >
        <LayoutDashboard className="h-3.5 w-3.5" />
        Full Engagement report
      </button>
      <button
        type="button"
        onClick={() => refresh()}
        disabled={loading || refreshing}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D0E0F5] bg-white px-3 text-xs font-semibold text-[#3977BE] hover:bg-[#F8FBFF] disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        Refresh records
      </button>
    </>
  ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.fast, ease: easeOutSoft }}
      className={`relative ${embed ? 'space-y-4' : 'space-y-3'}`}
    >
      <DashboardLoadingOverlay
        show={loading && !inventoryReady}
        mode="absolute"
        label="Loading records…"
      />

      <EmbedDashboardHero
        actions={
          embed ? (
            embedHeroActions
          ) : (
            <button
              type="button"
              onClick={() => refresh()}
              disabled={loading || refreshing}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D0E0F5] bg-white px-3 text-xs font-semibold text-[#3977BE] hover:bg-[#F8FBFF] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh records
            </button>
          )
        }
        filters={filterBar}
      />

      <div className={NE_KPI_GRID_CLASS}>
        <EmbedKpiCard
          label="Total"
          value={Number(summary.total || 0)}
          icon={Layers}
          styleIndex={0}
        />
        <EmbedKpiCard
          label="Open"
          value={Number(summary.open || 0)}
          icon={AlertCircle}
          styleIndex={1}
        />
        <EmbedKpiCard
          label="Closed"
          value={Number(summary.closed || 0)}
          icon={CheckCircle2}
          styleIndex={2}
        />
        <EmbedKpiCard
          label="Rejected"
          value={Number(summary.rejected || 0)}
          icon={XCircle}
          styleIndex={3}
        />
      </div>

      {/* Row filters — search, status, assignee */}
      <div
        className={`flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-2.5 shadow-sm ${
          embed ? 'rounded-xl border-slate-100 shadow-[0_4px_18px_rgba(112,144,176,0.08)]' : 'border-slate-200'
        }`}
      >
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/80 pl-8 pr-2 text-sm outline-none focus:border-blue-300 focus:bg-white"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-0.5">
          {STATUS_PILLS.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setStatus(pill.id)}
              className={`h-7 rounded-md px-2.5 text-[11px] font-semibold transition ${
                status === pill.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
        {showAssigned ? (
          <select
            className="h-8 min-w-[12rem] max-w-[18rem] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium"
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
          >
            <option value="">Assigned: anyone</option>
            {assigneeOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        ) : null}
        {showRequester ? (
          <select
            className="h-8 min-w-[12rem] max-w-[18rem] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium"
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
          >
            <option value="">Requester: anyone</option>
            {requesterOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        ) : null}
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        ) : null}
        <span className={`ml-auto text-xs font-semibold tabular-nums text-slate-600 ${embed ? 'hidden' : ''}`}>
          {Number(summary.total || 0).toLocaleString('en-IN')} records
          {data?.data_source === 'live_cache' ? ' · live' : ''}
        </span>
      </div>

      {error ? (
        <div className="flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      ) : null}

      <div
        className={`relative min-h-[220px] overflow-x-auto ${
          embed
            ? 'rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(112,144,176,0.12)]'
            : 'rounded-2xl border border-slate-200 bg-white shadow-sm'
        }`}
      >
        {embed ? (
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Records</h3>
            <span className="text-xs font-semibold tabular-nums text-slate-500">
              {Number(summary.total || 0).toLocaleString('en-IN')} rows
              {data?.data_source === 'live_cache' ? ' · live' : ''}
            </span>
          </div>
        ) : null}
        {!loading && !refreshing && !data?.items?.length ? (
          <div className={`text-center text-sm text-slate-500 ${embed ? 'py-10' : 'p-12'}`}>
            No records match these filters.
          </div>
        ) : data?.items?.length ? (
          <>
            <div className="space-y-2.5 lg:hidden">
              {data.items.map((row) => {
                const titleCol = columns.find((c) => c.id === 'subject') || columns[0];
                const idCol = columns.find((c) => c.id === 'request_id');
                const statusCol = columns.find((c) => c.id === 'status');
                const previewIds = new Set(['assigned_to', 'entity', 'company_name', 'website', 'created_at']);
                const fieldValue = (col: (typeof columns)[number]) => {
                  const raw = (row as Record<string, unknown>)[col.id];
                  if (col.id === 'request_id') return displayDashText(raw, '—');
                  if (col.id === 'status') return displayDashText(raw || row.status_raw, '—');
                  if (col.id === 'created_at') return formatWhen(String(raw || ''));
                  if (col.id === 'amount') return formatInr(typeof raw === 'number' ? raw : Number(raw));
                  if (col.id === 'assigned_to') return assignedRecordLabel(row, { itsmCompanyMode });
                  return displayPersonCell(raw);
                };
                return (
                  <MisMobileRecordCard
                    key={row.id}
                    title={titleCol ? fieldValue(titleCol) : '—'}
                    subtitle={idCol ? fieldValue(idCol) : undefined}
                    badge={statusCol ? (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusTone(String(row.status || ''))}`}>
                        {fieldValue(statusCol)}
                      </span>
                    ) : undefined}
                    fields={columns.filter((c) => previewIds.has(c.id)).map((c) => ({ label: c.label, value: fieldValue(c) }))}
                    extraFields={columns
                      .filter((c) => !previewIds.has(c.id) && c.id !== titleCol?.id && c.id !== idCol?.id && c.id !== statusCol?.id)
                      .map((c) => ({ label: c.label, value: fieldValue(c) }))}
                  />
                );
              })}
            </div>
            <div className={`hidden overflow-x-auto lg:block ${embed ? '-mx-5 -mb-5' : ''}`}>
              <table className="w-full min-w-[780px] text-sm sm:min-w-[980px]">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-100">
                    {columns.map((col) => (
                      <th
                        key={col.id}
                        className={`whitespace-nowrap font-semibold ${embed ? 'px-5 py-2.5' : 'px-3 py-2.5'} ${
                          col.id === 'request_id' ? 'min-w-[7.5rem]' : ''
                        }`}
                      >
                        {isDateRecordColumn(col.id) ? (
                          <RecordsColumnDateFilter
                            label={col.label}
                            from={dateColumnFilters[col.id]?.from || ''}
                            to={dateColumnFilters[col.id]?.to || ''}
                            onFromChange={(next) => {
                              setPage(0);
                              setDateColumnFilters((prev) => ({
                                ...prev,
                                [col.id]: { from: next, to: prev[col.id]?.to || '' },
                              }));
                            }}
                            onToChange={(next) => {
                              setPage(0);
                              setDateColumnFilters((prev) => ({
                                ...prev,
                                [col.id]: { from: prev[col.id]?.from || '', to: next },
                              }));
                            }}
                            onClear={() => {
                              setPage(0);
                              setDateColumnFilters((prev) => {
                                const next = { ...prev };
                                delete next[col.id];
                                return next;
                              });
                            }}
                          />
                        ) : (
                          <RecordsColumnHeaderFilter
                            label={col.label}
                            value={columnFilters[col.id] || ''}
                            options={[...new Set(
                              stampedInventory
                                .map((row) => {
                                  const raw = col.id === 'assigned_to'
                                    ? assignedRecordLabel(row, { itsmCompanyMode })
                                    : String((row as Record<string, unknown>)[col.id] ?? '');
                                  return String(raw).trim();
                                })
                                .filter((v) => v && v !== '—'),
                            )].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))}
                            onChange={(next) => {
                              setPage(0);
                              setColumnFilters((prev) => ({ ...prev, [col.id]: next }));
                            }}
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-[#EEF5FF]/70">
                      {columns.map((col) => {
                        const raw = (row as Record<string, unknown>)[col.id];
                        const cellPad = embed ? 'px-5 py-2.5' : 'px-3 py-2.5';
                        if (col.id === 'request_id') {
                          return (
                            <td key={col.id} className={`whitespace-nowrap ${cellPad}`}>
                              <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[12px] font-semibold tracking-wide text-slate-900 ring-1 ring-slate-200">
                                {displayDashText(raw, '—')}
                              </span>
                            </td>
                          );
                        }
                        if (col.id === 'status') {
                          return (
                            <td key={col.id} className={cellPad}>
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusTone(String(raw || ''))}`}
                              >
                                {displayDashText(raw || row.status_raw, '—')}
                              </span>
                            </td>
                          );
                        }
                        if (col.id === 'created_at') {
                          return (
                            <td key={col.id} className={`whitespace-nowrap tabular-nums text-slate-600 ${cellPad}`}>
                              {formatWhen(String(raw || ''))}
                            </td>
                          );
                        }
                        if (col.id === 'amount') {
                          return (
                            <td key={col.id} className={`whitespace-nowrap tabular-nums text-slate-800 ${cellPad}`}>
                              {formatInr(typeof raw === 'number' ? raw : Number(raw))}
                            </td>
                          );
                        }
                        const text = col.id === 'assigned_to'
                          ? assignedRecordLabel(row, { itsmCompanyMode })
                          : displayPersonCell(raw);
                        const wrapIds = new Set(['entity', 'company_name', 'website', 'requested_by', 'assigned_to', 'subject']);
                        return (
                          <td
                            key={col.id}
                            title={text}
                            className={`${cellPad} text-slate-800 ${
                              wrapIds.has(col.id)
                                ? 'min-w-[11rem] max-w-[18rem] whitespace-normal break-words'
                                : 'max-w-[220px]'
                            }`}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 ${
                embed ? 'mx-[-1.25rem] mb-[-1.25rem] px-5 py-2.5' : 'px-3 py-2.5'
              }`}
            >
              <p className="text-xs text-slate-500">
                Page {page + 1} of {totalPages} · {Number(data.total || 0).toLocaleString('en-IN')} rows
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <button
                  type="button"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </motion.div>
  );
}
