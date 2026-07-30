import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '@/components/feature/Layout';
import { isBackendApiMode } from '@/services/backendApi';
import { EmptyState } from '@/components/ui/EmptyState';

type PrototypeOnlyGateProps = {
  children: ReactNode;
  /** Where to send users in backend-api mode. */
  redirectTo?: string;
  /** Optional page title for the redirect notice layout. */
  title?: string;
};

/**
 * Renders children only in prototype (MySQL) mode.
 * In backend-api mode, redirects to applications or shows a short notice.
 */
export default function PrototypeOnlyGate({
  children,
  redirectTo = '/applications',
  title = 'Prototype only',
}: PrototypeOnlyGateProps) {
  if (!isBackendApiMode()) {
    return <>{children}</>;
  }

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: title }]}>
      <EmptyState
        variant="apps"
        title="Not available in backend mode"
        description="This screen uses the legacy MySQL prototype. Open an application and use its Templates, Schedules, and Sent tabs instead."
        primaryLabel="Go to applications"
        onPrimary={() => {
          window.location.href = '/applications';
        }}
      />
    </Layout>
  );
}
