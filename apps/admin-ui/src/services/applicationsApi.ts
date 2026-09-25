import type { KissflowApplication } from '@/mocks/applications';
import {
  apiV1Fetch,
  isBackendApiMode,
  type ApplicationsListResponse,
  type BackendApplicationRow,
  type BackendProcessRow,
  type ProcessesListResponse,
} from './backendApi';
import { catalogEntryForApp, REFEX_ENV_CONFIG, type RefexEnvironment } from '@/seeds/refexAppCatalog';
import { friendlyApplicationName, isPmApp } from '@/lib/processLabels';

function mapEnvironment(env: string): RefexEnvironment {
  const lower = env.toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'Production';
  return 'Development';
}

export function toDbEnvironment(env: RefexEnvironment | string): string {
  const lower = String(env).toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'uat') return 'uat';
  if (lower === 'staging') return 'staging';
  return 'development';
}

/** Backend APIs use registered Kissflow application_id (not legacy process id or route id). */
export function resolveBackendApplicationId(app: KissflowApplication): string {
  const appId = (app.appId || '').trim();
  const routeId = (app.id || '').trim();

  const isLeadTracker =
    appId === 'Lead_tracker_1_A00' ||
    appId.includes('Lead_tracker') ||
    appId.includes('Lead_Trcaker') ||
    routeId.includes('lead-tracker') ||
    app.name.toLowerCase().includes('lead tracker');

  if (isLeadTracker) {
    return 'Lead_Trcaker_A00';
  }

  const catalog = catalogEntryForApp({
    appId,
    processIds: app.processIds,
  });
  if (
    isPmApp(appId, app.displayName || app.name) ||
    catalog?.slug === 'pmt' ||
    appId === 'Project_Sub_Task_A01' ||
    appId === 'Sub_Task_Process_A00'
  ) {
    return catalog?.kissflowAppId || 'Project_Management_Tracker_A00';
  }

  if (appId && !/^production-/i.test(appId) && !/^development-/i.test(appId)) {
    return appId;
  }

  const fromAppId = appId ? parseBackendApplicationRouteId(appId) : null;
  if (fromAppId?.applicationId) {
    return fromAppId.applicationId;
  }

  const fromRoute = routeId ? parseBackendApplicationRouteId(routeId) : null;
  if (fromRoute?.applicationId) {
    return fromRoute.applicationId;
  }

  return appId || routeId;
}

function asIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
      }
    } catch {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function mapRowToApplication(row: BackendApplicationRow): KissflowApplication {
  const environment = mapEnvironment(row.environment);
  const envConfig = REFEX_ENV_CONFIG[environment];
  const lastSync = row.last_seen_at
    ? new Date(row.last_seen_at).toLocaleString()
    : '—';
  const dataformIds = asIdList(row.dataform_ids);
  const boardIds = asIdList(row.board_ids);
  const datasetIds = asIdList(row.dataset_ids);

  const applicationName = friendlyApplicationName(row.application_id, row.application_name);

  return {
    id: `${row.environment}-${row.application_id}`,
    accountId: row.kissflow_account_id || envConfig.accountId,
    appId: row.application_id,
    subdomain: row.subdomain || envConfig.subdomain,
    name: applicationName,
    displayName: applicationName,
    description: row.description || `Synced from engagement_reporting · ${row.environment}`,
    region: (row.region as 'com' | 'eu') || 'com',
    environment,
    status: row.is_current ? 'Active' : 'Inactive',
    processIds: [],
    dataformIds,
    boardIds,
    datasetIds,
    accessKeyId: '',
    accessKeySecret: '',
    credentialsConfigured: undefined,
    icon: 'ri-apps-line',
    owner: '—',
    created: lastSync,
    lastSync,
    connected: row.is_current,
    dataformsCount: dataformIds.length,
    processesCount: 0,
    boardsCount: boardIds.length,
    templatesCount: 0,
    schedulersCount: 0,
  };
}

export type ApplicationsLoadResult = {
  applications: KissflowApplication[];
  source: 'backend' | 'local';
  warning?: string;
  error?: string;
  stale?: boolean;
};

/** Load applications from backend-api when enabled; otherwise caller uses localStorage. */
export async function loadApplicationsFromBackend(): Promise<ApplicationsLoadResult> {
  if (!isBackendApiMode()) {
    return { applications: [], source: 'local' };
  }

  const APPS_CACHE_KEY = 'ne_applications_list_v1';
  const APPS_CACHE_MS = 3 * 60 * 1000;
  try {
    const raw = sessionStorage.getItem(APPS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { ts: number; applications: KissflowApplication[]; warning?: string };
      if (parsed?.applications?.length && Date.now() - parsed.ts <= APPS_CACHE_MS) {
        return {
          applications: parsed.applications,
          source: 'backend',
          warning: parsed.warning,
        };
      }
    }
  } catch {
    /* ignore */
  }

  const res = await apiV1Fetch<ApplicationsListResponse>('/applications', { cache: 'no-store' }, { timeoutMs: 25000 });
  if (!res.ok || !res.data) {
    try {
      const raw = sessionStorage.getItem(APPS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { applications: KissflowApplication[]; warning?: string };
        if (parsed?.applications?.length) {
          return {
            applications: parsed.applications,
            source: 'backend',
            warning: parsed.warning,
            stale: true,
            error: res.error || 'Failed to refresh applications',
          };
        }
      }
    } catch {
      /* ignore */
    }
    return {
      applications: [],
      source: 'backend',
      error: res.error || 'Failed to load applications',
      stale: true,
    };
  }

  const applications = res.data.items.map(mapRowToApplication);
  try {
    sessionStorage.setItem(
      APPS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), applications, warning: res.data.warning || res.data.hint }),
    );
  } catch {
    /* ignore */
  }

  return {
    applications,
    source: 'backend',
    warning: res.data.warning || res.data.hint,
  };
}

