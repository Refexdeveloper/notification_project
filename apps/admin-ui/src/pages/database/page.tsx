import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Eye,
  Search,
  Table2,
  X,
} from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { EmptyState } from '@/components/ui/EmptyState';
import { friendlyApplicationName } from '@/lib/processLabels';
import {
  loadDatabaseApplications,
  loadDatabaseItems,
  type DatabaseAppRow,
  type DatabaseColumn,
  type DatabaseItemRow,
  type DatabaseProcessOption,
} from '@/services/databaseApi';

const PAGE_SIZES = [25, 50, 100] as const;
const COLS_KEY = 'ne_db_cols_v1';

function formatWhen(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
}

function readSavedColumns(applicationId: string): string[] {
  try {
    const raw = localStorage.getItem(`${COLS_KEY}:${applicationId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveColumns(applicationId: string, ids: string[]) {
  try {
    localStorage.setItem(`${COLS_KEY}:${applicationId}`, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function cellText(row: DatabaseItemRow, key: string) {
  const direct = (row as Record<string, unknown>)[key];
  const payload = row.source_payload && typeof row.source_payload === 'object'
    ? (row.source_payload as Record<string, unknown>)[key]
    : undefined;
  const value = direct != null && direct !== '' ? direct : payload;
  if (value == null || value === '') return '—';
  if (key.includes('_at') || key.endsWith('At') || key.endsWith('_date')) {
    const formatted = formatWhen(String(value));
    if (formatted !== String(value) || !Number.isNaN(Date.parse(String(value)))) return formatted;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function payloadPreview(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '{ }';
  return `{ ${Object.keys(payload as Record<string, unknown>).length} keys }`;
}

function DatabaseColumnPicker({
  open,
  anchorRef,
  fields,
  query,
  draftColumns,
  onQueryChange,
  onToggle,
  onReset,
  onCancel,
  onApply,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  fields: DatabaseColumn[];
  query: string;
  draftColumns: string[];
  onQueryChange: (value: string) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setStyle(null);
      return undefined;
    }
    const place = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const gutter = 8;
      const width = Math.min(360, Math.max(260, window.innerWidth - gutter * 2));
      let left = rect.right - width;
      if (left < gutter) left = gutter;
      if (left + width > window.innerWidth - gutter) {
        left = Math.max(gutter, window.innerWidth - width - gutter);
      }
      const maxHeight = Math.min(440, window.innerHeight - gutter * 2);
      let top = rect.bottom + 8;
      if (top + Math.min(maxHeight, 320) > window.innerHeight - gutter) {
        top = Math.max(gutter, rect.top - 8 - maxHeight);
      }
      setStyle({
        position: 'fixed',
        top,
        left,
        width,
        maxHeight: Math.max(240, window.innerHeight - top - gutter),
        zIndex: 10000,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, fields.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCancel();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open, onCancel, anchorRef]);

  if (!open || !style || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-[#D7E2EF]"
      role="dialog"
      aria-label="Choose columns"
    >
      <div className="shrink-0 border-b border-[#EEF2F7] px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search fields"
            autoFocus
            className="w-full rounded-lg border border-[#E8EEF6] py-1.5 pl-8 pr-2 text-xs text-slate-700 outline-none"
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">You can select up to 100 fields</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {fields.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">No fields match this search.</p>
        ) : (
          fields.map((field) => {
            const checked = draftColumns.includes(field.id);
            return (
              <label
                key={field.id}
                className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-[#F8FAFC]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(field.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#2563EB]"
                />
                <span className="min-w-0 break-all font-mono text-xs leading-4 text-slate-700" title={field.label || field.id}>
                  {field.label || field.id}
                </span>
              </label>
            );
          })
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#EEF2F7] px-3 py-2">
        <button type="button" className="rounded-full px-3 py-1.5 text-xs text-slate-500" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="rounded-full px-3 py-1.5 text-xs text-slate-600" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white"
          onClick={onApply}
        >
          Apply
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default function DatabasePage() {
  const { applicationId } = useParams<{ applicationId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [apps, setApps] = useState<DatabaseAppRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [appQuery, setAppQuery] = useState('');
  const [rows, setRows] = useState<DatabaseItemRow[]>([]);
  const [processes, setProcesses] = useState<DatabaseProcessOption[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [availableFields, setAvailableFields] = useState<DatabaseColumn[]>([]);
  const [defaultColumns, setDefaultColumns] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [draftColumns, setDraftColumns] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerAnchorRef = useRef<HTMLButtonElement>(null);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [queryMs, setQueryMs] = useState<number | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') || '');
  const [openRow, setOpenRow] = useState<DatabaseItemRow | null>(null);
  const [dataSource, setDataSource] = useState<string>('');

  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const pageSize = PAGE_SIZES.includes(Number(searchParams.get('page_size')) as (typeof PAGE_SIZES)[number])
    ? Number(searchParams.get('page_size'))
    : 25;
  const processId = searchParams.get('process') || '';
  const status = searchParams.get('status') || '';
  const entity = searchParams.get('entity') || '';
  const source = searchParams.get('source') || '';
  const search = searchParams.get('q') || '';

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    loadDatabaseApplications('production').then((result) => {
      if (cancelled) return;
      setApps(result.items);
      setCatalogError(result.error || null);
      setCatalogLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    if (!applicationId) {
      setRows([]);
      setProcesses([]);
      setTotal(0);
      setOpenRow(null);
      setPickerOpen(false);
      return;
    }
    let cancelled = false;
    setRowsLoading(true);
    setRowsError(null);
    loadDatabaseItems({
      applicationId,
      environment: 'production',
      page,
      pageSize,
      processId,
      search,
      status,
      entity,
      source,
    }).then((result) => {
      if (cancelled) return;
      if (result.page) {
        setRows(result.page.items || []);
        setProcesses(result.page.processes || []);
        setStatuses(result.page.filter_options?.statuses || []);
        setEntities(result.page.filter_options?.entities || []);
        setSources(result.page.filter_options?.sources || []);
        const fieldCatalog = (result.page.available_fields || result.page.columns || []).filter(
          (field) => field && field.id && (field.value_count == null || field.value_count > 0),
        );
        setAvailableFields(fieldCatalog);
        const defaults = (result.page.default_columns || fieldCatalog.map((col) => col.id))
          .map((col) => (typeof col === 'string' ? col : col?.id))
          .filter((id): id is string => Boolean(id) && fieldCatalog.some((field) => field.id === id));
        setDefaultColumns(defaults);
        const saved = readSavedColumns(applicationId).filter((id) =>
          (result.page?.available_fields || result.page?.columns || []).some((field) => field.id === id),
        );
        setVisibleColumns(saved.length ? saved : defaults);
        setTotal(result.page.total || 0);
        setPageCount(result.page.page_count || 1);
        setQueryMs(result.page.query_ms ?? null);
        setDataSource(result.page.data_source || '');
      } else {
        setRows([]);
        setTotal(0);
      }
      setRowsError(result.error || null);
      setRowsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId, page, pageSize, processId, search, status, entity, source]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchDraft === search) return;
      const next = new URLSearchParams(searchParams);
      if (searchDraft.trim()) next.set('q', searchDraft.trim());
      else next.delete('q');
      next.set('page', '1');
      setSearchParams(next, { replace: true });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [searchDraft, search, searchParams, setSearchParams]);

  const filteredApps = useMemo(() => {
    const q = appQuery.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((app) => {
      const name = friendlyApplicationName(app.application_id, app.application_name).toLowerCase();
      return name.includes(q) || app.application_id.toLowerCase().includes(q);
    });
  }, [apps, appQuery]);

  const selectedApp = apps.find((app) => app.application_id === applicationId);
  const selectedName = selectedApp
    ? friendlyApplicationName(selectedApp.application_id, selectedApp.application_name)
    : applicationId
      ? friendlyApplicationName(applicationId, applicationId)
      : '';

  const patchParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const pickerFields = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return availableFields;
    return availableFields.filter((field) => field.id.toLowerCase().includes(q) || field.label.toLowerCase().includes(q));
  }, [availableFields, pickerQuery]);

  const closePicker = useCallback(() => setPickerOpen(false), []);
  const toggleDraftColumn = useCallback((id: string) => {
    setDraftColumns((current) => {
      if (current.includes(id)) return current.filter((fieldId) => fieldId !== id);
      if (current.length >= 100) return current;
      return [...current, id];
    });
  }, []);
  const applyPicker = useCallback(() => {
    const next = draftColumns.length ? draftColumns : defaultColumns;
    setVisibleColumns(next);
    if (applicationId) saveColumns(applicationId, next);
    setPickerOpen(false);
  }, [applicationId, defaultColumns, draftColumns]);
  const resetPicker = useCallback(() => {
    setDraftColumns(defaultColumns);
  }, [defaultColumns]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <Layout
      breadcrumbs={
        applicationId
          ? [
              { label: 'Home', path: '/dashboard' },
              { label: 'Database', path: '/database' },
              { label: selectedName },
            ]
          : [{ label: 'Home', path: '/dashboard' }, { label: 'Database' }]
      }
    >
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl bg-[#0F172A] px-5 py-4 text-slate-100 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E293B] ring-1 ring-white/10">
                <Database className="h-5 w-5 text-[#7DD3FC]" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  Cloud SQL · master-diorama-489103-u2
                </p>
                <h1 className="truncate font-mono text-lg font-semibold text-white">
                  engagement_reporting.item
                  {selectedName ? <span className="text-sky-300"> / {selectedName}</span> : ''}
                </h1>
              </div>
            </div>
            <p className="font-mono text-[11px] text-slate-400">
              {apps.length} applications · production · newest snapshot + live cache + P2P MySQL
            </p>
          </div>
        </div>

        {catalogError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {catalogError}
          </div>
        )}

        {!applicationId ? (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#D7E2EF]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8EEF6] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Table2 className="h-4 w-4 text-[#3977BE]" />
                Tables
              </div>
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={appQuery}
                  onChange={(e) => setAppQuery(e.target.value)}
                  placeholder="Filter applications"
                  className="w-full rounded-lg border border-[#D7E2EF] bg-[#F8FAFC] py-2 pl-9 pr-3 font-mono text-xs text-slate-700 outline-none focus:border-[#3977BE]"
                />
              </div>
            </div>
            {catalogLoading ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Loading catalog…</p>
            ) : filteredApps.length === 0 ? (
              <EmptyState
                title="No applications in PostgreSQL"
                description="Connect an application first. This browser reads engagement_reporting.item only."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left font-mono text-[12px]">
                  <thead className="bg-[#F1F5F9] text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">application</th>
                      <th className="px-4 py-2.5 font-semibold">application_id</th>
                      <th className="px-4 py-2.5 font-semibold">rows</th>
                      <th className="px-4 py-2.5 font-semibold">source</th>
                      <th className="px-4 py-2.5 font-semibold">processes</th>
                      <th className="px-4 py-2.5 font-semibold">snapshot_at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.map((app) => (
                      <tr
                        key={app.application_id}
                        className="cursor-pointer border-t border-[#EEF2F7] hover:bg-[#F0F7FF]"
                        onClick={() => navigate(`/database/${encodeURIComponent(app.application_id)}`)}
                      >
                        <td className="px-4 py-2.5 font-sans text-sm font-semibold text-slate-800">
                          {friendlyApplicationName(app.application_id, app.application_name)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{app.application_id}</td>
                        <td className="px-4 py-2.5 text-slate-800">{app.item_count.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-slate-500">{app.data_source || 'snapshot+cache'}</td>
                        <td className="px-4 py-2.5 text-slate-500">{app.process_count}</td>
                        <td className="px-4 py-2.5 text-slate-500">{formatWhen(app.snapshot_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 min-w-0 xl:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#D7E2EF]">
              <div className="border-b border-[#E8EEF6] px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                applications
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-1.5">
                {apps.map((app) => {
                  const active = app.application_id === applicationId;
                  return (
                    <Link
                      key={app.application_id}
                      to={`/database/${encodeURIComponent(app.application_id)}`}
                      className={`block rounded-lg px-2.5 py-2 ${
                        active ? 'bg-[#EEF5FF] text-[#3977BE]' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block truncate text-sm font-semibold">
                        {friendlyApplicationName(app.application_id, app.application_name)}
                      </span>
                      <span className="block font-mono text-[10px] text-slate-400">
                        {app.item_count.toLocaleString()} rows
                      </span>
                    </Link>
                  );
                })}
              </div>
            </aside>

            <section className="min-w-0 rounded-2xl bg-white ring-1 ring-[#D7E2EF]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[#E8EEF6] px-3 py-2.5">
                <div className="relative min-w-0 w-full flex-1 sm:min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    placeholder="Search request, instance, status, email"
                    className="w-full rounded-lg border border-[#D7E2EF] bg-[#F8FAFC] py-2 pl-9 pr-10 font-mono text-xs text-slate-700 outline-none focus:border-[#3977BE]"
                  />
                  <button
                    ref={pickerAnchorRef}
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-[#3977BE]"
                    aria-label="Choose columns"
                    aria-expanded={pickerOpen}
                    onClick={() => {
                      setDraftColumns(visibleColumns);
                      setPickerQuery('');
                      setPickerOpen((open) => !open);
                    }}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <DatabaseColumnPicker
                    open={pickerOpen}
                    anchorRef={pickerAnchorRef}
                    fields={pickerFields}
                    query={pickerQuery}
                    draftColumns={draftColumns}
                    onQueryChange={setPickerQuery}
                    onToggle={toggleDraftColumn}
                    onReset={resetPicker}
                    onCancel={closePicker}
                    onApply={applyPicker}
                  />
                </div>
                <select
                  value={processId}
                  onChange={(e) => patchParams({ process: e.target.value || null, page: '1' })}
                  className="min-w-0 max-w-full rounded-lg border border-[#D7E2EF] bg-[#F8FAFC] px-2 py-2 font-mono text-xs text-slate-700"
                >
                  <option value="">all processes</option>
                  {processes.map((process) => (
                    <option key={process.process_id} value={process.process_id}>
                      {process.process_name} ({process.item_count})
                    </option>
                  ))}
                </select>
                <select
                  value={status}
                  onChange={(e) => patchParams({ status: e.target.value || null, page: '1' })}
                  className="min-w-0 max-w-full rounded-lg border border-[#D7E2EF] bg-[#F8FAFC] px-2 py-2 font-mono text-xs text-slate-700"
                >
                  <option value="">all statuses</option>
                  {statuses.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <select
                  value={entity}
                  onChange={(e) => patchParams({ entity: e.target.value || null, page: '1' })}
                  className="min-w-0 max-w-full rounded-lg border border-[#D7E2EF] bg-[#F8FAFC] px-2 py-2 font-mono text-xs text-slate-700"
                >
                  <option value="">all entities</option>
                  {entities.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <select
                  value={source}
                  onChange={(e) => patchParams({ source: e.target.value || null, page: '1' })}
                  className="min-w-0 max-w-full rounded-lg border border-[#D7E2EF] bg-[#F8FAFC] px-2 py-2 font-mono text-xs text-slate-700"
                >
                  <option value="">all sources</option>
                  {sources.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <select
                  value={String(pageSize)}
                  onChange={(e) => patchParams({ page_size: e.target.value, page: '1' })}
                  className="min-w-0 max-w-full rounded-lg border border-[#D7E2EF] bg-[#F8FAFC] px-2 py-2 font-mono text-xs text-slate-700"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} / page
                    </option>
                  ))}
                </select>
              </div>

              {rowsError && (
                <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">{rowsError}</div>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full text-left font-mono text-[11px]">
                  <thead className="bg-[#0F172A] text-[10px] uppercase tracking-wider text-slate-300">
                    <tr>
                      {visibleColumns.map((col) => (
                        <th key={col} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                          {col}
                        </th>
                      ))}
                      <th className="whitespace-nowrap px-3 py-2.5 font-semibold">source_payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsLoading && rows.length === 0 ? (
                      <tr>
                        <td colSpan={visibleColumns.length + 1} className="px-4 py-10 text-center text-slate-500">
                          Loading page…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={visibleColumns.length + 1} className="px-4 py-10 text-center text-slate-500">
                          No rows on this page.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr
                          key={`${row.process_id}-${row.instance_id}-${row.snapshot_run_id}`}
                          className="cursor-pointer border-t border-[#EEF2F7] odd:bg-white even:bg-[#F8FAFC] hover:bg-[#E8F3FC]"
                          onClick={() => setOpenRow(row)}
                        >
                          {visibleColumns.map((col) => (
                            <td key={col} className="max-w-[220px] truncate px-3 py-2 text-slate-700" title={cellText(row, col)}>
                              {cellText(row, col)}
                            </td>
                          ))}
                          <td className="whitespace-nowrap px-3 py-2 text-sky-700">{payloadPreview(row.source_payload)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E8EEF6] bg-[#F8FAFC] px-3 py-2 font-mono text-[11px] text-slate-500">
                <span>
                  {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
                  {dataSource ? ` · ${dataSource}` : ''}
                  {queryMs != null ? ` · ${queryMs} ms` : ''}
                  {rowsLoading ? ' · refreshing' : ''}
                </span>
                <div className="flex items-center gap-1">
                  <PageBtn disabled={page <= 1} onClick={() => patchParams({ page: '1' })} label="First">
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </PageBtn>
                  <PageBtn disabled={page <= 1} onClick={() => patchParams({ page: String(page - 1) })} label="Previous">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </PageBtn>
                  <span className="px-2 text-slate-700">
                    {page} / {pageCount}
                  </span>
                  <PageBtn disabled={page >= pageCount} onClick={() => patchParams({ page: String(page + 1) })} label="Next">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </PageBtn>
                  <PageBtn
                    disabled={page >= pageCount}
                    onClick={() => patchParams({ page: String(pageCount) })}
                    label="Last"
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </PageBtn>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {openRow && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/40" onClick={() => setOpenRow(null)}>
          <aside
            className="flex h-full w-full max-w-xl flex-col bg-[#0B1220] text-slate-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">source_payload</p>
                <h2 className="truncate font-mono text-sm text-white">{openRow.instance_id || 'row'}</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpenRow(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Close payload"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-sky-100">
              {JSON.stringify(openRow.source_payload ?? {}, null, 2)}
            </pre>
          </aside>
        </div>
      )}
    </Layout>
  );
}

function PageBtn({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="rounded-md border border-[#D7E2EF] bg-white p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
