import { describe, expect, it } from 'vitest';
import {
  assignedRecordLabel,
  buildMisUsersFromRecords,
  countTodayActivity,
  countPmPortfolio,
  ensureFilterOption,
  filterAppRecords,
  mergeRosterWithTicketCounts,
  unionRosterWithTicketUsers,
  recordMatchesAssigned,
  stampRecordsWithAssigneeCompany,
} from './appDashboardClientFilter';
import { buildRefexCompanyOptions, recordMatchesCompany } from './refexCompanies';
import { isPlaceholderPersonName } from './personName';
import type { AppRecordRow } from '@/services/appRecordsApi';

describe('countPmPortfolio', () => {
  it('splits Project Task vs Sub Task and derives projects from Project ID', () => {
    const rows: AppRecordRow[] = [
      { id: '1', process_id: 'Project_Sub_Task_A01', project_id: 'P1', status: 'open' },
      { id: '2', process_id: 'Project_Sub_Task_A01', project_id: 'P1', status: 'closed' },
      { id: '3', process_id: 'Project_Sub_Task_A01', project_id: 'P2', status: 'closed' },
      { id: '4', process_id: 'Project_Sub_Task_A01', status: 'open' },
      { id: '5', process_id: 'Sub_Task_Process_A00', status: 'closed' },
      { id: '6', process_id: 'Live_IT_Service_Request_A00', status: 'open' },
    ];
    const p = countPmPortfolio(rows);
    expect(p.tasks_total).toBe(4);
    expect(p.tasks_open).toBe(2);
    expect(p.linked_tasks).toBe(3);
    expect(p.individual_total).toBe(1);
    expect(p.projects_total).toBe(2);
    expect(p.projects_open).toBe(1);
    expect(p.projects_closed).toBe(1);
    expect(p.subtasks_total).toBe(1);
    expect(p.subtasks_closed).toBe(1);
  });

  it('does not treat Project_Sub_Task as a sub-task', () => {
    const p = countPmPortfolio([
      { id: '1', process_id: 'Project_Sub_Task_A01', status: 'open' },
    ]);
    expect(p.subtasks_total).toBe(0);
    expect(p.tasks_total).toBe(1);
  });
});

describe('recordMatchesAssigned', () => {
  const row: AppRecordRow = {
    id: 't1',
    request_id: 'IT-1',
    assigned_to: 'Bhukkay Naik',
    assignee_id: 'Us-abc1234',
    assignee_email: 'bhukkay.naik@refex.co.in',
    status: 'open',
  };

  it('matches Kissflow user id even when assigned_to is a display name', () => {
    expect(recordMatchesAssigned(row, 'Bhukkay Naik', 'Us-abc1234')).toBe(true);
    expect(recordMatchesAssigned(row, undefined, 'Us-abc1234')).toBe(true);
  });

  it('matches compact display names', () => {
    expect(recordMatchesAssigned(row, 'Bhukkay Naik')).toBe(true);
    expect(recordMatchesAssigned(row, 'bhukkay naik')).toBe(true);
  });

  it('does not treat Pravin R as Pravin Kumar Raja', () => {
    expect(recordMatchesAssigned(
      { id: 'p1', assigned_to: 'Pravin R', status: 'open' },
      'Pravin Kumar Raja',
    )).toBe(false);
    expect(recordMatchesAssigned(
      { id: 'p2', assigned_to: 'Pravin Kumar Raja', status: 'open' },
      'Pravin Kumar Raja',
    )).toBe(true);
  });

  it('matches P2P requester when assigned_to is blank', () => {
    const row: AppRecordRow = {
      id: '29',
      request_id: '29',
      assigned_to: '—',
      requested_by: 'reginold.j',
      status: 'open',
    };
    expect(recordMatchesAssigned(row, 'Reginold J')).toBe(true);
  });

  it('does not treat ITSM requesters as Assigned to', () => {
    const row: AppRecordRow = {
      id: 't2',
      request_id: 'IT-2',
      assigned_to: '—',
      requested_by: 'Ada Lovelace',
      closed_by: 'Sakthivel',
      status: 'closed',
    };
    expect(recordMatchesAssigned(row, 'Ada Lovelace', undefined, { matchRequester: false })).toBe(false);
    expect(recordMatchesAssigned(row, 'Sakthivel', undefined, { matchRequester: false })).toBe(false);
  });

  it('matches aliased ITSM role names to the person', () => {
    expect(recordMatchesAssigned(
      { id: 't3', assigned_to: 'IT Manager Refex', status: 'open' },
      'Sakthivel',
    )).toBe(true);
  });
});

