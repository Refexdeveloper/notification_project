import { describe, expect, it } from 'vitest';
import { getPersonInitials } from './personName';
import {
  ITSM_CEO_RECORD_COLUMNS,
  itsmClosedAtDisplay,
  itsmClosedByDisplay,
  itsmHumanName,
  itsmRecordCellText,
  itsmRequesterName,
  stampItsmRequesterNames,
  itsmTicketUserName,
  getRequestTypeShort,
  itsmExpandTiles,
  countItsmSlaBreached,
  isItsmSlaBreached,
  itsmSlaDisplay,
  itsmTicketName,
  itsmReopenedStamp,
  itsmStageLabel,
} from './itsmRecordDisplay';

describe('getPersonInitials', () => {
  it('matches newceo compact requester labels', () => {
    expect(getPersonInitials('Mohamed Aasik')).toBe('MA');
    expect(getPersonInitials('Arun Kumar')).toBe('AK');
    expect(getPersonInitials('Gowtham')).toBe('GW');
    expect(getPersonInitials('')).toBe('');
  });
});

describe('ITSM_CEO_RECORD_COLUMNS', () => {
  it('matches newceo MIS columns', () => {
    expect(ITSM_CEO_RECORD_COLUMNS.map((c) => c.id)).toEqual([
      'request_id',
      'requested_by',
      'company_name',
      'assigned_to',
      'sla',
      'created_at',
      'status',
      'form_status',
      'source',
      'category',
      'sub_category',
      'laptop_label',
      'ticket_type',
      'closed_by',
      'closed_at',
    ]);
    expect(ITSM_CEO_RECORD_COLUMNS.find((c) => c.id === 'requested_by')?.label).toBe('Requester Name');
    expect(ITSM_CEO_RECORD_COLUMNS.find((c) => c.id === 'company_name')?.label).toBe('Company');
    expect(ITSM_CEO_RECORD_COLUMNS.find((c) => c.id === 'laptop_label')?.label).toBe('Laptop');
  });
});

describe('itsmHumanName', () => {
  it('skips ITSM Bot and uses Closed By', () => {
    expect(itsmHumanName({ id: '1', assigned_to: 'ITSM Bot', closed_by: 'Sakthivel' })).toBe('Sakthivel');
    expect(itsmHumanName({ id: '2', assigned_to: 'Bhukkay Naik', closed_by: 'Sakthivel' })).toBe('Bhukkay Naik');
    expect(itsmHumanName({ id: '3', assigned_to: 'IT Agents Extrovis', closed_by: 'Sakthivel' })).toBe('Sakthivel');
  });
});

describe('itsmRequesterName', () => {
  it('prefers Behalf Of Name when a proxy raised the ticket', () => {
    expect(itsmRequesterName({
      id: '1',
      requested_by: 'Fazulahemed',
      behalf_of_name: 'Priya S',
    } as never)).toBe('Priya S');
    expect(itsmRequesterName({
      id: '2',
      requested_by: 'Fazulahemed',
      Behalf_Of_Name: { Name: 'Arun Kumar' },
    } as never)).toBe('Arun Kumar');
    expect(itsmRequesterName({
      id: '3',
      requested_by: 'Sudhaya K',
    } as never)).toBe('Sudhaya K');
  });
});

describe('stampItsmRequesterNames', () => {
  it('rewrites requested_by to Behalf Of Name for IT Help Desk rows', () => {
    const rows = stampItsmRequesterNames([
      { id: '1', requested_by: 'Fazulahemed', behalf_of_name: 'Priya S' },
      { id: '2', requested_by: 'Sudhaya K' },
    ] as never);
    expect(rows.map((r) => r.requested_by)).toEqual(['Priya S', 'Sudhaya K']);
  });
});

