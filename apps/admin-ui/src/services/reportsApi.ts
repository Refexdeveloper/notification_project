import type { KissflowApplication } from '@/mocks/applications';
import { resolveBackendApplicationId, toDbEnvironment } from '@/services/applicationsApi';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import type { ReportTemplate } from '@/stores/reportTemplates';
import {
  cadenceStateToReportCadence,
  cronToCadenceState,
  describeScheduleCadence,
  DEFAULT_TIMEZONE,
} from '@/services/scheduleCadence';
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
  process_id?: string | null;
  template_id: string | null;
  template_name: string | null;
  subject?: string | null;
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
  const timezone = row.timezone || DEFAULT_TIMEZONE;
  const cadenceState = cronToCadenceState(row.cron_expression, timezone);
  return {
    id: row.id,
    applicationId: app.id,
    name: row.name,
    description: describeScheduleCadence(cadenceState),
    status: row.status,
    templateId: row.template_id || '',
    templateName: row.template_name || '—',
    processId: row.process_id || undefined,
    subject: row.subject || undefined,
    cadence: {
      ...cadenceStateToReportCadence(cadenceState),
      cronExpression: row.cron_expression,
    },
    timezone,
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
  if (sch.description) return sch.description;
  const cron = sch.cadence.cronExpression || '0 9 * * *';
  return describeScheduleCadence(cronToCadenceState(cron, sch.timezone || DEFAULT_TIMEZONE));
}

export type ScheduleUpdatePayload = {
  from_email?: string;
  recipients_to?: string[];
  recipients_cc?: string[];
  is_active?: boolean;
  cron_expression?: string;
  timezone?: string;
  template_id?: string;
  template_name?: string;
  process_id?: string;
  website_filter?: string;
  user_group_filter?: string;
  subject?: string;
};

export type CloudSchedulerSyncResult = {
  ok: boolean;
  job_name?: string;
  action?: string;
  state?: string;
  schedule?: string;
  timezone?: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
};

export type FromEmailAuthResult = {
  valid: boolean;
  authorized: boolean | null;
  message: string;
  smtp_user?: string | null;
};

export type ScheduleUpdateResult = {
  ok: boolean;
  schedule?: ReportScheduler;
  error?: string;
  cloudScheduler?: CloudSchedulerSyncResult;
  fromEmailAuth?: FromEmailAuthResult;
};

export type ScheduleCreatePayload = {
  name: string;
  template_id: string;
  template_name?: string;
  cron_expression?: string;
  timezone?: string;
  from_email?: string;
  recipients_to?: string[];
  recipients_cc?: string[];
  is_active?: boolean;
  process_id?: string;
  subject?: string;
  website_filter?: string;
  user_group_filter?: string;
};

export type ScheduleCreateResult = {
  ok: boolean;
  schedule?: ReportScheduler;
  error?: string;
};

export async function createScheduleOnBackend(
  app: KissflowApplication,
  payload: ScheduleCreatePayload,
): Promise<ScheduleCreateResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/schedules?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ item: BackendScheduleRow }>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to create schedule' };
  }

  return { ok: true, schedule: mapScheduleRow(res.data.item, app) };
}

export async function deleteScheduleOnBackend(
  app: KissflowApplication,
  scheduleId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/schedules/${encodeURIComponent(scheduleId)}?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ deleted: boolean }>(path, { method: 'DELETE' });

  if (!res.ok) {
    return { ok: false, error: res.error || 'Failed to delete schedule' };
  }

  return { ok: true };
}

export type TemplateMutationPayload = {
  name?: string;
  subject?: string;
  description?: string;
  html?: string;
  status?: 'draft' | 'published';
  /** Ready-made layout id: itsm | pm | lead | simple | blank */
  starter_id?: string;
};

export type ReportStarter = {
  id: string;
  name: string;
  description: string;
  placeholders: string[];
  recommended?: boolean;
  html?: string;
};

export type ReportStartersResult = {
  ok: boolean;
  items?: ReportStarter[];
  error?: string;
};

export async function loadReportStartersFromBackend(
  app: KissflowApplication,
): Promise<ReportStartersResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/starters`;
  const res = await apiV1Fetch<{ items: ReportStarter[] }>(path);

  if (!res.ok) {
    return { ok: false, error: res.error || 'Failed to load starters' };
  }

  return { ok: true, items: res.data?.items || [] };
}

export async function loadReportStarterHtmlFromBackend(
  app: KissflowApplication,
  starterId: string,
): Promise<{ ok: boolean; item?: ReportStarter; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const applicationId = resolveBackendApplicationId(app);
  const appName = encodeURIComponent(app.displayName || app.name || applicationId);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/starters/${encodeURIComponent(starterId)}?app_name=${appName}`;
  const res = await apiV1Fetch<{ item: ReportStarter }>(path);

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to load starter HTML' };
  }

  return { ok: true, item: res.data.item };
}

export type PipelineSyncResult = {
  synced: boolean;
  reason?: string;
  path?: string;
  bytes?: number;
  cache_invalidation?: { deleted?: number; patterns?: string[]; error?: string };
};

