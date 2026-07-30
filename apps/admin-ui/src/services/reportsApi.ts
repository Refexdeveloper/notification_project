import type { KissflowApplication } from '@/mocks/applications';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import type { ReportTemplate } from '@/stores/reportTemplates';
import { describeCadence } from '@/stores/reportSchedulers';
import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type BackendTemplateRow = {
  id: string;
  name: string;
  application_id: string | null;
  version_number: number;
  content_ref: string | null;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
};

export type TemplatesListResponse = {
  items: BackendTemplateRow[];
  count: number;
  environment?: string;
  application_id?: string;
  warning?: string;
  hint?: string;
};

export type BackendScheduleRow = {
  id: string;
  name: string;
  application_id: string | null;
  template_id: string | null;
  template_name: string | null;
  cron_expression: string;
  timezone: string;
  is_active: boolean;
  status: 'active' | 'paused';
  recipients: string[];
  created_at: string;
};

export type SchedulesListResponse = {
  items: BackendScheduleRow[];
  count: number;
  environment?: string;
  application_id?: string;
  warning?: string;
  hint?: string;
};

function toDbEnvironment(environment: KissflowApplication['environment']): string {
  return environment === 'Production' ? 'production' : 'development';
}

function mapTemplateRow(row: BackendTemplateRow, app: KissflowApplication): ReportTemplate {
  return {
    id: row.id,
    applicationId: app.id,
    name: row.name,
    description: row.content_ref || 'PostgreSQL report template',
    subject: row.name,
    html: '',
    status: row.status,
    variables: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: 'engagement_reporting',
  };
}

function mapScheduleRow(row: BackendScheduleRow, app: KissflowApplication): ReportScheduler {
  return {
    id: row.id,
    applicationId: app.id,
    name: row.name,
    description: `${row.cron_expression} (${row.timezone})`,
    status: row.status,
    templateId: row.template_id || '',
    templateName: row.template_name || '—',
    cadence: { type: 'cron', cronExpression: row.cron_expression },
    recipients: row.recipients,
    cc: [],
    lastRunAt: null,
    nextRunAt: null,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

export type TemplatesLoadResult = {
  templates: ReportTemplate[];
  warning?: string;
  error?: string;
};

export type SchedulesLoadResult = {
  schedulers: ReportScheduler[];
  warning?: string;
  error?: string;
};

export async function loadTemplatesFromBackend(app: KissflowApplication): Promise<TemplatesLoadResult> {
  if (!isBackendApiMode()) {
    return { templates: [] };
  }

  const environment = toDbEnvironment(app.environment);
  const path = `/applications/${encodeURIComponent(app.appId)}/templates?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<TemplatesListResponse>(path);

  if (!res.ok || !res.data) {
    return { templates: [], error: res.error || 'Failed to load templates' };
  }

  return {
    templates: res.data.items.map((row) => mapTemplateRow(row, app)),
    warning: res.data.warning || res.data.hint,
  };
}

export async function loadSchedulesFromBackend(app: KissflowApplication): Promise<SchedulesLoadResult> {
  if (!isBackendApiMode()) {
    return { schedulers: [] };
  }

  const environment = toDbEnvironment(app.environment);
  const path = `/applications/${encodeURIComponent(app.appId)}/schedules?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<SchedulesListResponse>(path);

  if (!res.ok || !res.data) {
    return { schedulers: [], error: res.error || 'Failed to load schedules' };
  }

  return {
    schedulers: res.data.items.map((row) => mapScheduleRow(row, app)),
    warning: res.data.warning || res.data.hint,
  };
}

export function describeBackendSchedule(sch: ReportScheduler): string {
  if (sch.cadence.type === 'cron' && sch.cadence.cronExpression) {
    return sch.cadence.cronExpression;
  }
  return describeCadence(sch.cadence);
}
