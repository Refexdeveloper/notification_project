import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Plus } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import {
  createScheduler,
  describeCadence,
  getSchedulersByAppId,
  type ReportScheduler,
} from '@/stores/reportSchedulers';
import { getTemplatesByAppId } from '@/stores/reportTemplates';
import { isBackendApiMode } from '@/services/backendApi';
import {
  createScheduleOnBackend,
  describeBackendSchedule,
  loadSchedulesFromBackend,
  loadTemplatesFromBackend,
} from '@/services/reportsApi';
import BackendScheduleEditor from './BackendScheduleEditor';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface SchedulersTabProps {
  app: KissflowApplication;
}

export default function SchedulersTab({ app }: SchedulersTabProps) {
  const navigate = useNavigate();
  const backendMode = isBackendApiMode();
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(backendMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [backendList, setBackendList] = useState<ReportScheduler[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!backendMode) return;
    let cancelled = false;
    setLoading(true);
    loadSchedulesFromBackend(app).then((result) => {
      if (cancelled) return;
      setBackendList(result.schedulers);
      setLoadError(result.error || null);
      setLoadWarning(result.warning || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [app, backendMode, tick]);

  useEffect(() => {
    if (!backendMode) return;
    const onFocus = () => setTick((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [backendMode]);

  const list = useMemo(() => {
    if (backendMode) return backendList;
    void tick;
    return getSchedulersByAppId(app.id);
  }, [app.id, backendList, backendMode, tick]);

  const handleCreate = async () => {
    if (backendMode) {
      setCreating(true);
      setLoadError(null);
      const templatesRes = await loadTemplatesFromBackend(app);
      const published =
        templatesRes.templates.find((t) => t.status === 'published') || templatesRes.templates[0];
      if (!published) {
        setCreating(false);
        navigate(`/applications/${app.id}?tab=templates`);
        return;
      }
      const result = await createScheduleOnBackend(app, {
        name: `${app.displayName || app.name} schedule`,
        template_id: published.id,
        template_name: published.name,
        cron_expression: '0 9 * * *',
        timezone: 'Asia/Kolkata',
        is_active: false,
      });
      setCreating(false);
      if (!result.ok || !result.schedule) {
        setLoadError(result.error || 'Failed to create schedule');
        return;
      }
      setTick((n) => n + 1);
      setSelectedId(result.schedule.id);
      return;
    }

    const templates = getTemplatesByAppId(app.id);
    const published = templates.find((t) => t.status === 'published') || templates[0];
    if (!published) {
      navigate(`/applications/${app.id}?tab=templates`);
      return;
    }
    const sch = createScheduler({
      applicationId: app.id,
      name: `${app.displayName || app.name} schedule`,
      templateId: published.id,
      templateName: published.name,
      cadence: { type: 'daily', time: '09:00' },
    });
    setTick((n) => n + 1);
    navigate(`/schedulers/${sch.id}`);
  };

  const cadenceLabel = (sch: ReportScheduler) =>
    backendMode ? describeBackendSchedule(sch) : describeCadence(sch.cadence);

  const selected = list.find((sch) => sch.id === selectedId);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-foreground-500">
          {backendMode
            ? 'Schedules, send times, and recipients are stored in PostgreSQL. Click a schedule to edit timing and email settings.'
            : 'Bind a template for this app to a cadence and recipients.'}
        </p>
        {!backendMode && (
          <Button size="sm" onClick={handleCreate} leftIcon={<Plus className="w-4 h-4" />}>
            New schedule
          </Button>
        )}
        {backendMode && (
          <Button
            size="sm"
            disabled={creating}
            onClick={() => void handleCreate()}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            {creating ? 'Creating…' : 'New schedule'}
          </Button>
        )}
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not load schedules from backend-api: {loadError}
        </div>
      )}
      {loadWarning && !loadError && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {loadWarning}
        </div>
      )}

      {loading ? (
        <div className="surface p-8 text-center text-sm text-foreground-500">Loading schedules…</div>
      ) : list.length === 0 ? (
        <EmptyState
          variant="schedules"
          title="No schedules for this app"
          description={
            backendMode
              ? 'Schedules will appear here once report_schedule rows exist for this application.'
              : 'Publish an HTML template first, then schedule it to chosen people.'
          }
          primaryLabel={backendMode ? 'New schedule' : undefined}
          onPrimary={backendMode ? () => void handleCreate() : undefined}
        />
      ) : (
        <div className="space-y-2">
          {list.map((sch) => (
            <button
              key={sch.id}
              type="button"
              onClick={() => {
                if (backendMode) {
                  setSelectedId((current) => (current === sch.id ? null : sch.id));
                  return;
                }
                navigate(`/schedulers/${sch.id}`);
              }}
              className={`surface w-full p-4 text-left flex items-center gap-3 hover:border-primary-300/70 cursor-pointer ${
                backendMode && selectedId === sch.id ? 'border-primary-400 ring-1 ring-primary-200' : ''
              }`}
            >
              <span className="icon-well">
                <CalendarClock className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground-900 truncate">{sch.name}</h4>
                  <span
                    className={
                      sch.status === 'active'
                        ? 'chip-success'
                        : sch.status === 'paused'
                          ? 'chip-warn'
                          : 'chip-muted'
                    }
                  >
                    {sch.status}
                  </span>
                </div>
                <p className="text-xs text-foreground-500 mt-0.5">
                  {cadenceLabel(sch)} · {sch.templateName} · {sch.recipients.length} recipients
                  {backendMode && sch.fromEmail ? ` · from ${sch.fromEmail}` : ''}
                  {backendMode && sch.websiteFilter ? ` · ${sch.websiteFilter}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {backendMode && selected && (
        <div className="mt-4">
          <BackendScheduleEditor
            app={app}
            schedule={selected}
            onUpdated={() => setTick((n) => n + 1)}
            onDeleted={() => {
              setSelectedId(null);
              setTick((n) => n + 1);
            }}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}
