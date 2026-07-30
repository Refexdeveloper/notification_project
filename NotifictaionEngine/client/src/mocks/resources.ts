import { getApplicationById, getApplications, type KissflowApplication } from '@/mocks/applications';

export type ResourceType = 'dataform' | 'process' | 'board';
export type ResourceStatus = 'synced' | 'stale' | 'error' | 'pending';

export interface KissflowResource {
  id: string;
  appId: string;
  name: string;
  type: ResourceType;
  resourceId: string;
  description: string;
  fieldsCount: number;
  templatesCount: number;
  schedulersCount: number;
  lastSync: string;
  status: ResourceStatus;
  icon: string;
  owner: string;
}

export const resourceTypeLabel: Record<ResourceType, string> = {
  dataform: 'Dataform',
  process: 'Process',
  board: 'Board',
};

export const resourceTypeIcon: Record<ResourceType, string> = {
  dataform: 'ri-survey-line',
  process: 'ri-git-branch-line',
  board: 'ri-kanban-view',
};

/** Build resources from IDs registered on an application (no seed list). */
export function buildResourcesFromApp(app: KissflowApplication): KissflowResource[] {
  const now = app.lastSync || new Date().toISOString();

  const mapIds = (ids: string[], type: ResourceType, icon: string): KissflowResource[] =>
    ids.map((resourceId, i) => {
      const synced = app.fieldsByResourceId?.[resourceId];
      const fieldCount = synced?.fields.length ?? 0;
      return {
        id: `${app.id}-${type}-${i}`,
        appId: app.id,
        name: resourceId,
        type,
        resourceId,
        description: `${resourceTypeLabel[type]} registered for ${app.displayName || app.name}`,
        fieldsCount: fieldCount,
        templatesCount: 0,
        schedulersCount: 0,
        lastSync: synced?.syncedAt || now,
        status: (synced ? 'synced' : 'pending') as ResourceStatus,
        icon,
        owner: app.owner,
      };
    });

  return [
    ...mapIds(app.processIds || [], 'process', resourceTypeIcon.process),
    ...mapIds(app.dataformIds || [], 'dataform', resourceTypeIcon.dataform),
    ...mapIds(app.boardIds || [], 'board', resourceTypeIcon.board),
  ];
}

export function getResourcesByAppId(appId: string): KissflowResource[] {
  const app = getApplicationById(appId);
  return app ? buildResourcesFromApp(app) : [];
}

export function getResourceById(id: string): KissflowResource | undefined {
  for (const app of getApplications()) {
    const match = buildResourcesFromApp(app).find((r) => r.id === id || r.resourceId === id);
    if (match) return match;
  }
  return undefined;
}

export function getResourcesByType(appId: string, type: ResourceType | 'all'): KissflowResource[] {
  const list = getResourcesByAppId(appId);
  if (type === 'all') return list;
  return list.filter((r) => r.type === type);
}

/** @deprecated Empty — resources are derived from applications. */
export const resources: KissflowResource[] = [];
