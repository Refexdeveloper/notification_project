/** Friendly labels for registered Kissflow process IDs. */
export function processLabel(processId: string): string {
  const pid = (processId || '').trim();
  if (!pid) return '';
  if (/extrovis/i.test(pid)) return `${pid} · Extrovis only (no Refex users)`;
  if (pid === 'Live_IT_Service_Request_A00') return `${pid} · Refex ITSM`;
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

/** Default entity filter for a schedule based on process. */
export function defaultEntityFilterForProcess(processId: string): string {
  if (isExtrovisProcess(processId)) return 'all';
  if (processId === 'Live_IT_Service_Request_A00') return 'Refex';
  return '';
}