export type ApplicationLoadResult = {
  application: KissflowApplication | null;
  error?: string;
  warning?: string;
};

/** Parse route id `{environment}-{application_id}` from backend list cards. */
export function parseBackendApplicationRouteId(routeId: string): {
  environment: string;
  applicationId: string;
} | null {
  const dash = routeId.indexOf('-');
  if (dash <= 0) return null;
  const environment = routeId.slice(0, dash);
  const applicationId = routeId.slice(dash + 1);
  if (!environment || !applicationId) return null;
  return { environment, applicationId };
}

function attachProcesses(
  app: KissflowApplication,
  environment: string,
  processes: BackendProcessRow[],
): KissflowApplication {
  const envLower = environment.toLowerCase();
  const forEnv = processes.filter((p) => p.environment.toLowerCase() === envLower);
  const processIds = forEnv.map((p) => p.process_id);
  const primary = forEnv[0];

  return {
    ...app,
    processIds,
    processesCount: processIds.length,
    lastFieldSyncAt: primary?.field_sync_at || undefined,
    discoveredItemCount: primary?.field_item_count || undefined,
    description:
      forEnv.length === 1
        ? forEnv[0].process_name
        : app.description,
  };
}

/** Load one application (and its processes) from backend-api by route id. */
export async function loadApplicationFromBackend(
  routeId: string,
  options?: { includeFields?: boolean },
): Promise<ApplicationLoadResult> {
  if (!isBackendApiMode()) {
    return { application: null };
  }

  const parsed = parseBackendApplicationRouteId(routeId);
  if (!parsed) {
    return { application: null, error: 'Invalid application id' };
  }

  const includeFields = options?.includeFields === true;
  const envParam = encodeURIComponent(toDbEnvironment(mapEnvironment(parsed.environment)));

  const appRes = await apiV1Fetch<{ item: BackendApplicationRow }>(
    `/applications/${encodeURIComponent(parsed.applicationId)}?environment=${envParam}`,
  );
  if (!appRes.ok || !appRes.data?.item) {
    return {
      application: null,
      error: appRes.error || 'Application not found in database',
    };
  }

  const row = appRes.data.item;
  const processesRes = await apiV1Fetch<ProcessesListResponse>(
    `/applications/${encodeURIComponent(parsed.applicationId)}/processes`,
  );

  let application = mapRowToApplication(row);
  if (processesRes.ok && processesRes.data) {
    application = attachProcesses(application, parsed.environment, processesRes.data.items);

    if (includeFields) {
      const { loadFieldsFromBackend } = await import('./fieldsApi');
      const fieldsByResourceId: NonNullable<KissflowApplication['fieldsByResourceId']> = {};
      for (const processId of application.processIds || []) {
        const fieldsRes = await loadFieldsFromBackend(application, processId);
        if (fieldsRes.ok) {
          fieldsByResourceId[processId] = {
            fields: fieldsRes.fields,
            syncedAt: fieldsRes.syncedAt || new Date().toISOString(),
            itemCount: fieldsRes.itemCount,
            adminProcessId: processId,
          };
        }
      }
      if (Object.keys(fieldsByResourceId).length) {
        application = { ...application, fieldsByResourceId };
        const primaryProcessId = application.processIds?.[0];
        const primaryFields = primaryProcessId ? fieldsByResourceId[primaryProcessId] : undefined;
        if (primaryFields) {
          application = {
            ...application,
            discoveredFields: primaryFields.fields,
            discoveredItemCount: primaryFields.itemCount,
            lastFieldSyncAt: primaryFields.syncedAt,
          };
        }
      }
    }
  }

  return {
    application,
    warning: processesRes.data?.warning || processesRes.data?.hint,
    error: !processesRes.ok ? processesRes.error : undefined,
  };
}

