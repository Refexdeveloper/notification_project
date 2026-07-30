export interface KissflowApplication {
  id: string;
  /** Kissflow Account ID used in API path params */
  accountId: string;
  /**
   * Kissflow process / app ID used for Admin APIs
   * (e.g. Lead_tracker_1_A00 → /process/2/{account}/admin/{appId}/item)
   */
  appId: string;
  /** Kissflow subdomain, e.g. acme → https://acme.kissflow.com */
  subdomain: string;
  /** Optional human label */
  name: string;
  displayName: string;
  description: string;
  region: 'com' | 'eu';
  environment: 'Production' | 'Development' | 'UAT' | 'Staging';
  status: 'Active' | 'Inactive' | 'Maintenance';
  /** Kissflow process IDs (comma-separated input stored as array) */
  processIds: string[];
  /** Kissflow dataform IDs */
  dataformIds: string[];
  /** Kissflow board IDs */
  boardIds: string[];
  /** Optional dataset IDs */
  datasetIds: string[];
  accessKeyId: string;
  accessKeySecret: string;
  /** Backend mode: Kissflow keys live in GCP Secret Manager (never returned by API) */
  credentialsConfigured?: boolean;
  credentialsSecretHints?: string[];
  /** Fields discovered from Admin Get-all-items sync */
  discoveredFields?: DiscoveredField[];
  /** Per Kissflow resource ID (process/board/dataform) */
  fieldsByResourceId?: Record<string, ResourceFieldSync>;
  /** Item count reported on last field sync */
  discoveredItemCount?: number;
  lastFieldSyncAt?: string;
  icon: string;
  owner: string;
  created: string;
  lastSync: string;
  connected: boolean;
  /** Derived counts for existing UI */
  dataformsCount: number;
  processesCount: number;
  boardsCount: number;
  templatesCount: number;
  schedulersCount: number;
}

export interface DiscoveredField {
  id: string;
  name: string;
  label: string;
  type: string;
  sample?: string;
  occurrences: number;
}

export interface ResourceFieldSync {
  fields: DiscoveredField[];
  itemCount: number;
  syncedAt: string;
  /** Process ID actually used in the admin API call */
  adminProcessId: string;
}

const STORAGE_KEY = 'ne_applications';

function readStore(): KissflowApplication[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as KissflowApplication[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(apps: KissflowApplication[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

/** Mutable in-memory list; starts empty (no mock seed data). */
export let applications: KissflowApplication[] = readStore();

export function getApplications(): KissflowApplication[] {
  applications = readStore();
  return applications;
}

export function getApplicationById(id: string): KissflowApplication | undefined {
  return getApplications().find((a) => a.id === id);
}

export function saveApplication(app: KissflowApplication): KissflowApplication {
  const list = getApplications();
  const idx = list.findIndex((a) => a.id === app.id);
  if (idx >= 0) list[idx] = app;
  else list.unshift(app);
  writeStore(list);
  applications = list;
  return app;
}

export function deleteApplication(id: string) {
  const list = getApplications().filter((a) => a.id !== id);
  writeStore(list);
  applications = list;
}

export function parseIdList(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AddApplicationInput {
  accountId: string;
  /** Kissflow process App ID for Admin Get-all-items */
  appId: string;
  subdomain: string;
  name: string;
  description?: string;
  region: 'com' | 'eu';
  environment: KissflowApplication['environment'];
  processIds: string;
  dataformIds: string;
  boardIds: string;
  datasetIds?: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export function createApplicationFromForm(input: AddApplicationInput): KissflowApplication {
  const processIds = parseIdList(input.processIds);
  const dataformIds = parseIdList(input.dataformIds);
  const boardIds = parseIdList(input.boardIds);
  const datasetIds = parseIdList(input.datasetIds || '');
  const now = new Date().toISOString();
  const name = input.name.trim() || input.accountId.trim();

  const app: KissflowApplication = {
    id: `app-${Date.now()}`,
    accountId: input.accountId.trim(),
    appId: input.appId.trim(),
    subdomain: input.subdomain.trim().replace(/\.kissflow\.(com|eu)$/i, ''),
    name,
    displayName: name,
    description: input.description?.trim() || '',
    region: input.region,
    environment: input.environment,
    status: 'Active',
    processIds,
    dataformIds,
    boardIds,
    datasetIds,
    accessKeyId: input.accessKeyId.trim(),
    accessKeySecret: input.accessKeySecret,
    discoveredFields: [],
    discoveredItemCount: 0,
    icon: 'ri-apps-line',
    owner: 'You',
    created: now,
    lastSync: now,
    connected: Boolean(input.accessKeyId && input.accessKeySecret),
    dataformsCount: dataformIds.length,
    processesCount: processIds.length,
    boardsCount: boardIds.length,
    templatesCount: 0,
    schedulersCount: 0,
  };

  return saveApplication(app);
}

export function updateApplicationFromForm(
  id: string,
  input: AddApplicationInput & { status?: KissflowApplication['status'] },
): KissflowApplication | undefined {
  const existing = getApplicationById(id);
  if (!existing) return undefined;

  const processIds = parseIdList(input.processIds);
  const dataformIds = parseIdList(input.dataformIds);
  const boardIds = parseIdList(input.boardIds);
  const datasetIds = parseIdList(input.datasetIds || '');
  const name = input.name.trim() || input.accountId.trim();
  const accessKeySecret = input.accessKeySecret.trim()
    ? input.accessKeySecret
    : existing.accessKeySecret;

  const updated: KissflowApplication = {
    ...existing,
    accountId: input.accountId.trim(),
    appId: input.appId.trim(),
    subdomain: input.subdomain.trim().replace(/\.kissflow\.(com|eu)$/i, ''),
    name,
    displayName: name,
    description: input.description?.trim() || '',
    region: input.region,
    environment: input.environment,
    status: input.status || existing.status,
    processIds,
    dataformIds,
    boardIds,
    datasetIds,
    accessKeyId: input.accessKeyId.trim(),
    accessKeySecret,
    lastSync: new Date().toISOString(),
    connected: Boolean(input.accessKeyId.trim() && accessKeySecret),
    dataformsCount: dataformIds.length,
    processesCount: processIds.length,
    boardsCount: boardIds.length,
  };

  return saveApplication(updated);
}

/** Persist fields discovered from Admin Get-all-items sync. */
export function saveDiscoveredFields(
  id: string,
  fields: DiscoveredField[],
  itemCount: number,
  options?: { resourceId?: string; adminProcessId?: string },
): KissflowApplication | undefined {
  const existing = getApplicationById(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const resourceId = options?.resourceId;
  const fieldsByResourceId = { ...(existing.fieldsByResourceId || {}) };
  if (resourceId) {
    fieldsByResourceId[resourceId] = {
      fields,
      itemCount,
      syncedAt: now,
      adminProcessId: options?.adminProcessId || existing.appId || resourceId,
    };
  }
  return saveApplication({
    ...existing,
    discoveredFields: fields,
    discoveredItemCount: itemCount,
    lastFieldSyncAt: now,
    lastSync: now,
    fieldsByResourceId,
  });
}

export function getFieldsForResource(
  app: KissflowApplication,
  resourceId: string,
): ResourceFieldSync | undefined {
  return app.fieldsByResourceId?.[resourceId];
}
