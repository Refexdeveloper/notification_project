import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Home,
  Plug,
  Radar,
  Layers,
  Mail,
  CalendarClock,
  History,
  Settings,
  RefreshCw,
  Pencil,
  AlertCircle,
  Users,
} from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { getApplicationById, saveDiscoveredFields } from '@/mocks/applications';
import { syncFieldsFromAdminItems } from '@/services/fieldDiscovery';
import OverviewTab from './components/OverviewTab';
import ConnectionTab from './components/ConnectionTab';
import DiscoveryTab from './components/DiscoveryTab';
import ResourcesTab from './components/ResourcesTab';
import TemplatesTab from './components/TemplatesTab';
import SchedulersTab from './components/SchedulersTab';
import HistoryTab from './components/HistoryTab';
import SettingsTab from './components/SettingsTab';
import EngagementTab from './components/EngagementTab';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { LucideIcon } from 'lucide-react';
import { duration, easeOutSoft, springSnappy } from '@/lib/motion';
import { catalogEntryForApp } from '@/seeds/refexAppCatalog';
const TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'connection', label: 'Connect', icon: Plug },
  { id: 'discovery', label: 'Sync fields', icon: Radar },
  { id: 'resources', label: 'Processes', icon: Layers },
  { id: 'engagement', label: 'Users', icon: Users },
  { id: 'templates', label: 'Templates', icon: Mail },
  { id: 'schedulers', label: 'Schedules', icon: CalendarClock },
  { id: 'history', label: 'Sent', icon: History },
  { id: 'settings', label: 'App settings', icon: Settings },
];

type TabId = (typeof TABS)[number]['id'];

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [appRevision, setAppRevision] = useState(0);
  const [headerSyncing, setHeaderSyncing] = useState(false);
  const [headerSyncError, setHeaderSyncError] = useState('');

  const app = useMemo(() => {
    void appRevision;
    return id ? getApplicationById(id) : undefined;
  }, [id, appRevision]);

  const activeTab = useMemo(() => {
    const t = searchParams.get('tab') as TabId | null;
    return TABS.some((tab) => tab.id === t) ? (t as TabId) : 'overview';
  }, [searchParams]);

  const setTab = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  const runHeaderSync = async () => {
    if (!app) return;
    setHeaderSyncing(true);
    setHeaderSyncError('');
    setTab('discovery');
    const result = await syncFieldsFromAdminItems(app);
    if (!result.ok) {
      setHeaderSyncError(result.error || 'Sync failed');
      setHeaderSyncing(false);
      return;
    }
    saveDiscoveredFields(app.id, result.fields, result.itemCount, {
      resourceId: (app.processIds || [])[0],
      adminProcessId: (app.appId || '').trim(),
    });
    setAppRevision((n) => n + 1);
    setHeaderSyncing(false);
  };

  if (!app) {
    return (
      <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: 'Not found' }]}>
        <EmptyState
          variant="apps"
          title="Application not found"
          description="This application may have been removed. Go back and pick another one."
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
      <div className="surface p-5 mb-5 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_0%_0%,oklch(var(--primary-50)/0.9),transparent_55%)]" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div
              className={`w-14 h-14 rounded-[18px] flex items-center justify-center shrink-0 ${tint}`}
            >
              <i className={`${iconClass} text-2xl`} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-foreground-950 font-heading tracking-tight truncate">
                  {app.displayName || app.name}
                </h1>
                <span className="chip-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />
                  {app.status}
                </span>
                <span className="chip-primary">{app.environment}</span>
                {app.discoveredFields && app.discoveredFields.length > 0 && (
                  <span className="chip-muted">{app.discoveredFields.length} fields synced</span>
                )}
              </div>
              <p className="text-sm text-foreground-500 mt-1 truncate">
                {app.subdomain}.kissflow.{app.region}
                {app.appId ? ` · ${app.appId}` : ''}
              </p>
              {headerSyncError && (
                <p className="text-xs text-red-700 font-medium mt-1.5 inline-flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {headerSyncError}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => setTab('settings')} leftIcon={<Pencil className="w-3.5 h-3.5" />}>
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={runHeaderSync}
              loading={headerSyncing}
              leftIcon={!headerSyncing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
            >
              Sync fields
            </Button>
            <Button size="sm" onClick={() => setTab('templates')} leftIcon={<Mail className="w-3.5 h-3.5" />}>
              New template
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-5 overflow-x-auto pb-1">
        <div className="flex items-center gap-1 glass rounded-[18px] p-1.5 w-max min-w-full sm:min-w-0">
          {TABS.map((tab) => {
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
