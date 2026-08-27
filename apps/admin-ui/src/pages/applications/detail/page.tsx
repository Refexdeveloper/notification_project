import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { applicationDetailTabs, defaultApplicationTab, type AppDetailTabId } from '@/config/backendSurface';
import Layout from '@/components/feature/Layout';
import { getApplicationById, saveDiscoveredFields } from '@/mocks/applications';
import { syncFieldsFromAdminItems } from '@/services/fieldDiscovery';
import { isBackendApiMode } from '@/services/backendApi';
import { loadApplicationFromBackend } from '@/services/applicationsApi';
import { syncFieldsOnBackend } from '@/services/fieldsApi';
import type { KissflowApplication } from '@/mocks/applications';
import OverviewTab from './components/OverviewTab';
import AppDashboardTab from './components/AppDashboardTab';
import ConnectionTab from './components/ConnectionTab';
import DiscoveryTab from './components/DiscoveryTab';
import ResourcesTab from './components/ResourcesTab';
import TemplatesTab from './components/TemplatesTab';
import SchedulersTab from './components/SchedulersTab';
import HistoryTab from './components/HistoryTab';
import SettingsTab from './components/SettingsTab';
import EngagementTab from './components/EngagementTab';
import { Button } from '@/components/ui/Button';
import { duration, easeOutSoft, springSnappy } from '@/lib/motion';
import { EmptyState } from '@/components/ui/EmptyState';
import { RefreshCw, AlertCircle, Pencil } from 'lucide-react';
import { catalogEntryForApp } from '@/seeds/refexAppCatalog';

