/**
 * Refex Kissflow application + process catalog for Notification Engine seeding.
 * Credentials come from Vite env (client/.env.local) — never commit secrets.
 */

export type RefexEnvironment = 'Development' | 'Production';

export interface RefexAppDefinition {
  /** Stable localStorage id prefix (env suffix appended) */
  slug: string;
  applicationName: string;
  kissflowAppId: string;
  processName: string;
  processId: string;
  /** Remix Icon class, e.g. ri-sun-line */
  icon: string;
  /** Soft tile background + icon color */
  tint: string;
}

export const REFEX_ENV_CONFIG: Record<
  RefexEnvironment,
  {
    accountId: string;
    subdomain: string;
    accessKeyId: string;
    accessKeySecret: string;
  }
> = {
  Development: {
    accountId:
      (import.meta.env.VITE_KISSFLOW_DEV_ACCOUNT_ID as string | undefined)?.trim() ||
      'AcCMptp3yqcn',
    subdomain: 'development-refexgroup',
    accessKeyId:
      (import.meta.env.VITE_KISSFLOW_DEV_ACCESS_KEY_ID as string | undefined)?.trim() ||
      '',
    accessKeySecret:
      (import.meta.env.VITE_KISSFLOW_DEV_ACCESS_KEY_SECRET as string | undefined)?.trim() ||
      '',
  },
  Production: {
    accountId:
      (import.meta.env.VITE_KISSFLOW_PROD_ACCOUNT_ID as string | undefined)?.trim() ||
      'AcCMptlq60zH',
    subdomain: 'refexgroup',
    accessKeyId:
      (import.meta.env.VITE_KISSFLOW_PROD_ACCESS_KEY_ID as string | undefined)?.trim() ||
      '',
    accessKeySecret:
      (import.meta.env.VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET as string | undefined)?.trim() ||
      '',
  },
};

/** @deprecated use REFEX_ENV_CONFIG.Development.accountId */
export const REFEX_ACCOUNT_ID = REFEX_ENV_CONFIG.Development.accountId;

/** All Refex apps to register in Notification Engine */
export const REFEX_APP_CATALOG: RefexAppDefinition[] = [
  {
    slug: 'pmt',
    applicationName: 'Project Management Tracker',
    kissflowAppId: 'Project_Management_Tracker_A00',
    processName: 'Project Task',
    processId: 'Project_Sub_Task_A01',
    icon: 'ri-list-check-3',
    tint: 'bg-[#E8F3FC] text-[#0F6CBD]',
  },
  {
    slug: 'lead-tracker',
    applicationName: 'Lead Tracker',
    kissflowAppId: 'Lead_Trcaker_A00',
    processName: 'Lead Tracker Process',
    processId: 'Lead_tracker_1_A00',
    icon: 'ri-user-search-line',
    tint: 'bg-[#FFF4ED] text-[#EA580C]',
  },
  {
    slug: 'solar',
    applicationName: 'Solar Expense Hub',
    kissflowAppId: 'Solar_Site_Expense_Governance_Syst_A00',
    processName: 'Reinvestment Request',
    processId: 'Technician_Reimbursement__YTLM',
    icon: 'ri-sun-line',
    tint: 'bg-[#FFF7E6] text-[#D97706]',
  },
  {
    slug: 'itsm',
    applicationName: 'IT Service Management',
    kissflowAppId: 'IT_Service_Management_A00',
    processName: 'Live IT Service Request',
    processId: 'Live_IT_Service_Request_A00',
    icon: 'ri-customer-service-2-line',
    tint: 'bg-[#EDE9FE] text-[#7C3AED]',
  },
  {
    slug: 'travel',
    applicationName: 'Travel Management',
    kissflowAppId: 'Expense_and_Travel_Management_A00',
    processName: 'Travel Request-Refex',
    processId: 'Copy_of_Venwind_Travel_Request_A00',
    icon: 'ri-plane-line',
    tint: 'bg-[#E0F2FE] text-[#0284C7]',
  },
  {
    slug: 'p2p',
    applicationName: 'P2P',
    kissflowAppId: 'refex_new_test_A00',
    processName: 'P2P -One',
    processId: 'P2P_One_A00',
    icon: 'ri-swap-line',
    tint: 'bg-[#ECFDF5] text-[#059669]',
  },
  {
    slug: 'ems',
    applicationName: 'Expense Management System',
    kissflowAppId: 'EMS_001_A00',
    processName: 'Expense Request',
    processId: 'Travel_Expense_A00',
    icon: 'ri-wallet-3-line',
    tint: 'bg-[#FDF2F8] text-[#DB2777]',
  },
];

/** Legacy ITSM Development id — kept for existing templates/schedulers */
export const REFEX_ITSM_DEV_APP_ID = 'app-refex-itsm';

export function appStorageId(slug: string, env: RefexEnvironment): string {
  if (slug === 'itsm' && env === 'Development') return REFEX_ITSM_DEV_APP_ID;
  return `app-refex-${slug}-${env === 'Development' ? 'dev' : 'prod'}`;
}

export function catalogEntryForApp(app: {
  appId?: string;
  processIds?: string[];
  icon?: string;
}): RefexAppDefinition | undefined {
  const processId = app.processIds?.[0] || app.appId;
  return (
    REFEX_APP_CATALOG.find((d) => d.processId === processId) ||
    REFEX_APP_CATALOG.find((d) => d.kissflowAppId === app.appId) ||
    REFEX_APP_CATALOG.find((d) => d.icon === app.icon)
  );
}
