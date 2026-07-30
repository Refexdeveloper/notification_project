import { Navigate, useParams } from 'react-router-dom';
import { getResourceById, getResourcesByAppId } from '@/mocks/resources';
import { getDataformById } from '@/mocks/dataforms';

/** Bridges legacy /dataforms/:formId URLs into the Resource Manager workspace. */
export default function DataformRedirect() {
  const { id, formId } = useParams<{ id: string; formId: string }>();

  if (!id || !formId) {
    return <Navigate to="/applications" replace />;
  }

  if (getResourceById(formId)) {
    return <Navigate to={`/applications/${id}/resources/${formId}`} replace />;
  }

  const dataform = getDataformById(formId);
  if (dataform) {
    const match = getResourcesByAppId(id).find(
      (r) =>
        r.type === 'dataform' &&
        (r.name === dataform.name || r.resourceId.includes(formId.toUpperCase())),
    );
    if (match) {
      return <Navigate to={`/applications/${id}/resources/${match.id}`} replace />;
    }
  }

  return <Navigate to={`/applications/${id}?tab=resources`} replace />;
}
