import { useEffect, useState } from 'react';
import type { KissflowApplication } from '@/mocks/applications';
import { buildResourcesFromApp } from '../utils/buildResources';
import { getConnection } from '@/mocks/connection';
import { getTemplatesByAppId } from '@/stores/reportTemplates';
import { getSchedulersByAppId } from '@/stores/reportSchedulers';
import { isBackendApiMode } from '@/services/backendApi';
import { loadSchedulesFromBackend, loadTemplatesFromBackend } from '@/services/reportsApi';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import type { ReportTemplate } from '@/stores/reportTemplates';

interface OverviewTabProps {
  app: KissflowApplication;
  onNavigateTab: (tab: string) => void;
}

export default function OverviewTab({ app, onNavigateTab }: OverviewTabProps) {
  const backendMode = isBackendApiMode();
  const [backendTemplates, setBackendTemplates] = useState<ReportTemplate[]>([]);
  const [backendSchedules, setBackendSchedules] = useState<ReportScheduler[]>([]);

  useEffect(() => {
    if (!backendMode) return;
    let cancelled = false;
    Promise.all([loadTemplatesFromBackend(app), loadSchedulesFromBackend(app)]).then(
      ([templatesRes, schedulesRes]) => {
        if (cancelled) return;
        setBackendTemplates(templatesRes.templates);
        setBackendSchedules(schedulesRes.schedulers);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [app, backendMode]);

  const resources = buildResourcesFromApp(app);
  const connection = getConnection(app.id);
  const templates = backendMode ? backendTemplates : getTemplatesByAppId(app.id);
  const schedules = backendMode ? backendSchedules : getSchedulersByAppId(app.id);
  const fieldCount = app.discoveredFields?.length ?? 0;
  const processCount = backendMode ? (app.processesCount ?? app.processIds?.length ?? 0) : resources.length;
  const isConnected = backendMode
    ? app.connected !== false
    : app.connected || connection.lastTestStatus === 'success';
  const published = templates.filter((t) => t.status === 'published').length;

  const nextSteps = [
    {
      done: isConnected,
      title: backendMode ? 'Application registered' : 'Connect Kissflow',
      hint: backendMode ? 'Stored in PostgreSQL with process links' : 'Test your access keys',
      tab: backendMode ? 'engagement' : 'connection',
      icon: backendMode ? 'ri-database-2-line' : 'ri-plug-line',
    },
    {
      done: fieldCount > 0,
      title: 'Sync fields',
      hint: 'Pull fields for report placeholders',
      tab: 'discovery',
      icon: 'ri-radar-line',
    },
    {
      done: templates.length > 0,
      title: 'Create HTML templates',
      hint: 'Design report emails for this app',
      tab: 'templates',
      icon: 'ri-mail-open-line',
    },
    {
      done: schedules.some((s) => s.status === 'active'),
      title: 'Schedule & recipients',
      hint: 'Pick a template and who gets it',
      tab: 'schedulers',
      icon: 'ri-calendar-schedule-line',
    },
  ];

  return (
    <div className="space-y-5">
      {backendMode && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Backend mode: templates, schedules, users, and field sync use PostgreSQL via backend-api.
          Connect and Processes workspace tabs are hidden; use App settings for metadata and Sync fields for processes.
          API keys are stored in GCP Secret Manager (not displayed in the UI).
        </div>
      )}

      <div className="surface p-5">
        <div className="mb-4">
          <h3 className="text-base font-heading font-semibold text-foreground-950">Get started</h3>
          <p className="text-xs text-foreground-500 mt-0.5">
            Sync fields → design templates → configure schedules and recipients.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {nextSteps.map((step, i) => (
            <button
              key={step.tab}
              type="button"
              onClick={() => onNavigateTab(step.tab)}
              className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer hover:-translate-y-0.5 ${
                step.done
                  ? 'border-accent-200 bg-accent-50/60'
                  : 'border-background-300/80 bg-background-50 hover:border-primary-300 hover:bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    step.done ? 'bg-accent-100 text-accent-800' : 'bg-primary-50 text-primary-700'
                  }`}
                >
                  <i className={step.done ? 'ri-checkbox-circle-fill' : step.icon}></i>
                </span>
                <span className="text-[10px] font-bold text-foreground-400">STEP {i + 1}</span>
              </div>
              <p className="text-sm font-semibold text-foreground-900">{step.title}</p>
              <p className="text-xs text-foreground-500 mt-0.5">{step.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label={backendMode ? 'Processes' : 'Resources'}
          value={processCount}
          onClick={() => onNavigateTab(backendMode ? 'discovery' : 'resources')}
        />
        <StatCard label="Fields synced" value={fieldCount} onClick={() => onNavigateTab('discovery')} />
        <StatCard label="Kissflow users" value="→" onClick={() => onNavigateTab('engagement')} />
        <StatCard label="Templates" value={templates.length} onClick={() => onNavigateTab('templates')} />
        <StatCard label="Published" value={published} onClick={() => onNavigateTab('templates')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-heading font-semibold text-foreground-950">App details</h3>
            {!backendMode && (
              <button
                type="button"
                onClick={() => onNavigateTab('settings')}
                className="text-xs font-semibold text-primary-700 cursor-pointer"
              >
                Edit
              </button>
            )}
            {backendMode && (
              <button
                type="button"
                onClick={() => onNavigateTab('settings')}
                className="text-xs font-semibold text-primary-700 cursor-pointer"
              >
                App settings
              </button>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Account" value={app.accountId} />
            <Row label="Application ID" value={app.appId || '—'} />
            <Row
              label="Process"
              value={(app.processIds || [])[0] || '—'}
            />
            <Row label="Host" value={`${app.subdomain}.kissflow.${app.region}`} />
            <Row label="Schedules" value={String(schedules.length)} />
          </div>
        </div>
        <div className="surface p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-heading font-semibold text-foreground-950">Health</h3>
            {!backendMode && (
              <button
                type="button"
                onClick={() => onNavigateTab('connection')}
                className="text-xs font-semibold text-primary-700 cursor-pointer"
              >
                Check connection
              </button>
            )}
          </div>
          <div className="space-y-3 text-sm">
            <Row label="Registration" value={isConnected ? 'Ready' : 'Needs setup'} ok={isConnected} />
            <Row
              label="Active schedules"
              value={String(schedules.filter((s) => s.status === 'active').length)}
            />
            <Row label="Environment" value={app.environment} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, onClick }: { label: string; value: number | string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="surface p-4 text-left cursor-pointer hover:border-primary-300/80 hover:-translate-y-0.5 transition-all"
    >
      <span className="text-xs font-semibold text-foreground-500">{label}</span>
      <p className="text-2xl font-heading font-semibold text-foreground-950 mt-1">{value}</p>
    </button>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground-500">{label}</span>
      <span
        className={`font-semibold ${
          ok === true ? 'text-accent-700' : ok === false ? 'text-red-700' : 'text-foreground-900'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
