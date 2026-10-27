/** Stable Kissflow component URLs. Redeploy the host; do not change these paths. */
export const CEO_DASHBOARD_HOST = 'https://refex-ceo-dashboards-dhwffeu7pq-el.a.run.app';

const CEO_DASHBOARD_PATH_BY_APP: Record<string, string> = {
  IT_Service_Management_A00: '/techhelpdesk',
  Expense_and_Travel_Management_A00: '/travel',
  EMS_001_A00: '/expense',
  Solar_Site_Expense_Governance_Syst_A00: '/solar',
};

export function kissflowCeoDashboardUrl(applicationId?: string | null): string {
  const id = String(applicationId || '').trim().replace(/^(production|development)-/i, '');
  const path = CEO_DASHBOARD_PATH_BY_APP[id];
  return path ? `${CEO_DASHBOARD_HOST}${path}` : '';
}
