import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, Plus, Search } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { getApplications } from '@/mocks/applications';
import {
  createScheduler,
  describeCadence,
  getSchedulers,
  type SchedulerStatus,
} from '@/stores/reportSchedulers';
import { getTemplatesByAppId } from '@/stores/reportTemplates';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';

export default function SchedulersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SchedulerStatus>('all');
  const [appFilter, setAppFilter] = useState(searchParams.get('app') || '');
  const [tick, setTick] = useState(0);

  const apps = useMemo(() => getApplications(), []);
  const schedulers = useMemo(() => {
    void tick;
    return getSchedulers();
  }, [tick]);

  const filtered = useMemo(() => {
    return schedulers.filter((s) => {
      if (appFilter && s.applicationId !== appFilter) return false;
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      const q = search.toLowerCase();
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.templateName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
  }, [schedulers, search, filterStatus, appFilter]);

  const appName = (id: string) =>
    apps.find((a) => a.id === id)?.displayName || apps.find((a) => a.id === id)?.name || 'App';

  const handleCreate = () => {
    if (!apps.length) {
      navigate('/applications');
      return;
    }
    const applicationId = appFilter || apps[0].id;
    const templates = getTemplatesByAppId(applicationId);
    const published = templates.find((t) => t.status === 'published') || templates[0];
    if (!published) {
      navigate(`/templates?app=${applicationId}`);
      return;
    }
    const sch = createScheduler({
      applicationId,
      name: `Schedule ${new Date().toLocaleDateString()}`,
      description: 'Send the chosen report template to selected people',
      templateId: published.id,
      templateName: published.name,
      cadence: { type: 'daily', time: '09:00' },
      recipients: [],
      status: 'draft',
    });
    setTick((n) => n + 1);
    navigate(`/schedulers/${sch.id}`);
  };

  return (
    <Layout breadcrumbs={[{ label: 'Home', path: '/applications' }, { label: 'Schedules' }]}>
      <div className="mb-7 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Schedules</h1>
          <p className="page-subtitle">
            Attach a published template to a cadence and choose who receives the report.
          </p>
        </div>
        <Button onClick={handleCreate} leftIcon={<Plus className="w-4 h-4" />}>
          New schedule
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search schedules…"
            leftSlot={<Search className="w-4 h-4" />}
          />
        </div>
        <select
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          className="field-input !w-auto !h-11 min-w-[180px]"
        >
          <option value="">All applications</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName || a.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 glass rounded-[14px] p-1">
          {(['all', 'active', 'paused', 'draft'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              className={`h-8 px-3 rounded-[10px] text-xs font-semibold capitalize cursor-pointer ${
                filterStatus === s ? 'bg-primary-600 text-white' : 'text-foreground-600 hover:bg-background-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {!apps.length ? (
        <EmptyState
          variant="apps"
          title="Connect an application first"
          description="Schedules are per Kissflow app — connect Lead Tracker or ITSM, add a template, then schedule it."
          primaryLabel="Connect application"
          onPrimary={() => navigate('/applications')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="schedules"
          title="No schedules yet"
          description="Create a schedule, pick an HTML template for that app, and add recipient emails."
          primaryLabel="New schedule"
          onPrimary={handleCreate}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((sch) => (
            <button
              key={sch.id}
              type="button"
              onClick={() => navigate(`/schedulers/${sch.id}`)}
              className="surface w-full p-4 text-left flex items-center gap-4 hover:border-primary-300/70 cursor-pointer"
            >
              <span className="icon-well">
                <CalendarClock className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground-900 truncate">{sch.name}</h3>
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
                  <span className="chip-muted">{appName(sch.applicationId)}</span>
                </div>
                <p className="text-xs text-foreground-500 mt-0.5">
                  {describeCadence(sch.cadence)} · Template: {sch.templateName}
                </p>
                <p className="text-[11px] text-foreground-400 mt-1">
                  {sch.recipients.length
                    ? `${sch.recipients.length} recipient${sch.recipients.length === 1 ? '' : 's'}`
                    : 'No recipients yet'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Layout>
  );
}
