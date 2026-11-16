import { Fragment } from 'react';
import { RefreshCw } from 'lucide-react';
import { NE_TYPE } from '@/lib/neDashType';
import { formatExplicitRange, istTodayYmd, minYmd } from '@/lib/executiveDateFilters';
import type { ItsmRecurringMonth, ItsmRecurringTable, ItsmRecurringTableRow } from '@/lib/itsmTopIssueUsers';
import type { ItsmIssueDrillMetric } from '@/components/feature/ItsmTopIssueUsersCard';

export const ITSM_RECURRING_ISSUES_ID = 'ne-itsm-recurring-issues';

export function itsmRecurringMonthDrillKey(monthKey: string): string {
  return `month::${monthKey}`;
}

function rowToMonth(row: ItsmRecurringTableRow): ItsmRecurringMonth {
  return {
    key: row.monthKey,
    label: row.monthLabel,
    from: row.from,
    to: row.to,
    issues: [row.issue],
  };
}

function monthMetaFromRow(row: ItsmRecurringTableRow): ItsmRecurringMonth {
  return {
    key: row.monthKey,
    label: row.monthLabel,
    from: row.from,
    to: row.to,
    issues: [],
  };
}

function rowDateRangeLabel(row: ItsmRecurringTableRow): string {
  const from = row.from || '';
  const to = minYmd(row.to || '', istTodayYmd());
  if (!from && !to) return '—';
  return formatExplicitRange(from, to || from);
}

function monthTotals(rows: ItsmRecurringTableRow[], monthKey: string) {
  return rows
    .filter((row) => row.monthKey === monthKey)
    .reduce(
      (acc, row) => ({
        count: acc.count + row.issue.count,
        open: acc.open + row.issue.open,
        closed: acc.closed + row.issue.closed,
        slaBreached: acc.slaBreached + row.issue.slaBreached,
      }),
      { count: 0, open: 0, closed: 0, slaBreached: 0 },
    );
}