export type TemplateMutationResult = {
  ok: boolean;
  template?: ReportTemplate;
  pipelineSync?: PipelineSyncResult;
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

export async function loadTemplateVersionsFromBackend(
  app: KissflowApplication,
  templateId: string,
): Promise<TemplateVersionsLoadResult> {
  if (!isBackendApiMode()) {
    return { ok: false, versions: [], error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/${encodeURIComponent(templateId)}/versions?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{
    items: BackendTemplateVersionRow[];
    current_version?: number;
  }>(path);

  if (!res.ok || !res.data) {
    return { ok: false, versions: [], error: res.error || 'Failed to load version history' };
  }

  return {
    ok: true,
    versions: res.data.items || [],
    currentVersion: res.data.current_version,
  };
}

export async function loadTemplateVersionFromBackend(
  app: KissflowApplication,
  templateId: string,
  versionNumber: number,
): Promise<TemplateVersionLoadResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(String(versionNumber))}?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ item: { version_number: number; html?: string } }>(path);

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to load template version' };
  }

  return {
    ok: true,
    html: res.data.item.html,
    versionNumber: res.data.item.version_number,
  };
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
  const res = await apiV1Fetch<{ item: BackendTemplateRow; pipeline_sync?: PipelineSyncResult }>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to create template' };
  }

  return {
    ok: true,
    template: mapTemplateRow(res.data.item, app),
    pipelineSync: res.data.pipeline_sync,
  };
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
  const res = await apiV1Fetch<{ item: BackendTemplateRow; pipeline_sync?: PipelineSyncResult }>(path, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to update template' };
  }

  return {
    ok: true,
    template: mapTemplateRow(res.data.item, app),
    pipelineSync: res.data.pipeline_sync,
  };
}

export type TemplateScheduleUsage = {
  id: string;
  name: string;
  is_active: boolean;
};

export type BackendTemplateVersionRow = {
  version_number: number;
  checksum: string | null;
  created_at: string;
  is_current?: boolean;
};

export type TemplateVersionsLoadResult = {
  ok: boolean;
  versions: BackendTemplateVersionRow[];
  currentVersion?: number;
  error?: string;
};

export type TemplateVersionLoadResult = {
  ok: boolean;
  html?: string;
  versionNumber?: number;
  error?: string;
};

export type TemplateUsageResult = {
  ok: boolean;
  inUse?: boolean;
  schedules?: TemplateScheduleUsage[];
  error?: string;
};

export async function loadTemplateUsageFromBackend(
  app: KissflowApplication,
  templateId: string,
): Promise<TemplateUsageResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/${encodeURIComponent(templateId)}/usage?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{
    in_use: boolean;
    schedule_count: number;
    schedules: TemplateScheduleUsage[];
  }>(path);

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to check template usage' };
  }

  return {
    ok: true,
    inUse: res.data.in_use,
    schedules: res.data.schedules || [],
  };
}

export async function deleteTemplateOnBackend(
  app: KissflowApplication,
  templateId: string,
): Promise<{ ok: boolean; error?: string; errorCode?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/templates/${encodeURIComponent(templateId)}?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{ deleted: boolean }>(path, { method: 'DELETE' });

  if (!res.ok) {
    return { ok: false, error: res.error || 'Failed to delete template', errorCode: res.errorCode };
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
  const res = await apiV1Fetch<{
    item: BackendScheduleRow;
    cloud_scheduler?: CloudSchedulerSyncResult;
    from_email_auth?: FromEmailAuthResult;
  }>(path, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to update schedule' };
  }

  return {
    ok: true,
    schedule: mapScheduleRow(res.data.item, app),
    cloudScheduler: res.data.cloud_scheduler,
    fromEmailAuth: res.data.from_email_auth,
  };
}

export type ScheduleTestSendResult = {
  ok: boolean;
  dispatched?: boolean;
  logExcerpt?: string;
  message?: string;
  error?: string;
};

export async function testSendScheduleOnBackend(
  app: KissflowApplication,
  scheduleId: string,
  testRecipient: string,
): Promise<ScheduleTestSendResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/schedules/${encodeURIComponent(scheduleId)}/test-send?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<{
    dispatched?: boolean;
    log_excerpt?: string;
    test_recipient?: string;
    message?: string;
    status?: string;
  }>(path, {
    method: 'POST',
    body: JSON.stringify({ test_recipient: testRecipient.trim().toLowerCase() }),
  }, { timeoutMs: 120000 });

  if (!res.ok) {
    return {
      ok: false,
      error: res.error || res.data?.message || 'Test send failed',
      logExcerpt: res.data?.log_excerpt,
    };
  }

  const delivered = res.data?.status === 'delivered';
  return {
    ok: delivered || Boolean(res.data?.dispatched),
    dispatched: Boolean(res.data?.dispatched),
    logExcerpt: res.data?.log_excerpt,
    message: res.data?.message,
    error: delivered ? undefined : res.data?.log_excerpt || 'Test send did not confirm delivery',
  };
}
