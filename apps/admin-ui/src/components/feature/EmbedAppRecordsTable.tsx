import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  assignedRecordLabel,
  filterAppRecords,
  summarizeAppRecords,
} from '@/lib/appDashboardClientFilter';
import { displayDashText, displayPersonCell, displayWhen, isBlankDash } from '@/lib/dashboardEmpty';
import type { AppRecordColumn, AppRecordRow } from '@/services/appRecordsApi';
import { MisMobileRecordCard } from '@/components/feature/MisMobileCards';

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
  activityDates = false,
  filterAnimating = false,
}: Props) {
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    setPage(0);
  }, [entity, company, status, assigned, assignedId, dateFrom, dateTo, todayKind]);

  const filtered = useMemo(
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
      activityDates,
    }),
    [inventory, entity, company, status, assigned, assignedId, dateFrom, dateTo, todayKind, itsmCompanyMode, travelMode, activityDates],
  );

  const summary = useMemo(() => summarizeAppRecords(filtered), [filtered]);

  const pageItems = useMemo(() => {
    const off = page * pageSize;
    return filtered.slice(off, off + pageSize);
  }, [filtered, page]);

  const columns: AppRecordColumn[] = columnsProp?.length
    ? columnsProp
    : [
        { id: 'request_id', label: 'Request ID' },
        { id: 'subject', label: 'Subject' },
        { id: 'assigned_to', label: 'Assigned to' },
        { id: 'status', label: 'Status' },
        { id: 'entity', label: 'Entity' },
        { id: 'company_name', label: 'Company name' },
        { id: 'created_at', label: 'Created' },
      ];

  const isEmptyCell = (value: unknown) => isBlankDash(value);

  const visibleColumns = useMemo(() => {
    if (!pageItems.length) return columns;
    const always = new Set(['request_id', 'subject', 'status', 'entity', 'company_name']);
    return columns.filter((col) => {
      if (always.has(col.id)) return true;
      return pageItems.some((row) => !isEmptyCell((row as Record<string, unknown>)[col.id]));
    });
  }, [columns, pageItems]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const showLoader = filterAnimating || (!inventory.length && !filtered.length);

  const cellValue = (row: AppRecordRow, col: AppRecordColumn) => {
    const raw = (row as Record<string, unknown>)[col.id];
    if (col.id === 'request_id') return displayDashText(raw, '—');
    if (col.id === 'status') return displayDashText(raw || row.status_raw, '—');
    if (col.id === 'created_at') return formatWhen(String(raw || ''));
    if (col.id === 'assigned_to') return assignedRecordLabel(row, { itsmCompanyMode });
    if (col.id === 'requested_by' || col.id === 'closed_by') return displayPersonCell(raw);
    return displayPersonCell(raw);
  };

  return (
    <div className="relative rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(112,144,176,0.12)]">
      {filterAnimating ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60 backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin text-[#3977BE]" />
        </div>
      ) : null}
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Records</h3>
        <span className="text-xs font-semibold tabular-nums text-slate-500">
          {Number(summary.total || 0).toLocaleString('en-IN')} rows
          {dataSource === 'live_cache' ? ' · cached' : ''}
        </span>
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
          <div className="-mx-5 -mb-5 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  {visibleColumns.map((col) => (
                    <th key={col.id} className="whitespace-nowrap px-5 py-2.5 font-semibold">
                      {col.label}
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
                      if (col.id === 'created_at') {
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-600">
                            {formatWhen(String(raw || ''))}
                          </td>
                        );
                      }
                      if (col.id === 'assigned_to' || col.id === 'requested_by' || col.id === 'closed_by') {
                        return (
                          <td key={col.id} className="max-w-[220px] truncate px-5 py-2.5 text-slate-800">
                            {col.id === 'assigned_to' ? assignedRecordLabel(row, { itsmCompanyMode }) : displayPersonCell(raw)}
                          </td>
                        );
                      }
                      return (
                        <td key={col.id} className="max-w-[220px] truncate px-5 py-2.5 text-slate-800">
                          {displayPersonCell(raw)}
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
