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
  return 'Development';
}

function mapRowToApplication(row: BackendApplicationRow): KissflowApplication {
  const environment = mapEnvironment(row.environment);
  const envConfig = REFEX_ENV_CONFIG[environment];
  const lastSync = row.last_seen_at
    ? new Date(row.last_seen_at).toLocaleString()
    : '—';

  return {
    id: `${row.environment}-${row.application_id}`,
    accountId: envConfig.accountId,
    appId: row.application_id,
    subdomain: envConfig.subdomain,
    name: row.application_name,
    displayName: row.application_name,
    description: `Synced from engagement_reporting · ${row.environment}`,
    region: 'com',
    environment,
    status: row.is_current ? 'Active' : 'Inactive',
    processIds: [],
    dataformIds: [],
    boardIds: [],
    datasetIds: [],
    accessKeyId: '',
    accessKeySecret: '',
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
  return {
    ...app,
    processIds,
    processesCount: processIds.length,
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

  return {
    application,
    warning: processesRes.data?.warning || processesRes.data?.hint || appsRes.data.warning,
    error: !processesRes.ok ? processesRes.error : undefined,
  };
}