describe('itsmTicketUserName', () => {
  it('uses raised-by when present', () => {
    expect(itsmTicketUserName({
      id: '1',
      requested_by: 'Priya S',
      raised_by: 'Fazulahemed',
      behalf_of_name: 'Priya S',
    } as never)).toBe('Fazulahemed');
    expect(itsmTicketUserName({
      id: '2',
      requested_by: 'Sudhaya K',
    } as never)).toBe('Sudhaya K');
  });
});

describe('itsmReopenedStamp', () => {
  it('only returns a stamp when reopened_at is present', () => {
    expect(itsmReopenedStamp({ id: '1', status: 'open' })).toBeNull();
    expect(itsmReopenedStamp({ id: '2', status: 'open', reopened_at: '2026-10-04T08:00:00Z' })).toEqual({
      label: 'Reopened',
      when: '2026-10-04T08:00:00Z',
    });
  });
});

describe('itsmStageLabel', () => {
  it('maps Completed to Closed', () => {
    expect(itsmStageLabel({ id: '1', form_status: 'Completed' })).toBe('Closed');
    expect(itsmStageLabel({ id: '2', form_status: 'On Hold' })).toBe('OnHold');
    expect(itsmStageLabel({ id: '3', form_status: 'InProgress' })).toBe('InProgress');
    expect(itsmStageLabel({ id: '4', current_step: 'InProgress' })).toBe('');
  });
});

describe('itsmClosedAtDisplay', () => {
  it('uses closed_at then agent close for closed tickets', () => {
    expect(itsmClosedAtDisplay({
      id: '1',
      status: 'closed',
      closed_at: '2026-10-01T10:00:00Z',
      agent_closed_at: '2026-10-02T10:00:00Z',
    })).toBe('2026-10-01T10:00:00Z');
    expect(itsmClosedAtDisplay({
      id: '2',
      status: 'closed',
      agent_closed_at: '2026-10-02T10:00:00Z',
    })).toBe('2026-10-02T10:00:00Z');
    expect(itsmClosedAtDisplay({
      id: '3',
      status: 'open',
      modified_at: '2026-10-02T10:00:00Z',
    })).toBe('');
  });
});

describe('itsmSlaDisplay', () => {
  it('shows Exceeded by when elapsed is over budget', () => {
    const sla = itsmSlaDisplay({
      id: '1',
      status: 'closed',
      created_at: '2026-10-01T00:00:00Z',
      closed_at: '2026-10-02T02:00:00Z',
      sla_minutes: 60,
    });
    expect(sla.primary).toBe('Breached');
    expect(sla.sub).toMatch(/^Exceeded by /);
  });

  it('shows Hold for On Hold stage', () => {
    expect(itsmSlaDisplay({ id: '2', form_status: 'On Hold', sla_minutes: 60 }).primary).toBe('Hold');
  });

  it('never paints No SLA and prefers Closure Time', () => {
    expect(itsmSlaDisplay({ id: '3', status: 'open' }).primary).toBe('On track');
    expect(itsmSlaDisplay({
      id: '4',
      status: 'open',
      form_status: 'Pending Approval',
      created_at: '2026-10-06T06:00:00Z',
    }, new Date('2026-10-06T06:30:00Z')).primary).toBe('On track');
    const preferClosure = itsmSlaDisplay({
      id: '5',
      status: 'open',
      sla_minutes: 30,
      closure_minutes: 180,
      created_at: '2026-10-06T06:00:00Z',
    }, new Date('2026-10-06T07:00:00Z'));
    expect(preferClosure.primary).toBe('On track');
    expect(preferClosure.sub).toMatch(/left/);
  });
});

describe('itsmTicketName', () => {
  it('skips process titles and uses description', () => {
    expect(itsmTicketName({
      id: '1',
      subject: 'Live_IT_Service_Request_A00',
      description: 'Laptop cursor is not working properly. Please help.',
    })).toBe('Laptop cursor is not working properly.');
  });

  it('prefers a real summary/subject', () => {
    expect(itsmTicketName({
      id: '2',
      subject: 'VPN access for new joiner',
      description: 'Longer description body',
    })).toBe('VPN access for new joiner');
  });
});

