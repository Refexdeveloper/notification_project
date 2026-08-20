/** Friendly labels for registered Kissflow process IDs. */

export const TRAVEL_COMBINED_PROCESS_IDS = [
  'Advance_Payment_Request_Process_A01',
  'Expense_Management_A03',
  'Travel_Management_A02',
] as const;

export function processLabel(processId: string): string {
  const pid = (processId || '').trim();
  if (!pid) return '';
  if (/extrovis/i.test(pid)) return `${pid} · Extrovis only (no Refex users)`;
  if (pid === 'Live_IT_Service_Request_A00') return `${pid} · Refex ITSM`;
  if (pid === 'Copy_of_Venwind_Travel_Request_A00') {
    return `${pid} · Travel Request (combined into entity report)`;
  }
  if (pid === 'Travel_Management_A02') {
    return `${pid} · Travel Management (combined with Advance Payment + Expense)`;
  }
  if (pid === 'Advance_Payment_Request_Process_A01') {
    return `${pid} · Advance Payment (combined into Travel entity report)`;
  }
  if (pid === 'Expense_Management_A03') {
    return `${pid} · Expense Management (combined into Travel entity report)`;
  }
  if (pid === 'Project_Sub_Task_A01') return `${pid} · Project Management`;
  if (pid === 'Technician_Reimbursement__YTLM') return `${pid} · Reinvestment Request (Solar)`;
  if (/lead_tracker/i.test(pid)) return `${pid} · Lead Tracker`;
  return pid;
}

export function isExtrovisProcess(processId: string | undefined | null): boolean {
  return /extrovis/i.test(String(processId || ''));
}

export function isItsmApp(appId: string | undefined | null, appName?: string): boolean {
  const id = String(appId || '').toLowerCase();
  const name = String(appName || '').toLowerCase();
  return id.includes('it_service') || id.includes('itsm') || name.includes('it service');
}

export function isTravelApp(appId: string | undefined | null, appName?: string): boolean {
  const id = String(appId || '').toLowerCase();
  const name = String(appName || '').toLowerCase();
  return (
    id.includes('expense_and_travel') ||
    id.includes('venwind_travel') ||
    name.includes('travel management')
  );
}

export function isTravelProcess(processId: string | undefined | null): boolean {
  const pid = String(processId || '');
  if (!pid) return false;
  if ((TRAVEL_COMBINED_PROCESS_IDS as readonly string[]).includes(pid)) return true;
  if (pid === 'Copy_of_Venwind_Travel_Request_A00') return true;
  return /travel_request/i.test(pid) || /travel_management/i.test(pid);
}

export function preferredTravelProcessId(processIds: string[] | undefined | null): string {
  const list = (processIds || []).map((id) => id.trim()).filter(Boolean);
  const preferred = [
    'Travel_Management_A02',
    'Copy_of_Venwind_Travel_Request_A00',
    'Advance_Payment_Request_Process_A01',
    'Expense_Management_A03',
  ];
  return preferred.find((id) => list.includes(id)) || list[0] || '';
}

export function formatEntityFilterLabel(filter: string | undefined | null): string {
  const value = String(filter || '').trim();
  if (!value) return '';
  if (value === 'all') return 'All (process)';
  if (value === 'both') return 'Venwind (default — use a dedicated Refex schedule)';
  return value;
}

/** Default entity filter for a schedule based on process. */
export function defaultEntityFilterForProcess(processId: string): string {
  if (isExtrovisProcess(processId)) return 'all';
  if (processId === 'Live_IT_Service_Request_A00') return 'Refex';
  if (isTravelProcess(processId)) return 'Venwind';
  return '';
}