export default function ItsmRecurringIssuesCard({
  table,
  open = true,
  activeKey = null,
  activeMetric = null,
  onSelectMonth,
  onSelectMonthMetric,
  onSelectRow,
  onSelectRowMetric,
}: {
  table: ItsmRecurringTable;
  open?: boolean;
  activeKey?: string | null;
  activeMetric?: ItsmIssueDrillMetric | null;
  /** Drill Records to this calendar month (all tickets in the month window). */
  onSelectMonth?: (month: ItsmRecurringMonth) => void;
  /** Filter Records to Open / Closed / SLA Breached within the drilled month. */
  onSelectMonthMetric?: (month: ItsmRecurringMonth, metric: ItsmIssueDrillMetric) => void;
  onSelectRow?: (row: ItsmRecurringTableRow) => void;
  onSelectRowMetric?: (row: ItsmRecurringTableRow, metric: ItsmIssueDrillMetric) => void;
}) {
  if (!open) return null;

  const { months, rows } = table;
  const monthCount = months.length || 5;
  const spanFrom = months[0]?.from || '';
  const spanTo = minYmd(months[months.length - 1]?.to || '', istTodayYmd());
  const spanLabel = spanFrom || spanTo ? formatExplicitRange(spanFrom, spanTo || spanFrom) : '';
  const activeMonthKey = activeKey?.startsWith('month::')
    ? activeKey.slice('month::'.length)
    : null;

  return (
    <section
      id={ITSM_RECURRING_ISSUES_ID}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="min-w-0">
          <h3 className={NE_TYPE.sectionTitle}>Recurring issues</h3>
          <p className={`mt-0.5 ${NE_TYPE.meta}`}>
            Last {monthCount} months
            {spanLabel ? ` · ${spanLabel}` : ''}
            {' '}· click month to drill that date range · same requester + issue type 2+ times
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-500">
          <RefreshCw className="h-3.5 w-3.5" />
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {!rows.length ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          No recurring requester issues in the last {monthCount} months for this filter
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-4 py-2.5">Month</th>
                <th className="whitespace-nowrap px-4 py-2.5">User name</th>
                <th className="whitespace-nowrap px-4 py-2.5">Category</th>
                <th className="whitespace-nowrap px-4 py-2.5">Sub category</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right">Times</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right">Open</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right">Closed</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right">SLA breached</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const active = activeKey === row.key;
                const monthActive = activeMonthKey === row.monthKey;
                const month = rowToMonth(row);
                const dateLabel = rowDateRangeLabel(row);
                const firstInMonth = index === 0 || rows[index - 1]?.monthKey !== row.monthKey;
                const totals = monthActive && firstInMonth
                  ? monthTotals(rows, row.monthKey)
                  : null;
                return (
                  <Fragment key={row.key}>
                    <tr
                      className={`border-b border-slate-100 align-top transition ${
                        active || monthActive ? 'bg-[#F7F9FF]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {firstInMonth ? (
                          <button
                            type="button"
                            onClick={() => onSelectMonth?.(monthMetaFromRow(row))}
                            className={`rounded-lg px-1.5 py-1 text-left transition ${
                              monthActive ? 'bg-[#EEF4FF]' : 'hover:bg-slate-100'
                            }`}
                            title={`Drill into ${row.monthLabel} · ${dateLabel}`}
                          >
                            <div className={`text-xs font-semibold ${
                              monthActive ? 'text-[#2B5AED]' : 'text-slate-700'
                            }`}
                            >
                              {row.monthLabel}
                            </div>
                            <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">{dateLabel}</div>
                          </button>
                        ) : (
                          <span className="sr-only">{row.monthLabel}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => onSelectRow?.(row)}
                          className="text-left text-sm font-semibold text-slate-900 hover:text-[#2B5AED]"
                          title={`Filter ${row.userName} · ${row.issue.label} in ${row.monthLabel}`}
                        >
                          {row.userName}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{row.issue.category}</td>
                      <td className="px-4 py-2.5 text-slate-500">{row.issue.subCategory}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectRow?.(row)}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ${
                            active
                              ? 'bg-[#2B5AED] text-white ring-[#2B5AED]'
                              : 'bg-[#EEF4FF] text-[#2B5AED] ring-[#dbe4ff]'
                          }`}
                          title="Show Open / Closed / SLA Breached"
                        >
                          ×{row.issue.count}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectRowMetric?.(row, 'open')}
                          className={`tabular-nums font-semibold ${
                            active && activeMetric === 'open' ? 'text-[#A96A20]' : 'text-slate-800'
                          }`}
                          title={`Open in ${month.label}`}
                        >
                          {row.issue.open}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectRowMetric?.(row, 'closed')}
                          className={`tabular-nums font-semibold ${
                            active && activeMetric === 'closed' ? 'text-[#287B5D]' : 'text-slate-800'
                          }`}
                          title={`Closed in ${month.label}`}
                        >
                          {row.issue.closed}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectRowMetric?.(row, 'sla_breached')}
                          className={`tabular-nums font-semibold ${
                            active && activeMetric === 'sla_breached' ? 'text-[#B24E66]' : 'text-slate-800'
                          }`}
                          title={`SLA Breached in ${month.label}`}
                        >
                          {row.issue.slaBreached}
                        </button>
                      </td>
                    </tr>
                    {totals ? (
                      <tr className="border-b border-slate-100 bg-[#F7F9FF]">
                        <td colSpan={8} className="px-4 py-2.5">
                          <div className="rounded-xl border border-[#D6E2FF] bg-white px-3 py-2.5">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#2B5AED]">
                              {row.monthLabel} · {dateLabel} · all tickets in month · status breakdown
                            </p>
                            <div className="grid grid-cols-3 gap-2 sm:max-w-md">
                              <button
                                type="button"
                                onClick={() => onSelectMonthMetric?.(monthMetaFromRow(row), 'open')}
                                className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                                  activeMetric === 'open'
                                    ? 'bg-[#FFF4E5] ring-[#F5D9A8]'
                                    : 'bg-white ring-slate-200 hover:bg-[#FFF4E5]'
                                }`}
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#A96A20]">Open</div>
                                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{totals.open}</div>
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectMonthMetric?.(monthMetaFromRow(row), 'closed')}
                                className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                                  activeMetric === 'closed'
                                    ? 'bg-[#E8F7F0] ring-[#CDEBD9]'
                                    : 'bg-white ring-slate-200 hover:bg-[#E8F7F0]'
                                }`}
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#287B5D]">Closed</div>
                                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{totals.closed}</div>
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectMonthMetric?.(monthMetaFromRow(row), 'sla_breached')}
                                className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                                  activeMetric === 'sla_breached'
                                    ? 'bg-[#FCECEF] ring-[#F0D4DB]'
                                    : 'bg-white ring-slate-200 hover:bg-[#FCECEF]'
                                }`}
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#B24E66]">SLA Breached</div>
                                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{totals.slaBreached}</div>
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
