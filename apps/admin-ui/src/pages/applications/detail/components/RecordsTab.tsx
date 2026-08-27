import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import { isBackendApiMode } from '@/services/backendApi';
import {
  loadApplicationRecords,
  type AppRecordsResponse,
} from '@/services/appRecordsApi';
import DashboardLoadingOverlay from '@/components/feature/DashboardLoadingOverlay';
import ExecutiveDateFilterBar from '@/components/feature/ExecutiveDateFilterBar';
import {
  currentIstYear,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';
import { duration, easeOutSoft } from '@/lib/motion';

type Props = {
  app: KissflowApplication;
};

const STATUS_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'rejected', label: 'Rejected' },
] as const;

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatInr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
}

function statusTone(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'open') return 'bg-[#FFF3DF] text-[#A96A20] ring-[#F5E0C0]';
  if (s === 'closed') return 'bg-[#E8F7F0] text-[#287B5D] ring-[#CDEBD9]';
  if (s === 'rejected') return 'bg-[#FCECEF] text-[#B24E66] ring-[#F0D4DB]';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}

function KpiMini({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: { bg: string; text: string; muted: string; iconBg: string };
  icon: ReactNode;
}) {
  return (
    <div className="rounded-xl p-2.5 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#E6EBF2]" style={{ background: tone.bg }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: tone.muted }}>{label}</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums leading-none sm:text-xl" style={{ color: tone.text }}>
            {Number(value || 0).toLocaleString('en-IN')}
          </p>
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: tone.iconBg, color: tone.text }}>{icon}</div>
      </div>
    </div>
  );
}

export default function RecordsTab({ app }: Props) {
  const [data, setData] = useState<AppRecordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [entity, setEntity] = useState('all');
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
  }, [status, entity, assigned, requester, debouncedSearch, period, resolvedDates.from, resolvedDates.to, app.id]);

  useEffect(() => {
    if (!isBackendApiMode()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    loadApplicationRecords({
      applicationId: app.appId || app.id,
      environment: app.environment,
      status,
      entity,
      assigned: assigned || undefined,
      requester: requester || undefined,
      search: debouncedSearch,
      dateFrom: resolvedDates.from,
      dateTo: resolvedDates.to,
      limit: pageSize,
      offset: page * pageSize,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error || 'Failed to load records');
        setData(null);
      } else {
        setData(result.data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    app.appId,
    app.id,
    app.environment,
    status,
    entity,
    assigned,
    requester,
    debouncedSearch,
    page,
    resolvedDates.from,
    resolvedDates.to,
  ]);

  const totalPages = useMemo(() => {
    const total = Number(data?.total || 0);
    return Math.max(1, Math.ceil(total / pageSize));
  }, [data?.total]);

  const filterOpts = data?.filter_options;
  const entityOptions = useMemo(() => {
    const opts = filterOpts?.entities?.length ? filterOpts.entities : [];
    if (!opts.some((o) => o.id === 'all')) {
      return [{ id: 'all', label: 'All entities' }, ...opts];
    }
    return opts;
  }, [filterOpts?.entities]);
  const assigneeOptions = filterOpts?.assignees?.length ? filterOpts.assignees : [];
  const requesterOptions = filterOpts?.requesters?.length ? filterOpts.requesters : [];
  const isSolar = /solar|reinvestment|site_expense/i.test(String(app.appId || app.id || ''));
  const showEntity = !isSolar && filterOpts?.show_entity !== false && entityOptions.length > 1;
  const showAssigned = filterOpts?.show_assigned !== false && assigneeOptions.length > 0;
  const showRequester = filterOpts?.show_requester !== false;

  const summary = data?.summary || {
    total: Number(data?.total || 0),
    open: 0,
    closed: 0,
    rejected: 0,
  };

  const filtersActive =
    status !== 'all' || entity !== 'all' || assigned || requester || search.trim() || period !== 'fy';

  const clearFilters = () => {
    setStatus('all');
    setEntity('all');
    setAssigned('');
    setRequester('');
    setSearch('');
    setDebouncedSearch('');
    setPeriod('fy');
    setDateFrom('');
    setDateTo('');
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
        { id: 'created_at', label: 'Created' },
      ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.fast, ease: easeOutSoft }}
      className="relative space-y-3"
    >
      <DashboardLoadingOverlay
        show={loading}
        mode="fixed"
        label={data ? 'Refreshing records…' : 'Loading records…'}
      />

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
          onEntityChange={showEntity ? setEntity : undefined}
          entityOptions={showEntity ? entityOptions : undefined}
          refreshing={loading && Boolean(data)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiMini
          label="Total"
          value={Number(summary.total || 0)}
          tone={{ bg: '#EAF3FF', text: '#1E3A5F', muted: '#5B7A9D', iconBg: '#D6E8FF' }}
          icon={<Layers className="h-3.5 w-3.5" />}
        />
        <KpiMini
          label="Open"
          value={Number(summary.open || 0)}
          tone={{ bg: '#FFF2E4', text: '#7A4A1A', muted: '#A96A20', iconBg: '#FFE8CC' }}
          icon={<AlertCircle className="h-3.5 w-3.5" />}
        />
        <KpiMini
          label="Closed"
          value={Number(summary.closed || 0)}
          tone={{ bg: '#E8F7F1', text: '#1F5C45', muted: '#287B5D', iconBg: '#D3EFE3' }}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <KpiMini
          label="Rejected"
          value={Number(summary.rejected || 0)}
          tone={{ bg: '#FDECEF', text: '#7A3044', muted: '#B24E66', iconBg: '#F8D9E0' }}
          icon={<XCircle className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Filters + total in one compact bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
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
            className="h-8 max-w-[140px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium"
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
            className="h-8 max-w-[140px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium"
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
        <span className="ml-auto text-xs font-semibold tabular-nums text-slate-600">
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

      <div className="relative min-h-[220px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!loading && !data?.items?.length ? (
          <div className="p-12 text-center text-sm text-slate-500">No records match these filters.</div>
        ) : data?.items?.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm sm:min-w-[980px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/90 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    {columns.map((col) => (
                      <th
                        key={col.id}
                        className={`whitespace-nowrap px-3 py-2.5 font-semibold ${
                          col.id === 'request_id' ? 'min-w-[7.5rem]' : ''
                        }`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-sky-50/40">
                      {columns.map((col) => {
                        const raw = (row as Record<string, unknown>)[col.id];
                        if (col.id === 'request_id') {
                          return (
                            <td key={col.id} className="whitespace-nowrap px-3 py-2.5">
                              <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[12px] font-semibold tracking-wide text-slate-900 ring-1 ring-slate-200">
                                {raw == null || raw === '' ? '—' : String(raw)}
                              </span>
                            </td>
                          );
                        }
                        if (col.id === 'status') {
                          return (
                            <td key={col.id} className="px-3 py-2.5">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusTone(String(raw || ''))}`}
                              >
                                {String(raw || row.status_raw || '—')}
                              </span>
                            </td>
                          );
                        }
                        if (col.id === 'created_at') {
                          return (
                            <td key={col.id} className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                              {formatWhen(String(raw || ''))}
                            </td>
                          );
                        }
                        if (col.id === 'amount') {
                          return (
                            <td key={col.id} className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-800">
                              {formatInr(typeof raw === 'number' ? raw : Number(raw))}
                            </td>
                          );
                        }
                        return (
                          <td key={col.id} className="max-w-[200px] truncate px-3 py-2.5 text-slate-800 sm:max-w-[220px]">
                            {raw == null || raw === '' ? '—' : String(raw)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
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
