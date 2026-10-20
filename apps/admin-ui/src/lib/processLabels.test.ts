import { describe, expect, it } from 'vitest';
import {
  defaultEntityFilterForProcess,
  formatEntityFilterLabel,
  friendlyApplicationName,
  isHiddenNeApplication,
  isItsmApp,
  entityFilterForTemplate,
  isExpenseApp,
  isTravelApp,
  isTravelProcess,
  preferredTravelProcessId,
} from './processLabels';

describe('processLabels travel usage', () => {
  it('defaults travel process entity filter to Venwind (test this entity first)', () => {
    expect(defaultEntityFilterForProcess('Travel_Management_A02')).toBe('Venwind');
    expect(defaultEntityFilterForProcess('Advance_Payment_Request_Process_A01')).toBe('Venwind');
    expect(defaultEntityFilterForProcess('Expense_Management_A03')).toBe('Venwind');
    expect(defaultEntityFilterForProcess('Live_IT_Service_Request_A00')).toBe('all');
  });

  it('detects the Travel Management app without matching Expense EMS', () => {
    expect(isTravelApp('Expense_and_Travel_Management_A00', 'Travel Management')).toBe(true);
    expect(isTravelApp('EMS_001_A00', 'Expense Management System')).toBe(false);
    expect(isTravelProcess('Travel_Management_A02')).toBe(true);
    expect(isTravelProcess('Advance_Payment_Request_Process_A01')).toBe(true);
    expect(isTravelProcess('Expense_Management_A03')).toBe(true);
    expect(isTravelProcess('Travel_Expense_A00')).toBe(false);
  });

  it('prefers Travel_Management_A02 among registered app processes', () => {
    expect(
      preferredTravelProcessId([
        'Advance_Payment_Request_Process_A01',
        'Expense_Management_A03',
        'Travel_Management_A02',
      ]),
    ).toBe('Travel_Management_A02');
  });

  it('labels leftover both-entity schedules as Venwind default', () => {
    expect(formatEntityFilterLabel('both')).toContain('Venwind');
  });

  it('keeps Expense separate from Travel and routes RIL_RMC templates', () => {
    expect(isExpenseApp('EMS_001_A00', 'Expense Management System')).toBe(true);
    expect(isExpenseApp('Expense_and_Travel_Management_A00', 'Travel Management')).toBe(false);
    expect(entityFilterForTemplate({ name: 'Expense Management · RIL_RMC' }, 'Travel_Expense_A00')).toBe('RIL_RMC');
    expect(entityFilterForTemplate({ name: 'Expense Management report' }, 'Travel_Expense_A00')).toBe('');
    expect(entityFilterForTemplate({ name: 'Travel · RIL_RMC entity report' }, 'Travel_Management_A02')).toBe('RIL_RMC');
    expect(entityFilterForTemplate({ name: 'RMC - Lead Management - Report' }, 'Lead_tracker_1_A00')).toBe('RIL_RMC');
    expect(entityFilterForTemplate({ name: 'Lead Tracker · Modepro website report' }, 'Lead_tracker_1_A00')).toBe('');
  });
});

describe('Tech Helpdesk display name', () => {
  it('renames IT Service Management by Kissflow id and by label', () => {
    expect(friendlyApplicationName('IT_Service_Management_A00', 'IT Service Management')).toBe(
      'Tech Helpdesk',
    );
    expect(friendlyApplicationName('', 'IT Service Management')).toBe('Tech Helpdesk');
    expect(friendlyApplicationName('Lead_Trcaker_A00', 'Lead Tracker')).toBe('Lead Tracker');
    expect(isItsmApp('IT_Service_Management_A00', 'Tech Helpdesk')).toBe(true);
  });

  it('hides the duplicate Lead Tracker Venwind app', () => {
    expect(isHiddenNeApplication('Vindview_Sales_Management_A00', 'Lead Tracker Venwind')).toBe(true);
    expect(isHiddenNeApplication('Lead_Trcaker_A00', 'Lead Tracker')).toBe(false);
  });
});