type TabId = AppDetailTabId;

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [appRevision, setAppRevision] = useState(0);
  const [headerSyncing, setHeaderSyncing] = useState(false);
  const [headerSyncError, setHeaderSyncError] = useState('');
  const [tabRefreshNonce, setTabRefreshNonce] = useState(0);
  const [headerRefreshing, setHeaderRefreshing] = useState(false);
  const [loading, setLoading] = useState(isBackendApiMode());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendApp, setBackendApp] = useState<KissflowApplication | undefined>();

  useEffect(() => {
    if (!id || !isBackendApiMode()) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadApplicationFromBackend(id).then((result) => {
      if (cancelled) return;
      setBackendApp(result.application ?? undefined);
      setLoadError(result.error || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, appRevision]);

  const app = useMemo(() => {
    void appRevision;
    if (!id) return undefined;
    if (isBackendApiMode()) return backendApp;
    return getApplicationById(id);
  }, [id, appRevision, backendApp]);

  const tabs = useMemo(() => applicationDetailTabs(), []);

  const activeTab = useMemo(() => {
    const t = searchParams.get('tab') as TabId | null;
    if (t && tabs.some((tab) => tab.id === t)) return t;
    return defaultApplicationTab();
  }, [searchParams, tabs]);

  useEffect(() => {
    const requested = searchParams.get('tab') as TabId | null;
    if (requested && !tabs.some((tab) => tab.id === requested)) {
      setSearchParams({ tab: defaultApplicationTab() }, { replace: true });
    }
  }, [searchParams, setSearchParams, tabs]);

  const setTab = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  const runTabRefresh = () => {
    if (activeTab === 'dashboard') {
      setTabRefreshNonce((n) => n + 1);
      return;
    }
    if (activeTab === 'discovery') {
      void runHeaderSync();
      return;
    }
    // Soft remount / reload for other tabs
    setAppRevision((n) => n + 1);
  };

  const runHeaderSync = async () => {
    if (!app) return;
    setHeaderSyncing(true);
    setHeaderSyncError('');
    setTab('discovery');

    if (isBackendApiMode()) {
      const { syncAllFieldsOnBackend } = await import('@/services/fieldsApi');
      const processIds = (app.processIds || []).map((id) => id.trim()).filter(Boolean);
      const result =
        processIds.length > 1
          ? await syncAllFieldsOnBackend(app)
          : await syncFieldsOnBackend(app, processIds[0] || app.appId);
      if (!result.ok) {
        setHeaderSyncError(result.error || 'Sync failed');
        setHeaderSyncing(false);
        return;
      }
      if (result.failedProcesses?.length) {
        setHeaderSyncError(`Synced with warnings: ${result.failedProcesses.join('; ')}`);
      }
      setAppRevision((n) => n + 1);
      setHeaderSyncing(false);
      return;
    }

    const adminProcessId = (app.processIds || [])[0] || app.appId;
    const result = await syncFieldsFromAdminItems(app, { processId: adminProcessId });
    if (!result.ok) {
      setHeaderSyncError(result.error || 'Sync failed');
      setHeaderSyncing(false);
      return;
    }
    saveDiscoveredFields(app.id, result.fields, result.itemCount, {
      resourceId: adminProcessId,
      adminProcessId,
    });
    setAppRevision((n) => n + 1);
    setHeaderSyncing(false);
  };

  if (loading) {
    return (
      <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: 'Loading…' }]}>
        <div className="surface p-8 text-center text-sm text-foreground-500">Loading application…</div>
      </Layout>
    );
  }

  if (!app) {
    return (
      <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: 'Not found' }]}>
        <EmptyState
          variant="apps"
          title="Application not found"
          description={
            loadError ||
            'This application may have been removed. Go back and pick another one.'
          }
          primaryLabel="Back to applications"
          onPrimary={() => navigate('/applications')}
        />
      </Layout>
    );
  }

  const catalog = catalogEntryForApp(app);
  const iconClass = catalog?.icon || app.icon || 'ri-apps-line';
  const tint = catalog?.tint || 'bg-[#E8F3FC] text-[#0F6CBD]';

  return (
    <Layout
      breadcrumbs={[
        { label: 'Applications', path: '/applications' },
        { label: app.displayName || app.name },
      ]}
    >
      {/* Same dark header on every tab (dashboard pattern). */}
      <div className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 p-5 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.25),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.3),transparent_35%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tint} ring-1 ring-white/20`}>
              <i className={`${iconClass} text-2xl`} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{app.displayName || app.name}</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {app.status || 'Active'}
                </span>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/85 ring-1 ring-white/15">
                  Last synced{' '}
                  {app.lastSync && app.lastSync !== '—'
                    ? app.lastSync
                    : app.lastFieldSyncAt
                      ? new Date(app.lastFieldSyncAt).toLocaleString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-white/65">
                {app.subdomain}.kissflow.{app.region}
                {app.appId ? ` · ${app.appId}` : ''}
              </p>
              {headerSyncError ? (
                <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-rose-200">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {headerSyncError}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!isBackendApiMode() && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTab('settings')}
                leftIcon={<Pencil className="h-3.5 w-3.5" />}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                Edit
              </Button>
            )}
            {activeTab === 'dashboard' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={runTabRefresh}
                loading={headerRefreshing}
                leftIcon={!headerRefreshing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
                className="border-white/20 bg-sky-500/30 text-white hover:bg-sky-500/40"
              >
                Refresh dashboard
              </Button>
            ) : null}
            {activeTab === 'discovery' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={runHeaderSync}
                loading={headerSyncing}
                leftIcon={!headerSyncing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
                className="border-white/20 bg-emerald-500/30 text-white hover:bg-emerald-500/40"
              >
                Sync fields
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-4 overflow-x-auto pb-1">
        <div className="flex items-center gap-1 glass rounded-[18px] p-1.5 w-max min-w-full sm:min-w-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTab(tab.id)}
                className={`relative h-9 px-3 rounded-[12px] text-xs font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                  active ? 'text-white' : 'text-foreground-600 hover:bg-background-100/80 hover:text-foreground-900'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="app-detail-tab"
                    className="absolute inset-0 rounded-[12px] bg-primary-600 shadow-sm"
                    transition={springSnappy}
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: duration.fast, ease: easeOutSoft }}
        >
          {activeTab === 'overview' && <OverviewTab app={app} onNavigateTab={setTab} />}
          {activeTab === 'dashboard' && (
            <AppDashboardTab
              app={app}
              refreshNonce={tabRefreshNonce}
              onRefreshingChange={setHeaderRefreshing}
            />
          )}
          {activeTab === 'connection' && (
            <ConnectionTab app={app} onSaved={() => setAppRevision((n) => n + 1)} />
          )}
          {activeTab === 'discovery' && (
            <DiscoveryTab app={app} onSynced={() => setAppRevision((n) => n + 1)} />
          )}
          {activeTab === 'resources' && (
            <ResourcesTab app={app} onSynced={() => setAppRevision((n) => n + 1)} />
          )}
          {activeTab === 'engagement' && <EngagementTab app={app} />}
          {activeTab === 'templates' && <TemplatesTab app={app} />}
          {activeTab === 'schedulers' && <SchedulersTab app={app} />}
          {activeTab === 'history' && <HistoryTab app={app} />}
          {activeTab === 'settings' && (
            <SettingsTab app={app} onSaved={() => setAppRevision((n) => n + 1)} />
          )}
        </motion.div>
      </AnimatePresence>
    </Layout>
  );
}
