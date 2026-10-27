import { describe, expect, it } from 'vitest';
import { kissflowCeoDashboardUrl } from './ceoDashboardUrls';

describe('kissflowCeoDashboardUrl', () => {
  it('returns the hosted CEO URL for the four Kissflow dashboards', () => {
    expect(kissflowCeoDashboardUrl('IT_Service_Management_A00')).toBe(
      'https://refex-ceo-dashboards-dhwffeu7pq-el.a.run.app/techhelpdesk',
    );
    expect(kissflowCeoDashboardUrl('production-Expense_and_Travel_Management_A00')).toBe(
      'https://refex-ceo-dashboards-dhwffeu7pq-el.a.run.app/travel',
    );
    expect(kissflowCeoDashboardUrl('EMS_001_A00')).toBe(
      'https://refex-ceo-dashboards-dhwffeu7pq-el.a.run.app/expense',
    );
    expect(kissflowCeoDashboardUrl('Solar_Site_Expense_Governance_Syst_A00')).toBe(
      'https://refex-ceo-dashboards-dhwffeu7pq-el.a.run.app/solar',
    );
  });

  it('leaves other applications without a CEO component URL', () => {
    expect(kissflowCeoDashboardUrl('Lead_Trcaker_A00')).toBe('');
    expect(kissflowCeoDashboardUrl('Project_Management_Tracker_A00')).toBe('');
  });
});
