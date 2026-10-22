import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Loader2, X } from 'lucide-react';
import {
  assignedRecordLabel,
  filterAppRecords,
  summarizeAppRecords,
} from '@/lib/appDashboardClientFilter';
import { displayDashText, displayPersonCell, displayWhen, formatInr, isBlankDash } from '@/lib/dashboardEmpty';
import {
  ITSM_CEO_RECORD_COLUMNS,
  itsmClosedAtDisplay,
  itsmExpandTiles,
  itsmRecordCellText,
  itsmReopenedStamp,
  itsmSlaDisplay,
} from '@/lib/itsmRecordDisplay';
import { emsExpandTiles, isEmsCoreColumn } from '@/lib/emsRecordDisplay';
import {
  annotateTravelBookingFareRows,
  fareTrendFilterLabel,
  formatDeviationPct,
  isTravelCoreColumn,
  travelExpandTiles,
  travelPurposeText,
  travelRouteSummary,
  travelSlaLabel,
  type TravelPackKind,
} from '@/lib/travelRecordDisplay';
import TravelFareTrendCell from '@/components/feature/TravelFareTrendCell';
import TravelSlaCell from '@/components/feature/TravelSlaCell';
import TravelRouteBanner from '@/components/feature/TravelRouteBanner';
import type { AppRecordColumn, AppRecordRow } from '@/services/appRecordsApi';
import { MisMobileRecordCard } from '@/components/feature/MisMobileCards';
import { hasVisibleMisTiles, MisRecordExpandPanel } from '@/components/feature/MisRecordExpandPanel';
import MisPersonInitialsCell from '@/components/feature/MisPersonInitialsCell';
import {
  RecordsColumnDateFilter,
  RecordsColumnHeaderFilter,
  isDateRecordColumn,
} from '@/components/feature/RecordsColumnHeaderFilter';
import { NE_TYPE } from '@/lib/neDashType';

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
  travelPackKind?: TravelPackKind | null;
  emsMode?: boolean;
  leadWebsiteMode?: boolean;
  activityDates?: boolean;
  filterAnimating?: boolean;
  inventoryLoading?: boolean;
  /** Rows after header + MIS column filters, without KPI status — parent recounts cards. */
  onColumnScopedRowsChange?: (payload: { kpiRows: AppRecordRow[]; sourceRows: AppRecordRow[] }) => void;
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
  travelPackKind = null,
  emsMode = false,
  leadWebsiteMode = false,
  activityDates = false,
  filterAnimating = false,
  inventoryLoading = false,
  onColumnScopedRowsChange,
}: Props) {
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({});
  const pageSize = 10;

  useEffect(() => {
    setPage(0);
    setColumnFilters({});
    setDateFilters({});
  }, [entity, company, status, assigned, assignedId, dateFrom, dateTo, todayKind]);

  const fareReadyInventory = useMemo(
    () => (travelMode && travelPackKind === 'booking' ? annotateTravelBookingFareRows(inventory) : inventory),
    [inventory, travelMode, travelPackKind],
  );

  const scoped = useMemo(
    () => {
      const rows = filterAppRecords(fareReadyInventory, {
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
      });
      if (!itsmCompanyMode) return rows;
      return [...rows].sort((a, b) => {
        const right = new Date(String(b.created_at || 0)).getTime() || 0;
        const left = new Date(String(a.created_at || 0)).getTime() || 0;
        if (right !== left) return right - left;
        return String(b.request_id || '').localeCompare(String(a.request_id || ''));
      });
    },
    [fareReadyInventory, entity, company, status, assigned, assignedId, dateFrom, dateTo, todayKind, itsmCompanyMode, travelMode, leadWebsiteMode, activityDates],
  );

  const columns: AppRecordColumn[] = columnsProp?.length
    ? columnsProp
    : itsmCompanyMode
      ? ITSM_CEO_RECORD_COLUMNS
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
    if (itsmCompanyMode) {
      if (col.id === 'closed_at') return formatWhen(itsmClosedAtDisplay(row));
      if (col.id === 'created_at' || col.id === 'reopened_at') {
        return formatWhen(String((row as Record<string, unknown>)[col.id] || ''));
      }
      return displayDashText(itsmRecordCellText(row, col.id), '—');
    }
    const raw = (row as Record<string, unknown>)[col.id];
    if (col.id === 'request_id') return displayDashText(raw, '—');
    if (col.id === 'status') return displayDashText(raw || row.status_raw, '—');
    if (isDateRecordColumn(col.id)) return formatWhen(String(raw || ''));
    if (col.id === 'assigned_to') return assignedRecordLabel(row, { itsmCompanyMode });
    if (col.id === 'purpose') return displayDashText(travelPurposeText(row), '—');
    if (col.id === 'reference_fare' || col.id === 'policy_deviation_cost') {
      if (raw == null || raw === '') return '—';
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? formatInr(n) : '—';
    }
    if (col.id === 'deviation_pct') return displayDashText(formatDeviationPct(raw), '—');
    if (col.id === 'fare_trend') return displayDashText(fareTrendFilterLabel(raw, row.deviation_pct), '—');
    if (col.id === 'sla') {
      return travelMode
        ? displayDashText(travelSlaLabel(row), '—')
        : displayDashText(raw, '—');
    }
    if (col.id === 'amount' || col.id === 'raised_amount') return formatInr(typeof raw === 'number' ? raw : Number(raw));
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

  const applyColumnAndDateFilters = (rows: AppRecordRow[], omitCols: string[] = []) => {
    const skip = new Set(omitCols);
    const activeValues = Object.entries(columnFilters).filter(([colId, v]) => v && v !== 'all' && !skip.has(colId));
    const activeDates = Object.entries(dateFilters).filter(([, range]) => range.from || range.to);
    if (!activeValues.length && !activeDates.length) return rows;
    return rows.filter((row) => {
      const valueOk = activeValues.every(([colId, wanted]) => {
        const col = columns.find((c) => c.id === colId) || { id: colId, label: colId };
        return String(cellValue(row, col)).trim() === wanted;
      });
      if (!valueOk) return false;
      return activeDates.every(([colId, range]) => {
        const rawDate = itsmCompanyMode && colId === 'closed_at'
          ? itsmClosedAtDisplay(row)
          : (row as Record<string, unknown>)[colId];
        const key = rowDateKey(rawDate);
        if (!key) return false;
        if (range.from && key < range.from) return false;
        if (range.to && key > range.to) return false;
        return true;
      });
    });
  };

  const filtered = useMemo(
    () => applyColumnAndDateFilters(scoped),
    [scoped, columnFilters, dateFilters, columns, itsmCompanyMode],
  );

  const headerNoStatus = useMemo(
    () => filterAppRecords(fareReadyInventory, {
      entity,
      company,
      assigned,
      assignedId,
      dateFrom,
      dateTo,
      itsmCompanyMode,
      travelMode,
      leadWebsiteMode,
      activityDates,
    }),
    [
      fareReadyInventory,
      entity,
      company,
      assigned,
      assignedId,
      dateFrom,
      dateTo,
      itsmCompanyMode,
      travelMode,
      leadWebsiteMode,
      activityDates,
    ],
  );

  const columnScopedForKpis = useMemo(
    () => applyColumnAndDateFilters(headerNoStatus),
    [headerNoStatus, columnFilters, dateFilters, columns, itsmCompanyMode],
  );

  // Same as Head / newceo: Source column does not hide the other 3 channels.
  const columnScopedForSource = useMemo(
    () => applyColumnAndDateFilters(headerNoStatus, ['source']),
    [headerNoStatus, columnFilters, dateFilters, columns, itsmCompanyMode],
  );

  useEffect(() => {
    onColumnScopedRowsChange?.({ kpiRows: columnScopedForKpis, sourceRows: columnScopedForSource });
  }, [columnScopedForKpis, columnScopedForSource, onColumnScopedRowsChange]);

  const summary = useMemo(() => summarizeAppRecords(filtered), [filtered]);

  const pageItems = useMemo(() => {
    const off = page * pageSize;
    return filtered.slice(off, off + pageSize);
  }, [filtered, page]);

  const visibleColumns = useMemo(() => {
    if (itsmCompanyMode) return columns;
    if (travelMode) {
      if (!pageItems.length) {
        return columns.filter((col) => isTravelCoreColumn(col.id, travelPackKind));
      }
      return columns.filter((col) => {
        if (isTravelCoreColumn(col.id, travelPackKind)) return true;
        if (col.id === 'purpose') return pageItems.some((row) => Boolean(travelPurposeText(row)));
        return pageItems.some((row) => !isEmptyCell((row as Record<string, unknown>)[col.id]));
      });
    }
    if (emsMode) {
      if (!pageItems.length) {
        return columns.filter((col) => isEmsCoreColumn(col.id));
      }
      return columns.filter((col) => {
        if (isEmsCoreColumn(col.id)) return true;
        return pageItems.some((row) => !isEmptyCell((row as Record<string, unknown>)[col.id]));
      });
    }
    if (!pageItems.length) return columns;
    const always = new Set(['request_id', 'subject', 'status', 'entity', 'company_name', 'website', 'created_at']);
    return columns.filter((col) => {
      if (always.has(col.id) || isDateRecordColumn(col.id)) return true;
      return pageItems.some((row) => !isEmptyCell((row as Record<string, unknown>)[col.id]));
    });
  }, [columns, emsMode, itsmCompanyMode, pageItems, travelMode, travelPackKind]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const filtersActive = Object.values(columnFilters).some((v) => v && v !== 'all')
    || Object.values(dateFilters).some((range) => range.from || range.to);

  const clearColumnFilters = () => {
    setPage(0);
    setColumnFilters({});
    setDateFilters({});
  };

  const showLoader = filterAnimating || inventoryLoading;
  const expandEnabled = itsmCompanyMode || travelMode || emsMode;
  const expandTilesFor = (row: AppRecordRow) => {
    if (travelMode) {
      const route = travelRouteSummary(row);
      return travelExpandTiles(row, {
        hideRouteFields: Boolean(route),
        hideTravelMode: travelPackKind === 'booking',
      });
    }
    return emsMode ? emsExpandTiles(row) : itsmExpandTiles(row);
  };
  const expandBannerFor = (row: AppRecordRow) => {
    if (!travelMode) return null;
    const route = travelRouteSummary(row);
    return route ? <TravelRouteBanner {...route} /> : null;
  };
  const rowCanExpand = (row: AppRecordRow) => (
    expandEnabled && (hasVisibleMisTiles(expandTilesFor(row)) || Boolean(expandBannerFor(row)))
  );
  const showExpandColumn = expandEnabled && pageItems.some((row) => rowCanExpand(row));

  return (
    <div className="ne-list-panel relative p-5">
      {showLoader && pageItems.length ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[1.25rem] bg-white/60 backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin text-[#3977BE]" />
        </div>
      ) : null}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1E88E5]/10 text-[#1E88E5]">
            <ClipboardList className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <h3 className={NE_TYPE.sectionTitle}>Records</h3>
        </div>
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
            {pageItems.map((row, index) => {
              const titleCol = visibleColumns.find((c) => c.id === 'subject') || visibleColumns[0];
              const idCol = visibleColumns.find((c) => c.id === 'request_id');
              const statusCol = visibleColumns.find((c) => c.id === 'status');
              const previewIds = itsmCompanyMode
                ? new Set(['requested_by', 'assigned_to', 'form_status', 'source', 'ticket_type', 'created_at', 'closed_at'])
                : travelMode
                  ? new Set(
                    travelPackKind === 'booking'
                      ? ['requested_by', 'assigned_to', 'purpose', 'from_city', 'to_city', 'trip_type', 'created_at']
                      : ['requested_by', 'assigned_to', 'purpose', 'created_at'],
                  )
                  : emsMode
                    ? new Set(['requested_by', 'assigned_to', 'expense_type', 'entity', 'created_at'])
                  : new Set(['assigned_to', 'entity', 'company_name', 'created_at']);
              const personCols = new Set(['requested_by', 'assigned_to', 'closed_by']);
              const displayField = (col: AppRecordColumn) => {
                if (col.id === 'fare_trend') {
                  return <TravelFareTrendCell trend={row.fare_trend} deviationPct={row.deviation_pct} />;
                }
                if (travelMode && col.id === 'sla') {
                  return <TravelSlaCell row={row} />;
                }
                const text = cellValue(row, col);
                if (itsmCompanyMode && personCols.has(col.id)) {
                  return <MisPersonInitialsCell name={text === '—' ? '' : text} />;
                }
                return text;
              };
              const fields = visibleColumns
                .filter((c) => previewIds.has(c.id))
                .map((c) => ({ label: c.label, value: displayField(c) }));
              const extraFields = visibleColumns
                .filter((c) => !previewIds.has(c.id) && c.id !== titleCol?.id && c.id !== idCol?.id && c.id !== statusCol?.id)
                .map((c) => ({ label: c.label, value: displayField(c) }))
                .filter((field) => {
                  if (field.value && typeof field.value !== 'string') return true;
                  const text = typeof field.value === 'string' ? field.value.trim() : '';
                  return Boolean(text) && text !== '—';
                });
              return (
                <MisMobileRecordCard
                  key={row.id}
                  index={index}
                  title={cellValue(row, titleCol || { id: 'subject', label: 'Subject' })}
                  subtitle={idCol ? cellValue(row, idCol) : undefined}
                  badge={statusCol ? (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusTone(String(row.status || ''))}`}>
                      {cellValue(row, statusCol)}
                    </span>
                  ) : undefined}
                  fields={fields}
                  extraFields={extraFields}
                  extra={rowCanExpand(row) ? <MisRecordExpandPanel tiles={expandTilesFor(row)} banner={expandBannerFor(row)} inset /> : undefined}
                />
              );
            })}
          </div>
          <div className="-mx-5 hidden overflow-x-auto overflow-y-visible px-3 lg:block">
            <table className="ne-list-table text-sm">
              <thead className={`${NE_TYPE.tableHead} bg-transparent`}>
                <tr>
                  {showExpandColumn ? <th className="w-10 px-3 py-3" aria-hidden /> : null}
                  {visibleColumns.map((col) => (
                    <th key={col.id} className={`${NE_TYPE.tableHeadCell} font-semibold`}>
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
                {pageItems.map((row, index) => {
                  const rowId = String(row.id || row.request_id || '');
                  const canExpand = rowCanExpand(row);
                  const expanded = canExpand && expandedId === rowId;
                  return (
                  <Fragment key={rowId}>
                  <tr
                    className="ne-list-row group"
                    style={{ '--r': index } as CSSProperties}
                  >
                    {showExpandColumn ? (
                      <td className="px-3 py-2.5">
                        {canExpand ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? 'Hide details' : 'Show details'}
                          onClick={() => setExpandedId(expanded ? null : rowId)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                        ) : null}
                      </td>
                    ) : null}
                    {visibleColumns.map((col) => {
                      const raw = (row as Record<string, unknown>)[col.id];
                      if (col.id === 'amount' || col.id === 'raised_amount') {
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums font-semibold text-slate-800">
                            {formatInr(typeof raw === 'number' ? raw : Number(raw))}
                          </td>
                        );
                      }
                      if (col.id === 'fare_trend') {
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5 text-right">
                            <TravelFareTrendCell trend={row.fare_trend} deviationPct={row.deviation_pct} />
                          </td>
                        );
                      }
                      if (travelMode && col.id === 'sla') {
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5 text-right">
                            <TravelSlaCell row={row} />
                          </td>
                        );
                      }
                      if (col.id === 'reference_fare' || col.id === 'policy_deviation_cost' || col.id === 'deviation_pct' || col.id === 'sla') {
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums font-semibold text-slate-800">
                            {cellValue(row, col)}
                          </td>
                        );
                      }
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
                        const reopen = itsmCompanyMode ? itsmReopenedStamp(row) : null;
                        return (
                          <td key={col.id} className="px-5 py-2.5">
                            <div className="flex flex-col items-start gap-0.5">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusTone(String(raw || ''))}`}
                              >
                                {displayDashText(raw || row.status_raw, '—')}
                              </span>
                              {reopen ? (
                                <span className="text-[11px] font-semibold leading-tight text-orange-700">
                                  {reopen.label}
                                  <span className="block font-medium text-slate-500">{formatWhen(reopen.when)}</span>
                                </span>
                              ) : null}
                            </div>
                          </td>
                        );
                      }
                      if (itsmCompanyMode && col.id === 'sla') {
                        const sla = itsmSlaDisplay(row);
                        const primary = sla.primary && sla.primary !== '—' ? sla.primary : 'On track';
                        const tone = sla.state === 'breached'
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : sla.state === 'hold'
                            ? 'border-slate-200 bg-slate-100 text-slate-600'
                            : sla.state === 'ok'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-slate-50 text-slate-600';
                        return (
                          <td key={col.id} className="px-5 py-2.5">
                            <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
                              {primary}
                            </span>
                            {sla.sub ? <p className="mt-1 text-[11px] text-slate-500">{sla.sub}</p> : null}
                          </td>
                        );
                      }
                      if (isDateRecordColumn(col.id)) {
                        const dateRaw = itsmCompanyMode && col.id === 'closed_at'
                          ? itsmClosedAtDisplay(row)
                          : String(raw || '');
                        return (
                          <td key={col.id} className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-600">
                            {formatWhen(dateRaw)}
                          </td>
                        );
                      }
                      const text = itsmCompanyMode
                        ? displayDashText(itsmRecordCellText(row, col.id), '—')
                        : col.id === 'assigned_to'
                          ? assignedRecordLabel(row, { itsmCompanyMode })
                          : col.id === 'purpose'
                            ? displayDashText(travelPurposeText(row), '—')
                            : displayPersonCell(raw);
                      const personCols = new Set(['requested_by', 'assigned_to', 'closed_by']);
                      if (itsmCompanyMode && personCols.has(col.id)) {
                        return (
                          <td key={col.id} title={text} className="px-5 py-2.5">
                            <MisPersonInitialsCell name={text === '—' ? '' : text} />
                          </td>
                        );
                      }
                      const wrapIds = new Set(['entity', 'company_name', 'website', 'subject', 'purpose', 'from_city', 'to_city', 'trip_type', 'form_status', 'source', 'ticket_type', 'category', 'expense_type']);
                      return (
                        <td
                          key={col.id}
                          title={text}
                          className={`px-5 py-2.5 text-slate-800 ${
                            wrapIds.has(col.id)
                              ? 'max-w-[14rem] whitespace-normal break-words'
                              : 'max-w-[220px]'
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                  {expanded ? (
                    <tr>
                      <td colSpan={visibleColumns.length + (showExpandColumn ? 1 : 0)} className="p-0">
                        <MisRecordExpandPanel tiles={expandTilesFor(row)} banner={expandBannerFor(row)} />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 ? (
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <span className="mr-auto text-xs tabular-nums text-slate-500">
                {filtered.length === 0
                  ? '0'
                  : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length.toLocaleString('en-IN')}`}
              </span>
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