describe('isItsmSlaBreached / countItsmSlaBreached', () => {
  it('counts only breached rows for the SLA card', () => {
    const breached = {
      id: '1',
      status: 'closed',
      created_at: '2026-10-01T00:00:00Z',
      closed_at: '2026-10-02T02:00:00Z',
      sla_minutes: 60,
    };
    const onTrack = {
      id: '2',
      status: 'open',
      created_at: '2026-10-06T06:00:00Z',
      sla_minutes: 180,
    };
    const now = new Date('2026-10-06T07:00:00Z');
    expect(isItsmSlaBreached(breached, now)).toBe(true);
    expect(isItsmSlaBreached(onTrack, now)).toBe(false);
    expect(countItsmSlaBreached([breached, onTrack], now)).toBe(1);
  });
});

describe('getRequestTypeShort', () => {
  it('compacts Incident and Service Request', () => {
    expect(getRequestTypeShort('Incident')).toBe('IC');
    expect(getRequestTypeShort('Service Request')).toBe('SR');
  });
});

describe('itsmExpandTiles', () => {
  it('includes description and category in expand', () => {
    const tiles = itsmExpandTiles({
      id: '1',
      subject: 'VPN',
      description: 'Cannot connect',
      category: 'Network',
      sub_category: 'VPN',
      criticality: 'High',
    });
    expect(tiles.map((t) => t.label)).toEqual([
      'Subject',
      'Description',
      'Requester Name',
      'Category',
      'Sub Category',
      'Laptop',
      'Criticality',
      'Company',
      'Entity',
      'Stage',
    ]);
    expect(tiles.find((t) => t.label === 'Description')?.value).toBe('Cannot connect');
    expect(tiles.find((t) => t.label === 'Subject')?.value).toBe('VPN');
    expect(tiles.find((t) => t.label === 'Laptop')?.value).toBe('');
  });

  it('shows laptop name with model on laptop issues', () => {
    const tiles = itsmExpandTiles({
      id: '2',
      category: 'Hardware Incident',
      sub_category: 'Laptop',
      laptop_name: 'GM-LT-12',
      laptop_model: 'Lenovo Ideapad slim 3',
      laptop_label: 'GM-LT-12 · Lenovo Ideapad slim 3',
    });
    expect(tiles.find((t) => t.label === 'Laptop')?.value).toBe('GM-LT-12 · Lenovo Ideapad slim 3');
  });
});

describe('itsmClosedByDisplay', () => {
  it('uses Head My Team fallback: solver, then human assignee', () => {
    expect(itsmClosedByDisplay({
      id: '1',
      status: 'closed',
      assigned_to: 'IT Agents Extrovis',
      closed_by: 'Sakthivel',
    })).toBe('Sakthivel');
    expect(itsmClosedByDisplay({
      id: '2',
      status: 'closed',
      assigned_to: 'Deepan Duraisamy',
      closed_by: 'ITSM Bot',
    })).toBe('Deepan Duraisamy');
    expect(itsmClosedByDisplay({
      id: '3',
      status: 'open',
      assigned_to: 'Deepan Duraisamy',
      closed_by: '',
    })).toBe('');
    expect(itsmClosedByDisplay({
      id: '4',
      status: 'open',
      assigned_to: 'Deepan Duraisamy',
      closed_by: 'Sakthivel',
      form_status: 'InProgress',
    })).toBe('');
  });
});

describe('itsmRecordCellText', () => {
  it('hides bot closers and maps stage', () => {
    expect(itsmRecordCellText({ id: '1', form_status: 'Completed' }, 'form_status')).toBe('Closed');
    expect(itsmRecordCellText({ id: '2', closed_by: 'ITSM Bot' }, 'closed_by')).toBe('—');
    expect(itsmRecordCellText({ id: '3', assigned_to: 'ITSM Bot', closed_by: 'Sakthivel' }, 'assigned_to')).toBe('Sakthivel');
  });
});