describe('filterAppRecords', () => {
  it('drops drafts and placeholder assignees from user-scoped counts', () => {
    const rows: AppRecordRow[] = [
      { id: '1', request_id: 'A', assigned_to: 'Bhukkay Naik', assignee_id: 'Us-abc1234', status: 'open' },
      { id: '2', request_id: 'B', assigned_to: '—', status: 'open' },
      { id: '3', request_id: 'C', assigned_to: 'Bhukkay Naik', status: 'open', status_raw: 'Draft' },
    ];
    const filtered = filterAppRecords(rows, { assigned: 'Bhukkay Naik', assignedId: 'Us-abc1234' });
    expect(filtered.map((r) => r.id)).toEqual(['1']);
  });

  it('drops process_status Draft rows', () => {
    const rows: AppRecordRow[] = [
      { id: '1', request_id: 'A', assigned_to: 'Ada', status: 'open' },
      { id: '2', request_id: 'B', assigned_to: 'Ada', status: 'open', process_status: 'Draft' },
    ];
    expect(filterAppRecords(rows).map((r) => r.id)).toEqual(['1']);
  });

  it('ITSM user filter does not include requester-only tickets', () => {
    const rows: AppRecordRow[] = [
      { id: '1', request_id: 'IT-1', assigned_to: 'Bhukkay Naik', requested_by: 'Ada Lovelace', status: 'open' },
      { id: '2', request_id: 'IT-2', assigned_to: '—', requested_by: 'Ada Lovelace', status: 'open' },
    ];
    expect(filterAppRecords(rows, { assigned: 'Ada Lovelace', itsmCompanyMode: true }).map((r) => r.id)).toEqual([]);
    expect(filterAppRecords(rows, { assigned: 'Bhukkay Naik', itsmCompanyMode: true }).map((r) => r.id)).toEqual(['1']);
  });

  it('Today activity window includes closed tickets created earlier', () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const rows: AppRecordRow[] = [
      { id: '1', request_id: 'A', status: 'closed', created_at: yesterday, closed_at: today },
      { id: '2', request_id: 'B', status: 'open', created_at: yesterday },
    ];
    expect(filterAppRecords(rows, { dateFrom: ymd, dateTo: ymd }).map((r) => r.id)).toEqual([]);
    expect(filterAppRecords(rows, { dateFrom: ymd, dateTo: ymd, activityDates: true }).map((r) => r.id)).toEqual(['1']);
  });
});

describe('countTodayActivity', () => {
  it('counts closed today from closed_at, not created_at', () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const counts = countTodayActivity([
      { id: '1', request_id: 'A', status: 'open', created_at: today },
      { id: '2', request_id: 'B', status: 'closed', created_at: yesterday, closed_at: today },
      { id: '3', request_id: 'C', status: 'closed', created_at: yesterday, closed_at: yesterday },
    ], ymd);
    expect(counts.opened).toBe(1);
    expect(counts.closed).toBe(1);
  });
});

describe('filterAppRecords todayKind', () => {
  it('keeps only records opened or closed today', () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const rows: AppRecordRow[] = [
      { id: '1', request_id: 'A', status: 'open', created_at: today, assigned_to: 'Ada' },
      { id: '2', request_id: 'B', status: 'closed', created_at: yesterday, closed_at: today, assigned_to: 'Ada' },
    ];
    expect(filterAppRecords(rows, { todayKind: 'opened' }).map((r) => r.id)).toEqual(['1']);
    expect(filterAppRecords(rows, { todayKind: 'closed' }).map((r) => r.id)).toEqual(['2']);
  });
});

