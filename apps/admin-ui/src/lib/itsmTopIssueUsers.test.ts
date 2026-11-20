import { describe, expect, it } from 'vitest';
import {
  buildItsmRecurringIssues,
  buildItsmRecurringIssuesByMonth,
  buildItsmRecurringUserTable,
  buildItsmTopIssueUsers,
  buildItsmTopTickets,
  filterItsmByTicketKind,
  itsmTicketKind,
} from './itsmTopIssueUsers';

describe('itsmTicketKind / filterItsmByTicketKind', () => {
  it('classifies Service Request and Incident', () => {
    expect(itsmTicketKind({ ticket_type: 'Service Request' })).toBe('sr');
    expect(itsmTicketKind({ ticket_type: 'Incident' })).toBe('incident');
    expect(itsmTicketKind({ ticket_type: 'Change Request' })).toBe('other');
  });

  it('filters top users by request type', () => {
    const rows = [
      { requested_by: 'Ada', ticket_type: 'Service Request', category: 'A', sub_category: '1' },
      { requested_by: 'Ada', ticket_type: 'Service Request', category: 'A', sub_category: '1' },
      { requested_by: 'Bob', ticket_type: 'Incident', category: 'B', sub_category: '2' },
      { requested_by: 'Bob', ticket_type: 'Incident', category: 'B', sub_category: '2' },
      { requested_by: 'Bob', ticket_type: 'Incident', category: 'B', sub_category: '2' },
    ];
    expect(buildItsmTopIssueUsers(filterItsmByTicketKind(rows, 'sr'), 10).map((u) => u.name)).toEqual(['Ada']);
    expect(buildItsmTopIssueUsers(filterItsmByTicketKind(rows, 'incident'), 10).map((u) => u.name)).toEqual(['Bob']);
  });

  it('uses Requester Name (Behalf Of / requester), not Raised By proxy', () => {
    const rows = [
      {
        requested_by: 'Priya S',
        raised_by: 'Fazulahemed',
        behalf_of_name: 'Priya S',
        ticket_type: 'Service Request',
        category: 'Hardware',
        sub_category: 'Laptop',
      },
      {
        requested_by: 'Priya S',
        raised_by: 'Fazulahemed',
        behalf_of_name: 'Priya S',
        ticket_type: 'Service Request',
        category: 'Hardware',
        sub_category: 'Laptop',
      },
      {
        requested_by: 'Ada',
        raised_by: 'Ada',
        ticket_type: 'Service Request',
        category: 'Network',
        sub_category: 'VPN',
      },
    ];
    expect(buildItsmTopIssueUsers(rows, 10).map((u) => `${u.name}:${u.total}`)).toEqual([
      'Priya S:2',
      'Ada:1',
    ]);
  });
});

describe('buildItsmTopIssueUsers', () => {
  it('ranks requesters by ticket count and lists issue frequencies', () => {
    const rows = [
      { requested_by: 'Ada', category: 'Hardware', sub_category: 'Laptop' },
      { requested_by: 'Ada', category: 'Hardware', sub_category: 'Laptop' },
      { requested_by: 'Ada', category: 'Network', sub_category: 'VPN' },
      { requested_by: 'Bob', category: 'Access', sub_category: 'Email' },
      { requested_by: 'Bob', category: 'Access', sub_category: 'Email' },
      { requested_by: 'Bob', category: 'Access', sub_category: 'Email' },
      { requested_by: 'Bob', category: 'Access', sub_category: 'Email' },
      { requested_by: 'Cara', category: 'Software', sub_category: 'Office' },
    ];
    const top = buildItsmTopIssueUsers(rows, 10);
    expect(top.map((u) => u.name)).toEqual(['Bob', 'Ada', 'Cara']);
    expect(top[0].total).toBe(4);
    expect(top[0].issues).toEqual([
      {
        key: 'access||email',
        label: 'Access · Email',
        category: 'Access',
        subCategory: 'Email',
        count: 4,
        open: 4,
        closed: 0,
        slaBreached: 0,
      },
    ]);
    expect(top[1].issues.map((i) => `${i.label}:${i.count}`)).toEqual([
      'Hardware · Laptop:2',
      'Network · VPN:1',
    ]);
  });

  it('counts open, closed, and SLA breached per issue type', () => {
    const rows = [
      { requested_by: 'Ada', category: 'Hardware', sub_category: 'Laptop', status: 'Open' },
      { requested_by: 'Ada', category: 'Hardware', sub_category: 'Laptop', status: 'Closed' },
      {
        requested_by: 'Ada',
        category: 'Hardware',
        sub_category: 'Laptop',
        status: 'Open',
        sla_breached: 'true',
      },
      { requested_by: 'Ada', category: 'Network', sub_category: 'VPN', status: 'Rejected' },
    ];
    const top = buildItsmTopIssueUsers(rows, 10);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({
      name: 'Ada',
      total: 4,
      open: 2,
      closed: 1,
      slaBreached: 1,
    });
    expect(top[0].issues[0]).toMatchObject({
      label: 'Hardware · Laptop',
      count: 3,
      open: 2,
      closed: 1,
      slaBreached: 1,
    });
    expect(top[0].issues[1]).toMatchObject({
      label: 'Network · VPN',
      count: 1,
      open: 0,
      closed: 0,
      slaBreached: 0,
    });
  });

  it('limits to top N and skips blank requesters', () => {
    const rows = [
      { requested_by: 'Ada', category: 'A', sub_category: '1' },
      { requested_by: '', category: 'A', sub_category: '1' },
      { requested_by: 'Bob', category: 'B', sub_category: '2' },
      { requested_by: 'Bob', category: 'B', sub_category: '2' },
    ];
    expect(buildItsmTopIssueUsers(rows, 1).map((u) => u.name)).toEqual(['Bob']);
  });
});