export type ApplicationRegistrationPayload = {
  kissflow_account_id: string;
  application_id: string;
  application_name?: string;
  display_name?: string;
  subdomain: string;
  region?: string;
  environment: string;
  description?: string;
  access_key_id: string;
  access_key_secret: string;
  process_ids?: string[];
  dataform_ids?: string[];
  board_ids?: string[];
  dataset_ids?: string[];
};

export type ApplicationRegistrationResult = {
  ok: boolean;
  routeId?: string;
  item?: {
    route_id: string;
    application_id: string;
    application_name: string;
    environment: string;
  };
  error?: string;
  idempotentReplay?: boolean;
};

export type ApplicationValidationResult = {
  ok: boolean;
  valid?: boolean;
  process_ids?: string[];
  dataform_ids?: string[];
  board_ids?: string[];
  dataset_ids?: string[];
  warnings?: string[];
  error?: string;
};

function idempotencyKey(): string {
  return crypto.randomUUID();
}

/** Validate Kissflow credentials and discover resources before registration. */
export async function validateApplicationOnBackend(
  payload: ApplicationRegistrationPayload,
): Promise<ApplicationValidationResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<{
    valid: boolean;
    process_ids: string[];
    dataform_ids: string[];
    board_ids: string[];
    dataset_ids: string[];
    warnings: string[];
  }>('/applications/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Kissflow validation failed' };
  }

  return {
    ok: true,
    valid: res.data.valid,
    process_ids: res.data.process_ids,
    dataform_ids: res.data.dataform_ids,
    board_ids: res.data.board_ids,
    dataset_ids: res.data.dataset_ids,
    warnings: res.data.warnings,
  };
}

export async function createApplicationOnBackend(
  payload: ApplicationRegistrationPayload,
): Promise<ApplicationRegistrationResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<{
    item: { route_id: string; application_id: string; application_name: string; environment: string };
    idempotent_replay?: boolean;
  }>('/applications', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to register application' };
  }

  return {
    ok: true,
    routeId: res.data.item.route_id,
    item: res.data.item,
    idempotentReplay: Boolean(res.data.idempotent_replay),
  };
}

/** Sync fields + related-user engagement cache once after Connect. */
export async function bootstrapApplicationOnBackend(
  applicationId: string,
  environment: RefexEnvironment | string = 'Production',
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const env = toDbEnvironment(environment);
  const path = `/applications/${encodeURIComponent(applicationId)}/bootstrap?environment=${encodeURIComponent(env)}`;
  const res = await apiV1Fetch<Record<string, unknown>>(path, { method: 'POST', body: '{}' });

  if (!res.ok) {
    return { ok: false, error: res.error || 'Bootstrap failed' };
  }
  return { ok: true, data: res.data || undefined };
}

