import type { AppRecordColumn, AppRecordRow } from '@/services/appRecordsApi';
import { displayWhen, formatInr, isBlankDash } from '@/lib/dashboardEmpty';

/** HTML Expense records plus Assigned to / Expense date when filled. Expand must not repeat these. */
export const EMS_DASH_COLUMNS: AppRecordColumn[] = [
  { id: 'request_id', label: 'Exp ID' },
  { id: 'expense_type', label: 'Expense type' },
  { id: 'requested_by', label: 'Requestor' },
  { id: 'assigned_to', label: 'Assigned to' },
  { id: 'amount', label: 'Amount' },
  { id: 'current_step', label: 'Current step' },
  { id: 'status', label: 'Status' },
  { id: 'entity', label: 'Entity' },
  { id: 'company_name', label: 'Company name' },
  { id: 'expense_date', label: 'Expense date' },
  { id: 'created_at', label: 'Requested on' },
];

const EMS_ALWAYS_COLUMNS = new Set([
  'request_id',
  'expense_type',
  'requested_by',
  'assigned_to',
  'amount',
  'current_step',
  'status',
  'entity',
  'company_name',
  'created_at',
]);

export function isEmsCoreColumn(colId: string): boolean {
  return EMS_ALWAYS_COLUMNS.has(colId);
}

function tile(label: string, value: unknown): { label: string; value: string } {
  if (isBlankDash(value)) return { label, value: '' };
  return { label, value: String(value).trim() };
}

function dateTile(label: string, value: unknown): { label: string; value: string } {
  if (isBlankDash(value)) return { label, value: '' };
  const formatted = displayWhen(String(value));
  return { label, value: formatted === '—' ? '' : formatted };
}

type ExpenseSplit = { type?: string; amount?: number | null; vehicle?: string };

function expenseSplits(row: AppRecordRow): ExpenseSplit[] {
  if (Array.isArray(row.expense_splits) && row.expense_splits.length) {
    return row.expense_splits as ExpenseSplit[];
  }
  const types = String(row.expense_type || '')
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '—');
  if (types.length <= 1) return [];
  return types.map((type) => ({ type }));
}

function splitAmountLabel(split: ExpenseSplit): string {
  const vehicle = String(split.vehicle || '').trim();
  const conveyance = /convey|local travel|transport/i.test(String(split.type || ''));
  let amount = 'Included';
  if (split.amount != null && Number.isFinite(Number(split.amount)) && Number(split.amount) > 0) {
    amount = formatInr(Number(split.amount));
  }
  if (conveyance && vehicle) {
    return amount === 'Included' ? vehicle : `${amount} · ${vehicle}`;
  }
  return amount;
}

/** Unique extras only. Empty tiles are dropped by the panel. */
export function emsExpandTiles(row: AppRecordRow): Array<{ label: string; value: string }> {
  const splits = expenseSplits(row);
  const showSplits = splits.length > 1 || splits.some((split) => Number(split.amount) > 0);
  const splitTiles = showSplits
    ? splits
      .filter((split) => String(split.type || '').trim())
      .map((split) => tile(String(split.type).trim(), splitAmountLabel(split)))
    : [];
  const splitTotal = splits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
  const conveyance = /convey|local travel|transport/i.test(String(row.expense_type || ''))
    || splits.some((split) => /convey|local travel|transport/i.test(String(split.type || '')));
  const vehicle = String(row.vehicle_type || row.travel_mode || '').trim();
  const status = String(row.status || '').toLowerCase();
  const pending = (status === 'open' || status === 'pending' || /pending/i.test(String(row.status_raw || '')))
    ? String(row.current_step || '').trim()
    : '';
  return [
    ...splitTiles,
    splits.length > 1 && splitTotal > 0 ? tile('Splits total', formatInr(splitTotal)) : tile('Splits total', ''),
    tile('Vehicle type', conveyance ? vehicle : ''),
    tile('Pending at', pending),
    tile('Designation', row.designation),
    tile('Department', row.department),
    tile('Expense by', row.expense_by),
    tile('Restaurant', row.restaurant),
    tile('From place', row.from_city),
    tile('To place', row.to_city),
    tile('Travel mode', conveyance ? '' : row.travel_mode),
    tile('Have advance', row.have_advance),
    tile('L1 manager status', row.l1_status),
    dateTile('Completed', row.closed_at),
  ];
}
