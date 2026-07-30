export type ExecutionStatus = 'success' | 'failed' | 'running' | 'queued' | 'retrying';

export interface NotificationExecution {
  id: string;
  appId: string;
  resourceId: string | null;
  resourceName: string;
  schedulerId: string | null;
  schedulerName: string;
  templateId: string;
  templateName: string;
  status: ExecutionStatus;
  recipients: string[];
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  retryCount: number;
}

export interface NotificationHistoryItem {
  id: string;
  appId: string;
  executionId: string;
  subject: string;
  recipient: string;
  channel: 'email' | 'in_app' | 'webhook';
  status: 'delivered' | 'opened' | 'bounced' | 'failed' | 'pending';
  sentAt: string;
  templateName: string;
}

/** Live lists — no seed data. Wire to API later. */
export const executions: NotificationExecution[] = [];
export const historyItems: NotificationHistoryItem[] = [];

export const getExecutionsByAppId = (appId: string) => executions.filter((e) => e.appId === appId);
export const getHistoryByAppId = (appId: string) => historyItems.filter((h) => h.appId === appId);