describe('assignedRecordLabel', () => {
  it('uses closed_by then requester instead of Unknown for non-ITSM', () => {
    expect(assignedRecordLabel({ id: '1', assigned_to: '—', closed_by: 'Sakthivel' })).toBe('Sakthivel');
    expect(assignedRecordLabel({ id: '2', assigned_to: 'Unknown', requested_by: 'Ada Lovelace' })).toBe('Ada Lovelace');
    expect(assignedRecordLabel({ id: '3', assigned_to: '—' })).toBe('—');
  });

  it('ITSM shows workflow Assigned To only — never closer or requester', () => {
    expect(assignedRecordLabel(
      { id: '1', assigned_to: '—', closed_by: 'Sakthivel', requested_by: 'Ada Lovelace' },
      { itsmCompanyMode: true },
    )).toBe('—');
    expect(assignedRecordLabel(
      { id: '2', assigned_to: 'Unknown', requested_by: 'Ada Lovelace' },
      { itsmCompanyMode: true },
    )).toBe('—');
    expect(assignedRecordLabel(
      { id: '3', assigned_to: 'Bhukkay Naik', closed_by: 'Sakthivel', requested_by: 'Ada' },
      { itsmCompanyMode: true },
    )).toBe('Bhukkay Naik');
    expect(assignedRecordLabel(
      { id: '4', assigned_to: 'IT Manager Refex' },
      { itsmCompanyMode: true },
    )).toBe('Sakthivel');
  });
});

describe('company filter sort', () => {
  it('sorts A–Z and keeps numeric-leading names last', () => {
    const rows = buildRefexCompanyOptions({}, { includeAll: true });
    expect(rows[0]).toMatchObject({ id: 'all' });
    const labels = rows.slice(1).map((r) => r.label);
    const firstDigit = labels.findIndex((label) => /^[0-9]/.test(label));
    expect(labels[0].toLowerCase().startsWith('a')).toBe(true);
    expect(firstDigit).toBeGreaterThan(0);
    expect(labels.slice(firstDigit).every((label) => /^[0-9]/.test(label))).toBe(true);
    expect(labels[firstDigit]).toMatch(/^3i /);
    expect(labels.at(-1)).toMatch(/^3i /);
  });
});

describe('ensureFilterOption', () => {
  it('keeps a selected id that dropped out of the rebuilt list', () => {
    const rows = ensureFilterOption(
      [{ id: 'all', label: 'All Users' }, { id: 'Us-1', label: 'Ada' }],
      'Us-2',
      'Bhukkay Naik',
    );
    expect(rows.some((o) => o.id === 'Us-2' && o.label === 'Bhukkay Naik')).toBe(true);
  });
});

describe('isPlaceholderPersonName', () => {
  it('treats dash placeholders as empty', () => {
    expect(isPlaceholderPersonName('—')).toBe(true);
    expect(isPlaceholderPersonName('-')).toBe(true);
    expect(isPlaceholderPersonName('Bhukkay Naik')).toBe(false);
  });
});

describe('buildMisUsersFromRecords', () => {
  it('attributes ITSM tickets to assignees only, not requesters', () => {
    const rows: AppRecordRow[] = [
      { id: '1', assigned_to: 'Bhukkay Naik', requested_by: 'Ada', status: 'open' },
      { id: '2', assigned_to: '—', requested_by: 'Ada', status: 'closed' },
    ];
    const users = buildMisUsersFromRecords(rows, []);
    expect(users).toHaveLength(1);
    expect(users[0].user_name).toBe('Bhukkay Naik');
    expect(users[0].open).toBe(1);
  });

  it('can attribute P2P tickets to the requester when assigned is empty', () => {
    const users = buildMisUsersFromRecords(
      [{ id: '1', assigned_to: '—', requested_by: 'Reginold J', status: 'open' }],
      [],
      { ownerMode: 'assignee_or_requester' },
    );
    expect(users).toHaveLength(1);
    expect(users[0].user_name).toBe('Reginold J');
  });
});

