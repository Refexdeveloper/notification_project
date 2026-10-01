import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import {
  assignedRecordLabel,
  filterAppRecords,
  summarizeAppRecords,
} from '@/lib/appDashboardClientFilter';
import { displayDashText, displayPersonCell, displayWhen, isBlankDash } from '@/lib/dashboardEmpty';
import type { AppRecordColumn, AppRecordRow } from '@/services/appRecordsApi';
import { MisMobileRecordCard } from '@/components/feature/MisMobileCards';
import {
  RecordsColumnDateFilter,
  RecordsColumnHeaderFilter,
  isDateRecordColumn,
} from '@/components/feature/RecordsColumnHeaderFilter';

function formatWhen(value: string | null | undefined): string {
  return displayWhen(value);
}

function statusTone(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'open') return 'bg-[#FFF3DF] text-[#A96A20] ring-[#F5E0C0]';
  if (s === 'closed') return 'bg-[#E8F7F0] text-[#287B5D] ring-[#CDEBD9]';
  if (s === 'rejected') return 'bg-[#FCECEF] text-[#B24E66] ring-[#F0D4DB]';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}

function rowDateKey(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(parsed));
    } catch {
      return raw.slice(0, 10);
    }
  }
  return raw.slice(0, 10);
}

type Props = {
  inventory: AppRecordRow[];
  columns?: AppRecordColumn[];
  dataSource?: string;
  entity?: string;
  company?: string;
  status?: string;
  assigned?: string;
  assignedId?: string;
  dateFrom?: string;
  dateTo?: string;
  todayKind?: 'opened' | 'closed';
  itsmCompanyMode?: boolean;
  travelMode?: boolean;
  leadWebsiteMode?: boolean;
  activityDates?: boolean;
  filterAnimating?: boolean;
};

