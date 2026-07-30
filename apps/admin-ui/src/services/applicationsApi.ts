import type { KissflowApplication } from '@/mocks/applications';
import {
  apiV1Fetch,
  isBackendApiMode,
  type ApplicationsListResponse,
  type BackendApplicationRow,
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
    warning: res.data.warning,
  };
}
