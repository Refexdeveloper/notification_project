import { describe, expect, it } from 'vitest';
import {
  defaultEntityFilterForProcess,
  formatEntityFilterLabel,
  isTravelApp,
  isTravelProcess,
} from './processLabels';

describe('processLabels travel usage', () => {
  it('defaults travel process entity filter to both (separate sections)', () => {
    expect(defaultEntityFilterForProcess('Copy_of_Venwind_Travel_Request_A00')).toBe('both');
    expect(defaultEntityFilterForProcess('Live_IT_Service_Request_A00')).toBe('Refex');
  });

  it('detects the Travel Management app without matching Expense', () => {
    expect(isTravelApp('Expense_and_Travel_Management_A00', 'Travel Management')).toBe(true);
    expect(isTravelApp('EMS_001_A00', 'Expense Management System')).toBe(false);
    expect(isTravelProcess('Copy_of_Venwind_Travel_Request_A00')).toBe(true);
    expect(isTravelProcess('Travel_Expense_A00')).toBe(false);
  });

  it('labels both-entity travel reports as separate', () => {
    expect(formatEntityFilterLabel('both')).toBe('Refex + Venwind (separate)');
  });
});