/** Soft-delete an application in PostgreSQL (backend-api mode). */
export async function deleteApplicationOnBackend(
  routeId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const parsed = parseBackendApplicationRouteId(routeId);
  if (!parsed) {
    return { ok: false, error: 'Invalid application id' };
  }

  const res = await apiV1Fetch<{ deleted: boolean }>(
    `/applications/${encodeURIComponent(parsed.applicationId)}?environment=${encodeURIComponent(parsed.environment)}`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    return { ok: false, error: res.error || 'Failed to delete application' };
  }

  return { ok: true };
}

export type ApplicationUpdatePayload = {
  application_name?: string;
  description?: string;
  subdomain?: string;
  region?: string;
};

export type CredentialsStatusResult = {
  credentials_configured: boolean;
  kissflow_account_id?: string | null;
  provider?: string;
  secret_hints?: string[];
  credentials_bound_at?: string | null;
  note?: string;
  warning?: string;
};

export async function loadCredentialsStatusFromBackend(
  app: KissflowApplication,
): Promise<{ ok: boolean; status?: CredentialsStatusResult; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const applicationId = resolveBackendApplicationId(app);
  const environment = toDbEnvironment(app.environment);
  const res = await apiV1Fetch<CredentialsStatusResult>(
    `/applications/${encodeURIComponent(applicationId)}/credentials-status?environment=${encodeURIComponent(environment)}`,
  );

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to load credential status' };
  }

  return { ok: true, status: res.data };
}

export async function updateApplicationOnBackend(
  app: KissflowApplication,
  payload: ApplicationUpdatePayload,
): Promise<{ ok: boolean; application?: KissflowApplication; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const applicationId = resolveBackendApplicationId(app);
  const environment = toDbEnvironment(app.environment);
  const res = await apiV1Fetch<{ item: BackendApplicationRow }>(
    `/applications/${encodeURIComponent(applicationId)}?environment=${encodeURIComponent(environment)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        application_name: payload.application_name,
        description: payload.description,
        subdomain: payload.subdomain,
        region: payload.region,
      }),
    },
  );

  if (!res.ok || !res.data?.item) {
    return { ok: false, error: res.error || 'Failed to update application' };
  }

  return { ok: true, application: mapRowToApplication(res.data.item) };
}

export type AttachResourcesPayload = {
  process_ids?: string[];
  dataform_ids?: string[];
  board_ids?: string[];
  dataset_ids?: string[];
  sync_fields?: boolean;
};

export type AttachResourcesResult = {
  ok: boolean;
  process_ids?: string[];
  added_process_ids?: string[];
  dataform_ids?: string[];
  board_ids?: string[];
  dataset_ids?: string[];
  field_sync?: Array<{
    process_id: string;
    ok: boolean;
    field_count?: number;
    item_count?: number;
    synced_at?: string;
    error?: string;
  }>;
  warnings?: string[];
  error?: string;
};

/** Add processes / dataforms / boards / datasets to an already-connected application. */
export async function attachResourcesOnBackend(
  app: KissflowApplication,
  payload: AttachResourcesPayload,
): Promise<AttachResourcesResult> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const applicationId = resolveBackendApplicationId(app);
  const environment = toDbEnvironment(app.environment);
  const res = await apiV1Fetch<{
    process_ids: string[];
    added_process_ids: string[];
    dataform_ids: string[];
    board_ids: string[];
    dataset_ids: string[];
    field_sync?: AttachResourcesResult['field_sync'];
    warnings?: string[];
  }>(
    `/applications/${encodeURIComponent(applicationId)}/resources?environment=${encodeURIComponent(environment)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        process_ids: payload.process_ids,
        dataform_ids: payload.dataform_ids,
        board_ids: payload.board_ids,
        dataset_ids: payload.dataset_ids,
        sync_fields: payload.sync_fields !== false,
      }),
    },
  );

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to add resources' };
  }

  return {
    ok: true,
    process_ids: res.data.process_ids,
    added_process_ids: res.data.added_process_ids,
    dataform_ids: res.data.dataform_ids,
    board_ids: res.data.board_ids,
    dataset_ids: res.data.dataset_ids,
    field_sync: res.data.field_sync,
    warnings: res.data.warnings,
  };
}
