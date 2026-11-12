import { describe, expect, it } from 'vitest';
import type { AppRecordRow } from '@/services/appRecordsApi';
import {
  buildTravelRequesterDepartments,
  filterTravelRowsByDepartment,
  isTravelSlaBreached,
  travelDepartmentOptions,
  travelRowDepartment,
} from './travelDepartmentSla';

const NOW = Date.parse('2026-11-03T06:00:00Z');

describe('isTravelSlaBreached', () => {
  it('breached only when departure is before created (same as MIS SLA column)', () => {
    expect(isTravelSlaBreached({
      id: '1',
      created_at: '2026-11-03T10:00:00Z',
      departure_date: '2026-11-01T10:00:00Z',
    }, NOW)).toBe(true);
    expect(isTravelSlaBreached({
      id: '2',
      created_at: '2026-11-01T10:00:00Z',
      departure_date: '2026-11-04T10:00:00Z',
    }, NOW)).toBe(false);
  });
  it('ignores Kissflow SLA_Deadline for the booking KPI', () => {
    expect(isTravelSlaBreached({
      id: '3',
      status: 'open',
      sla_deadline: '2026-11-01T10:00:00Z',
      created_at: '2026-11-01T10:00:00Z',
      departure_date: '2026-11-05T10:00:00Z',
    }, NOW)).toBe(false);
  });
  it('missing created or departure → never breached', () => {
    expect(isTravelSlaBreached({ id: '6', status: 'open' }, NOW)).toBe(false);
    expect(isTravelSlaBreached({ id: '7', created_at: '2026-11-01T10:00:00Z' }, NOW)).toBe(false);
  });
});

describe('travel department by requester', () => {
  const rows: AppRecordRow[] = [
    { id: 'e1', process_id: 'Travel expense', requested_by: 'Palani C', department: 'Finance', created_at: '2026-10-01T00:00:00Z' },
    { id: 'e2', process_id: 'Travel expense', requested_by: 'Palani C', department: 'Operations', created_at: '2026-10-20T00:00:00Z' },
    { id: 'e3', process_id: 'Travel expense', requested_by: 'Jagan Mohan', department: 'Business Development' },
    { id: 'b1', process_id: 'Travel request', requested_by: 'Palani C' },
    { id: 'b2', process_id: 'Travel request', requested_by: 'jagan  mohan' },
    { id: 'b3', process_id: 'Travel request', requested_by: 'No Expense Person' },
    { id: 'a1', process_id: 'Travel advance', requested_by: 'Jagan Mohan' },
  ];
  const map = buildTravelRequesterDepartments(rows);

  it('booking / advance rows take the requester department (latest expense wins)', () => {
    expect(travelRowDepartment(rows[3], map)).toBe('Operations');
    expect(travelRowDepartment(rows[4], map)).toBe('Business Development');
    expect(travelRowDepartment(rows[6], map)).toBe('Business Development');
    expect(travelRowDepartment(rows[5], map)).toBe('');
  });

  it('expense rows keep their own department', () => {
    expect(travelRowDepartment(rows[0], map)).toBe('Finance');
  });

  it('options list every department with counts', () => {
    expect(travelDepartmentOptions(rows, map)).toEqual([
      { value: 'Business Development', label: 'Business Development', count: 3 },
      { value: 'Finance', label: 'Finance', count: 1 },
      { value: 'Operations', label: 'Operations', count: 2 },
    ]);
  });

  it('filters all processes; all = unchanged; requesters without a department drop out', () => {
    expect(filterTravelRowsByDepartment(rows, 'all', map)).toBe(rows);
    expect(filterTravelRowsByDepartment(rows, 'Business Development', map).map((r) => r.id)).toEqual(['e3', 'b2', 'a1']);
    expect(filterTravelRowsByDepartment(rows, 'operations', map).map((r) => r.id)).toEqual(['e2', 'b1']);
  });
});