export default function EmbedAppRecordsTable({
  inventory,
  columns: columnsProp,
  dataSource,
  entity = 'all',
  company = 'all',
  status = 'all',
  assigned,
  assignedId,
  dateFrom,
  dateTo,
  todayKind,
  itsmCompanyMode = false,
  travelMode = false,
  leadWebsiteMode = false,
  activityDates = false,
  filterAnimating = false,
}: Props) {
  const [page, setPage] = useState(0);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({});
  const pageSize = 50;

  useEffect(() => {
    setPage(0);
    setColumnFilters({});
    setDateFilters({});
  }, [entity, company, status, assigned, assignedId, dateFrom, dateTo, todayKind]);

  const scoped = useMemo(
    () => filterAppRecords(inventory, {
      entity,
      company,
      status,
      assigned,
      assignedId,
      dateFrom,
      dateTo,
      todayKind,
      itsmCompanyMode,
      travelMode,
      leadWebsiteMode,
      activityDates,
    }),
    [inventory, entity, company, status, assigned, assignedId, dateFrom, dateTo, todayKind, itsmCompanyMode, travelMode, leadWebsiteMode, activityDates],
  );

  const columns: AppRecordColumn[] = columnsProp?.length
    ? columnsProp
    : [
        { id: 'request_id', label: 'Request ID' },
        { id: 'subject', label: 'Subject' },
        { id: 'assigned_to', label: 'Assigned to' },
        { id: 'status', label: 'Status' },
        { id: 'entity', label: 'Entity' },
        { id: leadWebsiteMode ? 'website' : 'company_name', label: leadWebsiteMode ? 'Website' : 'Company name' },
        { id: 'created_at', label: 'Created' },
      ];

  const isEmptyCell = (value: unknown) => isBlankDash(value);

  const cellValue = (row: AppRecordRow, col: AppRecordColumn) => {
    const raw = (row as Record<string, unknown>)[col.id];
    if (col.id === 'request_id') return displayDashText(raw, '—');
    if (col.id === 'status') return displayDashText(raw || row.status_raw, '—');
    if (isDateRecordColumn(col.id)) return formatWhen(String(raw || ''));
    if (col.id === 'assigned_to') return assignedRecordLabel(row, { itsmCompanyMode });
    if (col.id === 'requested_by' || col.id === 'closed_by') return displayPersonCell(raw);
    return displayPersonCell(raw);
  };

  const columnFilterOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      if (isDateRecordColumn(col.id)) continue;
      const values = new Set<string>();
      for (const row of scoped) {
        const raw = cellValue(row, col);
        const text = String(raw || '').trim();
        if (!text || text === '—') continue;
        values.add(text);
      }
      map[col.id] = [...values].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    }
    return map;
  }, [scoped, columns, itsmCompanyMode]);

  const filtered = useMemo(() => {
    const activeValues = Object.entries(columnFilters).filter(([, v]) => v && v !== 'all');
    const activeDates = Object.entries(dateFilters).filter(([, range]) => range.from || range.to);
    if (!activeValues.length && !activeDates.length) return scoped;
    return scoped.filter((row) => {
      const valueOk = activeValues.every(([colId, wanted]) => {
        const col = columns.find((c) => c.id === colId) || { id: colId, label: colId };
        return String(cellValue(row, col)).trim() === wanted;
      });
      if (!valueOk) return false;
      return activeDates.every(([colId, range]) => {
        const key = rowDateKey((row as Record<string, unknown>)[colId]);
        if (!key) return false;
        if (range.from && key < range.from) return false;
        if (range.to && key > range.to) return false;
        return true;
      });
    });
  }, [scoped, columnFilters, dateFilters, columns, itsmCompanyMode]);

  const summary = useMemo(() => summarizeAppRecords(filtered), [filtered]);

  const pageItems = useMemo(() => {
    const off = page * pageSize;
    return filtered.slice(off, off + pageSize);
  }, [filtered, page]);

  const visibleColumns = useMemo(() => {
    if (!pageItems.length) return columns;
    const always = new Set(['request_id', 'subject', 'status', 'entity', 'company_name', 'website', 'created_at']);
    return columns.filter((col) => {
      if (always.has(col.id) || isDateRecordColumn(col.id)) return true;
      return pageItems.some((row) => !isEmptyCell((row as Record<string, unknown>)[col.id]));
    });
  }, [columns, pageItems]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const filtersActive = Object.values(columnFilters).some((v) => v && v !== 'all')
    || Object.values(dateFilters).some((range) => range.from || range.to);

  const clearColumnFilters = () => {
    setPage(0);
    setColumnFilters({});
    setDateFilters({});
  };

  const showLoader = filterAnimating;

  return (
    <div className="relative rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(112,144,176,0.12)]">
      {filterAnimating ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60 backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin text-[#3977BE]" />
        </div>
      ) : null}
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Records</h3>
        <div className="flex items-center gap-2">
          {filtersActive ? (
            <button
              type="button"
              onClick={clearColumnFilters}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          ) : null}
          <span className="text-xs font-semibold tabular-nums text-slate-500">
            {Number(summary.total || 0).toLocaleString('en-IN')} rows
            {dataSource === 'live_cache' ? ' · cached' : ''}
          </span>
        </div>
      </div>

      {showLoader && !pageItems.length ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-[#3977BE]" />
          Loading records…
        </div>
      ) : !pageItems.length ? (
        <p className="py-10 text-center text-sm text-slate-500">No records match these filters.</p>
      ) : (
        <>
          <div className="space-y-2.5 lg:hidden">
            {pageItems.map((row) => {
              const titleCol = visibleColumns.find((c) => c.id === 'subject') || visibleColumns[0];
              const idCol = visibleColumns.find((c) => c.id === 'request_id');
              const statusCol = visibleColumns.find((c) => c.id === 'status');
              const previewIds = new Set(['assigned_to', 'entity', 'company_name', 'created_at']);
              const fields = visibleColumns
                .filter((c) => previewIds.has(c.id))
                .map((c) => ({ label: c.label, value: cellValue(row, c) }));
              const extraFields = visibleColumns
                .filter((c) => !previewIds.has(c.id) && c.id !== titleCol?.id && c.id !== idCol?.id && c.id !== statusCol?.id)
                .map((c) => ({ label: c.label, value: cellValue(row, c) }));
              return (
                <MisMobileRecordCard
                  key={row.id}
                  title={cellValue(row, titleCol || { id: 'subject', label: 'Subject' })}
                  subtitle={idCol ? cellValue(row, idCol) : undefined}
                  badge={statusCol ? (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusTone(String(row.status || ''))}`}>
                      {cellValue(row, statusCol)}
                    </span>
                  ) : undefined}
                  fields={fields}
                  extraFields={extraFields}
                />
              );
            })}
          </div>
          <div className="-mx-5 -mb-5 hidden overflow-x-auto overflow-y-visible lg:block">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  {visibleColumns.map((col) => (
                    <th key={col.id} className="whitespace-nowrap px-5 py-2.5 font-semibold">
                      {isDateRecordColumn(col.id) ? (
                        <RecordsColumnDateFilter
                          label={col.label}
                          from={dateFilters[col.id]?.from || ''}
                          to={dateFilters[col.id]?.to || ''}
                          onFromChange={(next) => {
                            setPage(0);
                            setDateFilters((prev) => ({
                              ...prev,
                              [col.id]: { from: next, to: prev[col.id]?.to || '' },
                            }));
                          }}
                          onToChange={(next) => {
                            setPage(0);
                            setDateFilters((prev) => ({
                              ...prev,
                              [col.id]: { from: prev[col.id]?.from || '', to: next },
                            }));
                          }}
                          onClear={() => {
                            setPage(0);
                            setDateFilters((prev) => {
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
                          options={columnFilterOptions[col.id] || []}
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
                {pageItems.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-[#EEF5FF]/70">
                    {visibleColumns.map((col) => {
                      const raw = (row as Record<string, unknown>)[col.id];
                      if (col.id === 'request_id') {
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5">
                            <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[12px] font-semibold tracking-wide text-slate-900 ring-1 ring-slate-200">
                              {displayDashText(raw, '—')}
                            </span>
                          </td>
                        );
                      }
                      if (col.id === 'status') {
                        return (
                          <td key={col.id} className="px-5 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusTone(String(raw || ''))}`}
                            >
                              {displayDashText(raw || row.status_raw, '—')}
                            </span>
                          </td>
                        );
                      }
                      if (isDateRecordColumn(col.id)) {
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-600">
                            {formatWhen(String(raw || ''))}
                          </td>
                        );
                      }
                      const text = col.id === 'assigned_to'
                        ? assignedRecordLabel(row, { itsmCompanyMode })
                        : displayPersonCell(raw);
                      const wrapIds = new Set(['entity', 'company_name', 'website', 'requested_by', 'assigned_to', 'closed_by', 'subject']);
                      return (
                        <td
                          key={col.id}
                          title={text}
                          className={`px-5 py-2.5 text-slate-800 ${
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
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <span className="text-xs tabular-nums text-slate-500">
                {page + 1} / {totalPages}
              </span>
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
          ) : null}
        </>
      )}
    </div>
  );
}
