/**
 * Seeds all Refex Kissflow apps (Dev + Prod) into localStorage.
 * Idempotent — preserves discovered fields and any user overrides on existing ids.
 */

import {
  getApplications,
  saveApplication,
  type KissflowApplication,
} from '@/mocks/applications';
import {
  REFEX_APP_CATALOG,
  REFEX_ENV_CONFIG,
  appStorageId,
  type RefexAppDefinition,
  type RefexEnvironment,
} from './refexAppCatalog';

function buildApp(
  def: RefexAppDefinition,
  env: RefexEnvironment,
  existing?: KissflowApplication,
): KissflowApplication {
  const now = new Date().toISOString();
  const creds = REFEX_ENV_CONFIG[env];
  const accessKeyId = creds.accessKeyId || existing?.accessKeyId || '';
  const accessKeySecret = creds.accessKeySecret || existing?.accessKeySecret || '';
  const processId = def.processId;

  return {
    id: appStorageId(def.slug, env),
    accountId: creds.accountId,
    /** Admin API + field sync process id */
    appId: processId,
    subdomain: creds.subdomain,
    name: def.applicationName,
    displayName: def.applicationName,
    description: `${def.processName} · Kissflow app ${def.kissflowAppId}`,
    region: 'com',
    environment: env,
    status: 'Active',
    processIds: [processId],
    dataformIds: existing?.dataformIds || [],
    boardIds: existing?.boardIds || [],
    datasetIds: existing?.datasetIds || [],
    accessKeyId,
    accessKeySecret,
    discoveredFields: existing?.discoveredFields || [],
    discoveredItemCount: existing?.discoveredItemCount || 0,
    lastFieldSyncAt: existing?.lastFieldSyncAt,
    fieldsByResourceId: existing?.fieldsByResourceId,
    icon: def.icon,
    owner: 'Refex seed',
    created: existing?.created || now,
    lastSync: now,
    connected: Boolean(accessKeyId && accessKeySecret),
    dataformsCount: existing?.dataformsCount || 0,
    processesCount: 1,
    boardsCount: existing?.boardsCount || 0,
    templatesCount: existing?.templatesCount || 0,
    schedulersCount: existing?.schedulersCount || 0,
  };
}

/** Upserts every catalog app for Development and Production. */
export function seedRefexApps(): KissflowApplication[] {
  const existing = getApplications();
  const seeded: KissflowApplication[] = [];
  const environments: RefexEnvironment[] = ['Development', 'Production'];

  for (const def of REFEX_APP_CATALOG) {
    for (const env of environments) {
      const id = appStorageId(def.slug, env);
      const prev = existing.find((a) => a.id === id);
      seeded.push(saveApplication(buildApp(def, env, prev)));
    }
  }

  return seeded;
}
