import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import ApplicationCard from '@/pages/home/components/ApplicationCard';
import { getApplications } from '@/mocks/applications';
import AddApplicationForm from './components/AddApplicationForm';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { REFEXONE_LOGO_URL } from '@/constants/branding';
import { REFEX_ENV_CONFIG } from '@/seeds/refexAppCatalog';
import { staggerContainer } from '@/lib/motion';
import { isBackendApiMode } from '@/services/backendApi';
import { loadApplicationsFromBackend } from '@/services/applicationsApi';
import { useAuth } from '@/hooks/AuthContext';

/** Production-only surface for executive review — Development env is not shown. */
const PRODUCTION_ENV = 'Production' as const;

export default function ApplicationsPage() {
  const { isAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(isBackendApiMode());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [backendApps, setBackendApps] = useState<ReturnType<typeof getApplications>>([]);

  useEffect(() => {
    try {
      localStorage.setItem('ne_apps_environment', PRODUCTION_ENV);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isBackendApiMode()) return;
    let cancelled = false;
    setLoading(true);
    loadApplicationsFromBackend().then((result) => {
      if (cancelled) return;
      setBackendApps(result.applications);
      setLoadError(result.error || null);
      setLoadWarning(result.warning || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const applications = useMemo(() => {
    if (isBackendApiMode()) return backendApps;
    return getApplications();
  }, [backendApps, tick]);

  const envApps = useMemo(
    () => applications.filter((a) => a.environment === PRODUCTION_ENV),
    [applications],
  );

  const connectedCount = envApps.filter((a) => a.connected).length;
  const envMeta = REFEX_ENV_CONFIG[PRODUCTION_ENV];

  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return envApps;
    const q = searchQuery.toLowerCase();
    return envApps.filter(
      (app) =>
        app.name.toLowerCase().includes(q) ||
        app.displayName.toLowerCase().includes(q) ||
        app.accountId.toLowerCase().includes(q) ||
        app.subdomain.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        app.appId.toLowerCase().includes(q) ||
        app.processIds.some((id) => id.toLowerCase().includes(q)),
    );
  }, [envApps, searchQuery]);

  return (
    <Layout
      breadcrumbs={[
        { label: 'Home', path: '/applications' },
        { label: 'Applications' },
      ]}
    >
      <div className="dash-banner mb-6 px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <img src={REFEXONE_LOGO_URL} alt="refexOne" className="h-9 w-auto object-contain shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-[#1E293B] tracking-tight truncate">
              Applications
            </h1>
            <p className="text-xs text-[#64748B] mt-0.5 truncate">
              {envMeta.subdomain}.kissflow.com · Production
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 lg:justify-end">
          {isAdmin && (
            <Button onClick={() => setFormOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
              Connect
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not load applications from backend-api: {loadError}
        </div>
      )}
      {loadWarning && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {loadWarning === 'DATABASE_NOT_CONFIGURED'
            ? 'PostgreSQL not configured. Copy services/backend-api/.env.example to .env and set PGPASSWORD to load applications.'
            : loadWarning === 'SCHEMA_NOT_MIGRATED'
              ? 'Database schema not migrated yet. Run db/migrations/*.sql'
              : `Partial data: ${loadWarning}`}
        </div>
      )}

      <div className="mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or process…"
            leftSlot={<Search className="w-4 h-4" />}
          />
        </div>
        <p className="text-xs text-foreground-400 font-medium sm:ml-auto">
          {loading ? 'Loading…' : `${filteredApps.length} app${filteredApps.length === 1 ? '' : 's'}`}
          {envApps.length > 0 ? ` · ${connectedCount} connected` : ''}
          {isBackendApiMode() ? ' · production' : ''}
        </p>
      </div>

      {loading ? (
        <EmptyState
          variant="apps"
          title="Loading applications"
          description="Fetching from backend-api…"
        />
      ) : filteredApps.length > 0 ? (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {filteredApps.map((app) => (
            <ApplicationCard key={app.id} application={app} />
          ))}
        </motion.div>
      ) : searchQuery ? (
        <EmptyState
          variant="apps"
          title="No matches"
          description="Try a different name or clear the search."
          primaryLabel="Clear search"
          onPrimary={() => setSearchQuery('')}
        />
      ) : (
        <EmptyState
          variant="apps"
          title="No production applications"
          description={
            isBackendApiMode()
              ? 'Connect a Kissflow application for production. Registration stores account metadata and credential refs in PostgreSQL (secrets are not stored in the database).'
              : 'Connect a Kissflow account for production to sync fields and schedule reports.'
          }
          primaryLabel={isAdmin ? 'Connect Application' : undefined}
          onPrimary={isAdmin ? () => setFormOpen(true) : undefined}
        />
      )}

      <AddApplicationForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={() => setTick((t) => t + 1)}
      />
    </Layout>
  );
}