describe('ITSM entity filter', () => {
  it('keeps Extrovis tickets even when company text looks like a Refex legal entity', () => {
    const rows: AppRecordRow[] = [
      {
        id: '1',
        request_id: 'IT-SR-Extrovis-1',
        entity_key: 'extrovis',
        entity: 'Extrovis',
        company_name: 'Refex Industries Limited',
        assignee_company: 'Refex Industries Limited',
        company_key: 'refex-industries-limited',
        status: 'open',
        assigned_to: 'Upendra Kumar Boddu',
      },
      {
        id: '2',
        request_id: 'IT-SR-Refex-1',
        entity_key: 'refex',
        entity: 'Refex',
        company_name: 'Refex',
        status: 'open',
        assigned_to: 'Sakthivel',
      },
    ];
    const ext = filterAppRecords(rows, { entity: 'extrovis', itsmCompanyMode: true });
    expect(ext.map((r) => r.id)).toEqual(['1']);
    const ref = filterAppRecords(rows, { entity: 'refex', itsmCompanyMode: true });
    expect(ref.map((r) => r.id)).toEqual(['2']);
  });

  it('builds MIS from Extrovis tickets including non-roster assignees', () => {
    const rows: AppRecordRow[] = [
      {
        id: '1',
        request_id: 'E1',
        entity_key: 'extrovis',
        assigned_to: 'First Approver Extrovis',
        status: 'open',
      },
      {
        id: '2',
        request_id: 'E2',
        entity_key: 'extrovis',
        assigned_to: 'Upendra Kumar Boddu',
        status: 'open',
      },
      {
        id: '3',
        request_id: 'R1',
        entity_key: 'refex',
        assigned_to: 'Agnes Simon',
        status: 'open',
      },
    ];
    const scoped = filterAppRecords(rows, { entity: 'extrovis', itsmCompanyMode: true });
    const mis = buildMisUsersFromRecords(scoped, [
      { user_id: '1', user_name: 'Upendra Kumar Boddu', email: 'u@refex.co.in' },
      { user_id: '2', user_name: 'Agnes Simon', email: 'a@refex.co.in' },
    ]);
    expect(mis.map((u) => u.user_name).sort()).toEqual([
      'First Approver Extrovis',
      'Upendra Kumar Boddu',
    ]);
    expect(mis.find((u) => u.user_name === 'Agnes Simon')).toBeUndefined();
  });
});

describe('mergeRosterWithTicketCounts', () => {
  it('keeps the APP_ROLE roster length and overlays assignee counts', () => {
    const roster = [
      { user_id: '1', user_name: 'Bhukkay Naik', email: 'b@refex.co.in', open: 0, closed: 0, rejected: 0, total: 0 },
      { user_id: '2', user_name: 'Agnes Simon', email: 'a@refex.co.in', open: 0, closed: 0, rejected: 0, total: 0 },
    ];
    const tickets = buildMisUsersFromRecords(
      [
        { id: '1', assigned_to: 'Bhukkay Naik', requested_by: 'Visitor', status: 'open' },
        { id: '2', assigned_to: 'Visitor', requested_by: 'Visitor', status: 'closed' },
      ],
      roster,
    );
    const merged = mergeRosterWithTicketCounts(roster, tickets);
    expect(merged).toHaveLength(2);
    expect(merged.find((u) => u.user_name === 'Bhukkay Naik')?.open).toBe(1);
    expect(merged.find((u) => u.user_name === 'Agnes Simon')?.total).toBe(0);
  });

  it('Entity=All unions missing ITSM assignees onto the roster', () => {
    const roster = [
      { user_id: '1', user_name: 'Extrovis Agent', email: 'e@extrovis.com', open: 0, closed: 0, rejected: 0, total: 0 },
    ];
    const tickets = buildMisUsersFromRecords(
      [
        { id: '1', request_id: 'A', assigned_to: 'Extrovis Agent', entity_key: 'extrovis', status: 'open' },
        { id: '2', request_id: 'B', assigned_to: 'Sakthivel', entity_key: 'refex', status: 'open' },
      ],
      roster,
    );
    const merged = mergeRosterWithTicketCounts(roster, tickets);
    expect(merged.map((u) => u.user_name)).toEqual(['Extrovis Agent']);
    const unioned = unionRosterWithTicketUsers(roster, tickets);
    expect(unioned.map((u) => u.user_name).sort()).toEqual(['Extrovis Agent', 'Sakthivel']);
  });
});

