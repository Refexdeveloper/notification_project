import { describe, expect, it } from 'vitest';
import { iconForNeKpi, resolveNeAppKind } from './neKpiIcons';
import {
  Ban,
  CalendarPlus,
  FolderKanban,
  Inbox,
  ListChecks,
  Plane,
  Receipt,
  ShoppingCart,
  Sun,
  Target,
  Ticket,
} from 'lucide-react';

describe('resolveNeAppKind', () => {
  it('maps each production app id', () => {
    expect(resolveNeAppKind('IT_Service_Management_A00', 'IT Helpdesk')).toBe('itsm');
    expect(resolveNeAppKind('Project_Management_Tracker_A00', 'Project Management')).toBe('pm');
    expect(resolveNeAppKind('Procurement_to_Pay_A00', 'Procurement to Pay')).toBe('p2p');
    expect(resolveNeAppKind('Expense_and_Travel_Management_A00', 'Travel')).toBe('travel');
    expect(resolveNeAppKind('Solar_Site_Expense_Governance_Syst_A00', 'Solar')).toBe('solar');
    expect(resolveNeAppKind('Lead_Trcaker_A00', 'Lead Tracker')).toBe('lead');
    expect(resolveNeAppKind('EMS_001_A00', 'Expense Management')).toBe('expense');
  });
});

describe('iconForNeKpi', () => {
  it('uses project-specific total / open / today icons', () => {
    expect(iconForNeKpi('itsm', 'Total tickets', 0)).toBe(Ticket);
    expect(iconForNeKpi('itsm', 'Open tickets', 1)).toBe(Inbox);
    expect(iconForNeKpi('itsm', 'Opened today', 0)).toBe(CalendarPlus);
    expect(iconForNeKpi('pm', 'Total projects', 0)).toBe(FolderKanban);
    expect(iconForNeKpi('pm', 'All tasks Total tasks', 0)).toBe(ListChecks);
    expect(iconForNeKpi('p2p', 'Purchase orders Total POs', 0)).toBe(ShoppingCart);
    expect(iconForNeKpi('p2p', 'Purchase orders Rejected POs', 3)).toBe(Ban);
    expect(iconForNeKpi('travel', 'Total items', 0)).toBe(Plane);
    expect(iconForNeKpi('solar', 'Total items', 0)).toBe(Sun);
    expect(iconForNeKpi('lead', 'Total items', 0)).toBe(Target);
    expect(iconForNeKpi('expense', 'Total items', 0)).toBe(Receipt);
  });
});
