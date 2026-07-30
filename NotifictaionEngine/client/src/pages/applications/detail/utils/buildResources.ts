import type { KissflowApplication } from '@/mocks/applications';
import { buildResourcesFromApp as buildFromApp, type KissflowResource } from '@/mocks/resources';

/** Build resources from IDs registered on the application (no seeded mock list). */
export function buildResourcesFromApp(app: KissflowApplication): KissflowResource[] {
  return buildFromApp(app);
}