describe('ITSM company filter', () => {
  it('does not match Industries Limited from Entity bucket text', () => {
    const row: AppRecordRow = {
      id: '1',
      request_id: 'IT-1',
      company_name: 'Refex',
      entity: 'Refex',
      entity_key: 'refex',
      status: 'open',
    };
    expect(recordMatchesCompany(row, 'refex-industries-limited', false)).toBe(false);
  });

  it('defaults blank / bucket-only ITSM company to Refex Industries Limited', () => {
    const row: AppRecordRow = {
      id: '1',
      request_id: 'IT-1',
      company_name: 'Refex',
      entity_key: 'refex',
      status: 'open',
    };
    expect(recordMatchesCompany(row, 'refex-industries-limited', true)).toBe(true);
    expect(recordMatchesCompany(row, 'refex-green-energy-limited', true)).toBe(false);
  });

  it('matches only the lookup legal company, not other Refex catalog names', () => {
    const row: AppRecordRow = {
      id: '1',
      request_id: 'IT-1',
      company_name: 'Refex Green Energy Limited',
      entity: 'Refex',
      entity_key: 'refex',
      status: 'open',
    };
    expect(recordMatchesCompany(row, 'refex-green-energy-limited', true)).toBe(true);
    expect(recordMatchesCompany(row, 'refex-industries-limited', true)).toBe(false);
  });

  it('does not stamp assignee company over ITSM lookup / default', () => {
    const stamped = stampRecordsWithAssigneeCompany(
      [{
        id: '1',
        request_id: 'IT-1',
        company_name: 'Refex',
        assigned_to: 'Ada',
        status: 'open',
      }],
      [{ user_id: '1', user_name: 'Ada', company: 'Venwind Refex Power Limited', total: 0 }],
      { itsmCompanyMode: true },
    );
    expect(stamped[0].company_name).toBe('Refex Industries Limited');
    expect(stamped[0].company_key).toBe('refex-industries-limited');
  });

  it('still stamps assignee company for non-ITSM bucket-only rows', () => {
    const stamped = stampRecordsWithAssigneeCompany(
      [{
        id: '1',
        request_id: 'PM-1',
        company_name: 'Refex',
        assigned_to: 'Ada',
        status: 'open',
      }],
      [{ user_id: '1', user_name: 'Ada', company: 'Venwind Refex Power Limited', total: 0 }],
    );
    expect(stamped[0].company_name).toBe('Venwind Refex Power Limited');
  });

  it('excludes Venwind companies from the ITSM Refex entity tab', () => {
    const rows: AppRecordRow[] = [
      {
        id: '1',
        request_id: 'A',
        company_name: 'Refex Industries Limited',
        entity_key: 'refex',
        status: 'open',
      },
      {
        id: '2',
        request_id: 'B',
        company_name: 'Venwind Refex Power Limited',
        entity_key: 'refex',
        status: 'open',
      },
    ];
    expect(filterAppRecords(rows, { entity: 'refex', itsmCompanyMode: true }).map((r) => r.id)).toEqual(['1']);
  });
});

