import type { AppRecordRow } from '@/services/appRecordsApi';
import { personDedupeKey } from '@/lib/personName';

/**
 * Travel dashboard: SLA Breached (Kissflow SLA_Deadline) and Department filter.
 * Department lives on Travel Expense only; Booking / Advance rows take the department
 * of the same requester's Travel Expense rows.
 */

function toMs(value: unknown): number {
  if (!value) return NaN;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Travel Booking SLA = created_at vs departure_date (same as the MIS SLA column).
 * Breached only when departure is before created (negative lead time).
 * Kissflow SLA_Deadline is not used for this KPI — it inflated counts while the
 * column correctly showed Not breached.
 */
export function isTravelSlaBreached(row: AppRecordRow, _nowMs: number = Date.now()): boolean {
  void _nowMs;
  const created = toMs(row.created_at);
  const depart = toMs(row.departure_date);
  if (!Number.isFinite(created) || !Number.isFinite(depart)) return false;
  return depart < created;
}

function requesterKey(row: AppRecordRow): string {
  return personDedupeKey(row.requested_by || '');
}

function cleanDepartment(value: unknown): string {
  const text = String(value ?? '').trim();
  return text && text !== '—' ? text : '';
}

/** Requester → department, from rows that carry Department (Travel Expense). Most recent row wins. */
export function buildTravelRequesterDepartments(rows: AppRecordRow[]): Map<string, string> {
  const latest = new Map<string, { department: string; at: number }>();
  for (const row of rows || []) {
    const department = cleanDepartment(row.department);
    const key = requesterKey(row);
    if (!department || !key) continue;
    const at = toMs(row.created_at);
    const prev = latest.get(key);
    if (!prev || (Number.isFinite(at) && at > prev.at)) {
      latest.set(key, { department, at: Number.isFinite(at) ? at : -Infinity });
    }
  }
  return new Map([...latest].map(([key, value]) => [key, value.department]));
}

export function travelRowDepartment(row: AppRecordRow, byRequester: Map<string, string>): string {
  return cleanDepartment(row.department) || byRequester.get(requesterKey(row)) || '';
}

export function travelDepartmentOptions(
  rows: AppRecordRow[],
  byRequester: Map<string, string>,
): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows || []) {
    const department = travelRowDepartment(row, byRequester);
    if (!department) continue;
    counts.set(department, (counts.get(department) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([department, count]) => ({ value: department, label: department, count }));
}

export function filterTravelRowsByDepartment(
  rows: AppRecordRow[],
  department: string,
  byRequester: Map<string, string>,
): AppRecordRow[] {
  if (!department || department === 'all') return rows;
  const want = department.trim().toLowerCase();
  return (rows || []).filter(
    (row) => travelRowDepartment(row, byRequester).toLowerCase() === want,
  );
}
