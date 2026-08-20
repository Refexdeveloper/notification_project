import { describe, expect, it } from 'vitest';
import {
  defaultEntityFilterForProcess,
  formatEntityFilterLabel,
  isTravelApp,
  isTravelProcess,
  preferredTravelProcessId,
} from './processLabels';

describe('processLabels travel usage', () => {
  it('defaults travel process entity filter to Venwind (test this entity first)', () => {
    expect(defaultEntityFilterForProcess('Travel_Management_A02')).toBe('Venwind');
    expect(defaultEntityFilterForProcess('Advance_Payment_Request_Process_A01')).toBe('Venwind');
    expect(defaultEntityFilterForProcess('Expense_Management_A03')).toBe('Venwind');
    expect(defaultEntityFilterForProcess('Live_IT_Service_Request_A00')).toBe('Refex');
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
});
