import { Navigate, useParams } from 'react-router-dom';
import ResourceWorkspacePage from '@/pages/applications/resource-workspace/page';
import { isBackendApiMode } from '@/services/backendApi';

/**
 * Prototype resource workspace; in backend mode redirect to app field sync tab.
 */
export default function ResourceWorkspaceRoute() {
  const { id } = useParams<{ id: string }>();

  if (isBackendApiMode() && id) {
    return <Navigate to={`/applications/${id}?tab=discovery`} replace />;
  }

  return <ResourceWorkspacePage />;
}
