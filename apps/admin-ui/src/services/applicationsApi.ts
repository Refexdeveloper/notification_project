import type { KissflowApplication } from '@/mocks/applications';
import {
  apiV1Fetch,
  isBackendApiMode,
  type ApplicationsListResponse,
  type BackendApplicationRow,
  type BackendProcessRow,
  type ProcessesListResponse,
} from './backendApi';
import { REFEX_ENV_CONFIG, type RefexEnvironment } from '@/seeds/refexAppCatalog';

function mapEnvironment(env: string): RefexEnvironment {
  const lower = env.toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'Production';
  if (lower === 'uat') return 'UAT';
  if (lower === 'staging') return 'Staging';
  return 'Development';
}

function toDbEnvironment(env: RefexEnvironment | string): string {
  const lower = String(env).toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'uat') return 'uat';
  if (lower === 'staging') return 'staging';
  return 'development';
}

/** Backend APIs use registered Kissflow application_id (not legacy process id). */
export function resolveBackendApplicationId(app: KissflowApplication): string {
  const appId = (app.appId || '').trim();
  if (
    appId === 'Lead_tracker_1_A00' ||
    app.id.includes('lead-tracker') ||
    app.name.toLowerCase().includes('lead tracker')
  ) {
    return 'Lead_Trcaker_A00';
  }
  return appId;
}

function mapRowToApplication(row: BackendApplicationRow): KissflowApplication {
  const environment = mapEnvironment(row.environment);
  const envConfig = REFEX_ENV_CONFIG[environment];
  const lastSync = row.last_seen_at
    ? new Date(row.last_seen_at).toLocaleString()
    : '—';

  return {
    id: `${row.environment}-${row.application_id}`,
    accountId: row.kissflow_account_id || envConfig.accountId,
    appId: row.application_id,
    subdomain: row.subdomain || envConfig.subdomain,
    name: row.application_name,
    displayName: row.application_name,
    description: row.description || `Synced from engagement_reporting · ${row.environment}`,
    region: (row.region as 'com' | 'eu') || 'com',
    environment,
    status: row.is_current ? 'Active' : 'Inactive',
    processIds: [],
    dataformIds: [],
    boardIds: [],
    datasetIds: [],
    accessKeyId: '',
    accessKeySecret: '',
    credentialsConfigured: undefined,
    icon: 'ri-apps-line',
    owner: '—',
    created: lastSync,
    lastSync,
    connected: row.is_current,
    dataformsCount: 0,
    processesCount: 0,
    boardsCount: 0,
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

  const res = await apiV1Fetch<ApplicationsListResponse>('/applications');
  if (!res.ok || !res.data) {
    return {
      applications: [],
      source: 'backend',
      error: res.error || 'Failed to load applications',
      stale: true,
    };
  }

  return {
    applications: res.data.items.map(mapRowToApplication),
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
export async function loadApplicationFromBackend(routeId: string): Promise<ApplicationLoadResult> {
  if (!isBackendApiMode()) {
    return { application: null };
  }

  const parsed = parseBackendApplicationRouteId(routeId);
  if (!parsed) {
    return { application: null, error: 'Invalid application id' };
  }

  const appsRes = await apiV1Fetch<ApplicationsListResponse>('/applications');
  if (!appsRes.ok || !appsRes.data) {
    return {
      application: null,
      error: appsRes.error || 'Failed to load applications',
    };
  }

  const row = appsRes.data.items.find(
    (item) =>
      item.application_id === parsed.applicationId &&
      item.environment.toLowerCase() === parsed.environment.toLowerCase(),
  );
  if (!row) {
    return { application: null, error: 'Application not found in database' };
  }

  const processesRes = await apiV1Fetch<ProcessesListResponse>(
    `/applications/${encodeURIComponent(parsed.applicationId)}/processes`,
  );

  let application = mapRowToApplication(row);
  if (processesRes.ok && processesRes.data) {
    application = attachProcesses(application, parsed.environment, processesRes.data.items);
  }

  const primaryProcessId = application.processIds?.[0];
  if (primaryProcessId) {
    const { loadFieldsFromBackend } = await import('./fieldsApi');
    const fieldsRes = await loadFieldsFromBackend(application, primaryProcessId);
    if (fieldsRes.ok && fieldsRes.fields.length) {
      application = {
        ...application,
        discoveredFields: fieldsRes.fields,
        discoveredItemCount: fieldsRes.itemCount,
        lastFieldSyncAt: fieldsRes.syncedAt,
      };
    }
  }

  return {
    application,
    warning: processesRes.data?.warning || processesRes.data?.hint || appsRes.data.warning,
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

export { toDbEnvironment };
