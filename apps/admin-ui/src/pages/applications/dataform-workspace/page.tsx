import { Navigate, useParams } from 'react-router-dom';
import { getResourcesByAppId } from '@/mocks/resources';
import { getDataformById } from '@/mocks/dataforms';

/**
 * Legacy three-panel dataform editor has been retired.
 * Canonical editor: /templates/:id
 * Resource workspace: /applications/:id/resources/:resourceId
 */
export default function DataformWorkspace() {
  const { id, formId } = useParams<{ id: string; formId: string }>();

  if (!id) return <Navigate to="/applications" replace />;

  const dataform = formId ? getDataformById(formId) : undefined;
  const match = dataform
    ? getResourcesByAppId(id).find((r) => r.type === 'dataform' && r.name === dataform.name)
    : undefined;

  if (match) {
    return <Navigate to={`/applications/${id}/resources/${match.id}?tab=templates`} replace />;
  }

  return <Navigate to={`/applications/${id}?tab=resources`} replace />;
}
