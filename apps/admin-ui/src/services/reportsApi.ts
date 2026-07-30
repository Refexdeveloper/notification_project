import type { KissflowApplication } from '@/mocks/applications';
import { resolveBackendApplicationId } from '@/services/applicationsApi';
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
  subject?: string | null;
  description?: string | null;
  html?: string;
  variables?: string[];
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
  cc?: string[];
  from_email?: string | null;
  website_filter?: string | null;
  user_group_filter?: string | null;
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
    description: row.description || row.content_ref || 'PostgreSQL report template',
    subject: row.subject || row.name,
    html: row.html || '',
    status: row.status,
    variables: row.variables || [],
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
    cc: row.cc || [],
    fromEmail: row.from_email || '',
    websiteFilter: row.website_filter || undefined,
    userGroupFilter: row.user_group_filter || undefined,
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
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates?environment=${encodeURIComponent(environment)}`;
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
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/schedules?environment=${encodeURIComponent(environment)}`;
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

export type ScheduleUpdatePayload = {
  from_email?: string;
  recipients_to?: string[];
  recipients_cc?: string[];
  is_active?: boolean;
};

export type ScheduleUpdateResult = {
  ok: boolean;
  schedule?: ReportScheduler;
  error?: string;
};

export type TemplateMutationPayload = {
  name?: string;
  subject?: string;
  description?: string;
  html?: string;
  status?: 'draft' | 'published';
};

export type TemplateMutationResult = {
  ok: boolean;
  template?: ReportTemplate;
  error?: string;
};

export async function loadTemplateFromBackend(
  app: KissflowApplication,
  templateId: string,
): Promise<TemplateMutationResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/${encodeURIComponent(templateId)}?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ item: BackendTemplateRow }>(path);

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to load template' };
  }

  return { ok: true, template: mapTemplateRow(res.data.item, app) };
}

export async function createTemplateOnBackend(
  app: KissflowApplication,
  payload: Required<Pick<TemplateMutationPayload, 'name'>> & TemplateMutationPayload,
): Promise<TemplateMutationResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ item: BackendTemplateRow }>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to create template' };
  }

  return { ok: true, template: mapTemplateRow(res.data.item, app) };
}

export async function updateTemplateOnBackend(
  app: KissflowApplication,
  templateId: string,
  payload: TemplateMutationPayload,
): Promise<TemplateMutationResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/${encodeURIComponent(templateId)}?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ item: BackendTemplateRow }>(path, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to update template' };
  }

  return { ok: true, template: mapTemplateRow(res.data.item, app) };
}

export async function deleteTemplateOnBackend(
  app: KissflowApplication,
  templateId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/${encodeURIComponent(templateId)}?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ deleted: boolean }>(path, { method: 'DELETE' });

  if (!res.ok) {
    return { ok: false, error: res.error || 'Failed to delete template' };
  }

  return { ok: true };
}

export async function updateScheduleOnBackend(
  app: KissflowApplication,
  scheduleId: string,
  payload: ScheduleUpdatePayload,
): Promise<ScheduleUpdateResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/schedules/${encodeURIComponent(scheduleId)}?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ item: BackendScheduleRow }>(path, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to update schedule' };
  }

  return {
    ok: true,
    schedule: mapScheduleRow(res.data.item, app),
  };
}
