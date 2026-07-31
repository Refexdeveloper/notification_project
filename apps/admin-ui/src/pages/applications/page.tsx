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
import {
  REFEX_ENV_CONFIG,
  type RefexEnvironment,
} from '@/seeds/refexAppCatalog';
import { springSnappy, staggerContainer } from '@/lib/motion';
import { isBackendApiMode } from '@/services/backendApi';
import { loadApplicationsFromBackend } from '@/services/applicationsApi';

const ENV_STORAGE_KEY = 'ne_apps_environment';

function readEnvPreference(): RefexEnvironment {
  try {
    const v = localStorage.getItem(ENV_STORAGE_KEY);
    if (v === 'Production' || v === 'Development') return v;
  } catch {
    /* ignore */
  }
  return 'Development';
}

export default function ApplicationsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [environment, setEnvironment] = useState<RefexEnvironment>(readEnvPreference);
  const [loading, setLoading] = useState(isBackendApiMode());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [backendApps, setBackendApps] = useState<ReturnType<typeof getApplications>>([]);

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
    () => applications.filter((a) => a.environment === environment),
    [applications, environment],
  );

  const connectedCount = envApps.filter((a) => a.connected).length;
  const envMeta = REFEX_ENV_CONFIG[environment];

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

  const selectEnvironment = (env: RefexEnvironment) => {
    setEnvironment(env);
    try {
      localStorage.setItem(ENV_STORAGE_KEY, env);
    } catch {
      /* ignore */
    }
  };

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
              {envMeta.subdomain}.kissflow.com · {envMeta.accountId}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 lg:justify-end">
          <EnvToggle value={environment} onChange={selectEnvironment} />
          <Button onClick={() => setFormOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
            Connect
          </Button>
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
          {isBackendApiMode() ? ' · backend-api' : ''}
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
          key={environment}
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
          title={`No ${environment.toLowerCase()} applications`}
          description={
            isBackendApiMode()
              ? 'Connect a Kissflow application for this environment. Registration stores account metadata and credential refs in PostgreSQL (secrets are not stored in the database).'
              : 'Connect a Kissflow account for this environment to sync fields and schedule reports.'
          }
          primaryLabel="Connect Application"
          onPrimary={() => setFormOpen(true)}
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

function EnvToggle({
  value,
  onChange,
}: {
  value: RefexEnvironment;
  onChange: (env: RefexEnvironment) => void;
}) {
  const options: { id: RefexEnvironment; label: string }[] = [
    { id: 'Development', label: 'Dev' },
    { id: 'Production', label: 'Prod' },
  ];

  return (
    <div
      className="relative inline-flex p-1 rounded-xl bg-[#EEF4FA] border border-[#D7E6F4]"
      role="group"
      aria-label="Environment"
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`relative min-w-[76px] h-9 px-4 rounded-[10px] text-sm font-semibold transition-colors duration-150 cursor-pointer ${
              active ? 'text-[#0F6CBD]' : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
            aria-pressed={active}
          >
            {active && (
              <motion.span
                layoutId="env-toggle-pill"
                className="absolute inset-0 rounded-[10px] bg-white shadow-[var(--shadow-soft)]"
                transition={springSnappy}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
