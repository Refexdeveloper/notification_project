export interface SchedulerTrigger {
  id: string;
  type: 'before_due_date' | 'after_due_date' | 'status_changed' | 'field_changed' | 'on_create' | 'on_update' | 'on_submit';
  label: string;
  config: {
    days?: number;
    hours?: number;
    status?: string;
    fieldName?: string;
    fieldValue?: string;
  };
  enabled: boolean;
}

export interface SchedulerRecipient {
  type: 'initiator' | 'approver' | 'manager' | 'role' | 'email';
  label: string;
  value: string;
}

export interface Scheduler {
  id: string;
  dataformId: string;
  dataformName: string;
  appId: string;
  appName: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'draft';
  frequency: {
    type: 'cron' | 'interval' | 'daily' | 'weekly' | 'monthly';
    cronExpression?: string;
    intervalMinutes?: number;
    dailyTimes?: string[];
    weeklyDays?: number[];
    weeklyTimes?: string[];
    monthlyDay?: number;
    monthlyTimes?: string[];
  };
  triggers: SchedulerTrigger[];
  templateId: string;
  templateName: string;
  recipients: SchedulerRecipient[];
  lastExecuted: string | null;
  nextExecution: string | null;
  executionCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export const triggerTypeOptions = [
  { type: 'before_due_date' as const, label: 'Before Due Date', icon: 'ri-timer-flash-line', description: 'Fire N days/hours before the due date' },
  { type: 'after_due_date' as const, label: 'After Due Date', icon: 'ri-alarm-warning-line', description: 'Fire N days/hours after the due date' },
  { type: 'status_changed' as const, label: 'Status Changed', icon: 'ri-flag-line', description: 'Fire when status transitions to a specific value' },
  { type: 'field_changed' as const, label: 'Field Changed', icon: 'ri-edit-line', description: 'Fire when a specific field value changes' },
  { type: 'on_create' as const, label: 'On Create', icon: 'ri-add-circle-line', description: 'Fire immediately when a new record is created' },
  { type: 'on_update' as const, label: 'On Update', icon: 'ri-refresh-line', description: 'Fire whenever the record is updated' },
  { type: 'on_submit' as const, label: 'On Submit', icon: 'ri-send-plane-line', description: 'Fire when the form is submitted' },
];

export const cronPresets = [
  { label: 'Every 15 minutes', value: '*/15 * * * *', description: 'Runs every 15 minutes, 24/7' },
  { label: 'Every hour', value: '0 * * * *', description: 'Runs at the top of every hour' },
  { label: 'Every 6 hours', value: '0 */6 * * *', description: 'Runs at 00:00, 06:00, 12:00, 18:00' },
  { label: 'Daily at 8 AM', value: '0 8 * * *', description: 'Runs every day at 8:00 AM' },
  { label: 'Daily at 5 PM', value: '0 17 * * *', description: 'Runs every day at 5:00 PM' },
  { label: 'Weekdays at 9 AM', value: '0 9 * * 1-5', description: 'Mon-Fri at 9:00 AM' },
  { label: 'Weekly on Monday', value: '0 9 * * 1', description: 'Every Monday at 9:00 AM' },
  { label: 'Monthly on 1st', value: '0 8 1 * *', description: 'First day of every month at 8:00 AM' },
  { label: 'Monthly on 15th', value: '0 10 15 * *', description: '15th of every month at 10:00 AM' },
  { label: 'Every Monday & Thursday', value: '0 7 * * 1,4', description: 'Mon & Thu at 7:00 AM' },
  { label: 'Custom', value: '', description: 'Enter your own cron expression' },
];

/** Live list — no seed schedules. */
export const schedulers: Scheduler[] = [];

export const getSchedulers = (): Scheduler[] => schedulers;

export const getSchedulerById = (id: string): Scheduler | undefined =>
  schedulers.find((s) => s.id === id);

export const getSchedulersByDataformId = (dataformId: string): Scheduler[] =>
  schedulers.filter((s) => s.dataformId === dataformId);