describe('buildItsmTopTickets', () => {
  it('ranks issue types by ticket count', () => {
    const rows = [
      { category: 'Hardware', sub_category: 'Laptop' },
      { category: 'Hardware', sub_category: 'Laptop' },
      { category: 'Hardware', sub_category: 'Laptop' },
      { category: 'Network', sub_category: 'VPN' },
      { category: 'Network', sub_category: 'VPN' },
      { category: 'Access', sub_category: 'Email' },
    ];
    const top = buildItsmTopTickets(rows, 10);
    expect(top.map((t) => `${t.label}:${t.count}`)).toEqual([
      'Hardware · Laptop:3',
      'Network · VPN:2',
      'Access · Email:1',
    ]);
    expect(buildItsmTopTickets(rows, 2)).toHaveLength(2);
  });
});

describe('buildItsmRecurringIssues', () => {
  it('keeps only issue types raised 2+ times with status counts', () => {
    const rows = [
      { category: 'Hardware', sub_category: 'Laptop', status: 'Open' },
      { category: 'Hardware', sub_category: 'Laptop', status: 'Closed' },
      { category: 'Hardware', sub_category: 'Laptop', status: 'Open', sla_breached: 'true' },
      { category: 'Network', sub_category: 'VPN', status: 'Open' },
      { category: 'Network', sub_category: 'VPN', status: 'Rejected' },
      { category: 'Access', sub_category: 'Email', status: 'Open' },
    ];
    const recurring = buildItsmRecurringIssues(rows, 10);
    expect(recurring.map((t) => `${t.label}:${t.count}`)).toEqual([
      'Hardware · Laptop:3',
      'Network · VPN:2',
    ]);
    expect(recurring[0]).toMatchObject({ open: 2, closed: 1, slaBreached: 1 });
    expect(recurring[1]).toMatchObject({ open: 1, closed: 0, slaBreached: 0 });
  });
});

describe('buildItsmRecurringIssuesByMonth', () => {
  it('groups recurring issue types by calendar month', () => {
    const rows = [
      { category: 'Hardware', sub_category: 'Laptop', status: 'Open', created_at: '2026-11-02T10:00:00+05:30' },
      { category: 'Hardware', sub_category: 'Laptop', status: 'Closed', created_at: '2026-11-18T10:00:00+05:30' },
      { category: 'Access', sub_category: 'Email', status: 'Open', created_at: '2026-11-05T10:00:00+05:30' },
      { category: 'Network', sub_category: 'VPN', status: 'Open', created_at: '2026-10-03T10:00:00+05:30' },
      { category: 'Network', sub_category: 'VPN', status: 'Closed', created_at: '2026-10-20T10:00:00+05:30' },
      { category: 'Network', sub_category: 'VPN', status: 'Open', created_at: '2026-11-12T10:00:00+05:30' },
    ];
    const months = buildItsmRecurringIssuesByMonth(rows, 10);
    expect(months.map((m) => m.key)).toEqual(['2026-11', '2026-10']);
    expect(months[0].issues.map((i) => `${i.label}:${i.count}`)).toEqual([
      'Hardware · Laptop:2',
    ]);
    expect(months[1].issues.map((i) => `${i.label}:${i.count}`)).toEqual([
      'Network · VPN:2',
    ]);
  });
});

describe('buildItsmRecurringUserTable', () => {
  it('builds a 5-month table with requester names for recurring rows', () => {
    const rows = [
      { requested_by: 'Ada', category: 'Hardware', sub_category: 'Laptop', status: 'Open', created_at: '2026-11-02T10:00:00+05:30' },
      { requested_by: 'Ada', category: 'Hardware', sub_category: 'Laptop', status: 'Closed', created_at: '2026-11-18T10:00:00+05:30' },
      { requested_by: 'Bob', category: 'Network', sub_category: 'VPN', status: 'Open', created_at: '2026-10-03T10:00:00+05:30' },
      { requested_by: 'Bob', category: 'Network', sub_category: 'VPN', status: 'Closed', created_at: '2026-10-20T10:00:00+05:30' },
      { requested_by: 'Cara', category: 'Access', sub_category: 'Email', status: 'Open', created_at: '2026-11-05T10:00:00+05:30' },
    ];
    const table = buildItsmRecurringUserTable(rows, 5, 2);
    expect(table.months.map((m) => m.key)).toEqual(['2026-10', '2026-11']);
    expect(table.rows.map((r) => `${r.monthKey}|${r.userName}|${r.issue.label}:${r.issue.count}`)).toEqual([
      '2026-11|Ada|Hardware · Laptop:2',
      '2026-10|Bob|Network · VPN:2',
    ]);
  });
});
