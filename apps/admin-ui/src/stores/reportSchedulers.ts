/** Per-app report schedulers: template + cadence + recipients (localStorage). */

export type SchedulerStatus = 'active' | 'paused' | 'draft';

export type CadenceType = 'daily' | 'weekly' | 'monthly' | 'cron';

export interface ReportScheduler {
  id: string;
  applicationId: string;
  name: string;
  description: string;
  status: SchedulerStatus;
  /** Published (or draft) template to send */
  templateId: string;
  templateName: string;
  cadence: {
    type: CadenceType;
    /** HH:mm local */
    time?: string;
    /** 0=Sun … 6=Sat for weekly */
    weekday?: number;
    /** 1–28 for monthly */
    monthDay?: number;
    cronExpression?: string;
  };
  /** Email addresses */
  recipients: string[];
  /** Optional CC */
  cc: string[];
  /** Sender address for scheduled reports (backend / PostgreSQL mode) */
  fromEmail?: string;
  /** IANA timezone for backend schedules (e.g. Asia/Kolkata) */
  timezone?: string;
  /** Lead Tracker: filter leads by Website field value before grouping by sales person */
  websiteFilter?: string;
  /** Lead Tracker: filter Kissflow users by Groups membership */
  userGroupFilter?: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'ne_report_schedulers';

function readStore(): ReportScheduler[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReportScheduler[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(list: ReportScheduler[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getSchedulers(): ReportScheduler[] {
  return readStore().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSchedulersByAppId(applicationId: string): ReportScheduler[] {
  return getSchedulers().filter((s) => s.applicationId === applicationId);
}

export function getSchedulerById(id: string): ReportScheduler | undefined {
  return getSchedulers().find((s) => s.id === id);
}

export function describeCadence(c: ReportScheduler['cadence']): string {
  const time = c.time || '09:00';
  if (c.type === 'daily') return `Daily at ${time}`;
  if (c.type === 'weekly') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Weekly ${days[c.weekday ?? 1]} at ${time}`;
  }
  if (c.type === 'monthly') return `Monthly on day ${c.monthDay || 1} at ${time}`;
  return c.cronExpression || 'Custom cron';
}

export function computeNextRun(c: ReportScheduler['cadence']): string {
  const now = new Date();
  const [hh, mm] = (c.time || '09:00').split(':').map((n) => Number(n) || 0);
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hh, mm, 0, 0);

  if (c.type === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  if (c.type === 'weekly') {
    const target = c.weekday ?? 1;
    const cur = next.getDay();
    let add = (target - cur + 7) % 7;
    if (add === 0 && next <= now) add = 7;
    next.setDate(next.getDate() + add);
    return next.toISOString();
  }
  if (c.type === 'monthly') {
    const day = Math.min(c.monthDay || 1, 28);
    next.setDate(day);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    next.setDate(Math.min(day, 28));
    return next.toISOString();
  }
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export interface CreateSchedulerInput {
  applicationId: string;
  name: string;
  description?: string;
  templateId: string;
  templateName: string;
  cadence?: ReportScheduler['cadence'];
  recipients?: string[];
  cc?: string[];
  status?: SchedulerStatus;
}

export function createScheduler(input: CreateSchedulerInput): ReportScheduler {
  const now = new Date().toISOString();
  const cadence = input.cadence || { type: 'daily' as const, time: '09:00' };
  const sch: ReportScheduler = {
    id: `sch-${Date.now()}`,
    applicationId: input.applicationId,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    status: input.status || 'draft',
    templateId: input.templateId,
    templateName: input.templateName,
    cadence,
    recipients: input.recipients || [],
    cc: input.cc || [],
    lastRunAt: null,
    nextRunAt: computeNextRun(cadence),
    createdAt: now,
    updatedAt: now,
  };
  const list = getSchedulers();
  list.unshift(sch);
  writeStore(list);
  return sch;
}

export function updateScheduler(
  id: string,
  patch: Partial<
    Pick<
      ReportScheduler,
      | 'name'
      | 'description'
      | 'status'
      | 'templateId'
      | 'templateName'
      | 'cadence'
      | 'recipients'
      | 'cc'
      | 'websiteFilter'
      | 'userGroupFilter'
    >
  >,
): ReportScheduler | undefined {
  const list = getSchedulers();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return undefined;
  const cadence = patch.cadence || list[idx].cadence;
  const next: ReportScheduler = {
    ...list[idx],
    ...patch,
    cadence,
    nextRunAt: computeNextRun(cadence),
    updatedAt: new Date().toISOString(),
  };
  list[idx] = next;
  writeStore(list);
  return next;
}

export function deleteScheduler(id: string) {
  writeStore(getSchedulers().filter((s) => s.id !== id));
}

export function parseEmailList(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}
