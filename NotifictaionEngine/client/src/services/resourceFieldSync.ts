import { apiFetch } from './api';
import type { DiscoveredField, KissflowApplication } from '@/mocks/applications';
import type { KissflowResource } from '@/mocks/resources';

export async function persistResourceFieldsToServer(
  app: KissflowApplication,
  resource: KissflowResource,
  fields: DiscoveredField[],
  itemCount: number,
  adminProcessId: string,
) {
  return apiFetch<{ ok: boolean; fieldCount: number; last_sync_at?: string }>(
    '/kissflow-resources/sync-fields',
    {
      method: 'POST',
      body: JSON.stringify({
        external_app_id: app.id,
        application_name: app.displayName || app.name,
        account_id: app.accountId,
        subdomain: app.subdomain,
        region: app.region,
        environment: app.environment,
        kissflow_app_id: app.appId,
        process_ids: app.processIds,
        resource_type: resource.type,
        resource_id: resource.resourceId,
        display_name: resource.name,
        admin_process_id: adminProcessId,
        item_count: itemCount,
        fields: fields.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          sample: f.sample,
          occurrences: f.occurrences,
          is_system: f.is_system,
        })),
      }),
    },
  );
}

export async function fetchResourceFieldsFromServer(
  externalAppId: string,
  resourceId: string,
  resourceType = 'process',
) {
  const qs = new URLSearchParams({
    external_app_id: externalAppId,
    resource_id: resourceId,
    resource_type: resourceType,
  });
  return apiFetch<{
    fields: DiscoveredField[];
    resource: {
      resource_id: string;
      admin_process_id?: string;
      item_count?: number;
      last_sync_at?: string;
    } | null;
  }>(`/kissflow-resources/fields?${qs}`);
}
