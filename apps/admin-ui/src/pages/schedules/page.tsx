import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Search } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import type { KissflowApplication } from '@/mocks/applications';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import { loadApplicationsFromBackend } from '@/services/applicationsApi';
import { describeBackendSchedule, loadSchedulesFromBackend } from '@/services/reportsApi';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import ScheduleRecipientsEditor from '@/pages/schedules/components/ScheduleRecipientsEditor';

type StatusFilter = 'all' | 'active' | 'paused';

const statusChip = (status: ReportScheduler['status']) =>
  status === 'active' ? 'chip-success' : 'chip-muted';

/** Every HTML report schedule across applications — To / Cc / Bcc only. */
export default function SchedulesPage() {
  const [apps, setApps] = useState<KissflowApplication[]>([]);
  const [schedules, setSchedules] = useState<ReportScheduler[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [appFilter, setAppFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    loadApplicationsFromBackend().then(async (appsResult) => {
      if (cancelled) return;
      const list = appsResult.applications || [];
      setApps(list);
      const errors: string[] = appsResult.error ? [appsResult.error] : [];
      const results = await Promise.all(list.map((app) => loadSchedulesFromBackend(app)));
      if (cancelled) return;
      const all: ReportScheduler[] = [];
      results.forEach((result, i) => {
        all.push(...result.schedulers);
        if (result.error) errors.push(`${list[i].displayName || list[i].name}: ${result.error}`);
      });
      all.sort((a, b) => a.name.localeCompare(b.name));
      setSchedules(all);
      setLoadError(errors.join(' · '));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const appById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const appName = (id: string) => appById.get(id)?.displayName || appById.get(id)?.name || 'App';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schedules.filter((s) => {
      if (appFilter && s.applicationId !== appFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return [s.name, s.templateName, ...s.recipients, ...s.cc, ...(s.bcc || [])]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [schedules, search, appFilter, statusFilter]);

  const selected = schedules.find((s) => s.id === selectedId) || null;
  const selectedApp = selected ? appById.get(selected.applicationId) || null : null;

  const handleSaved = (next: ReportScheduler) => {
    setSchedules((prev) => prev.map((s) => (s.id === next.id ? { ...s, ...next } : s)));
  };

  return (
    <Layout breadcrumbs={[{ label: 'Home', path: '/applications' }, { label: 'Schedules' }]}>
      <div className="mb-6">
        <h1 className="page-title">Schedules</h1>
        <p className="page-subtitle">
          Every HTML report schedule across applications. Open one to edit its To, Cc and Bcc.
        </p>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 break-words">
          {loadError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 flex-wrap">
        <div className="w-full sm:flex-1 sm:max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, template or email…"
            leftSlot={<Search className="w-4 h-4" />}
          />
        </div>
        <select
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          className="field-input !h-11 w-full sm:!w-auto sm:min-w-[200px]"
          aria-label="Application"
        >
          <option value="">All applications</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName || a.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 glass rounded-[14px] p-1 self-start">
          {(['all', 'active', 'paused'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`h-8 px-3 rounded-[10px] text-xs font-semibold capitalize cursor-pointer ${
                statusFilter === s ? 'bg-primary-600 text-white' : 'text-foreground-600 hover:bg-background-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start">
        {selected && selectedApp ? (
          <div className="order-first xl:order-last xl:sticky xl:top-4">
            <ScheduleRecipientsEditor
              app={selectedApp}
              schedule={selected}
              onSaved={handleSaved}
              onClose={() => setSelectedId('')}
            />
          </div>
        ) : null}

        <div className="min-w-0">
          {loading ? (
            <div className="surface p-8 text-center text-sm text-foreground-500">Loading schedules…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              variant="schedules"
              title={schedules.length ? 'No schedules for this filter' : 'No schedules yet'}
              description="Schedules are created from an application's Schedules tab."
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  aria-pressed={s.id === selectedId}
                  className={`surface p-4 text-left cursor-pointer min-w-0 hover:border-primary-300/70 ${
                    s.id === selectedId ? 'border-primary-400 ring-1 ring-primary-300' : ''
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="icon-well shrink-0">
                      <CalendarClock className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <h3 className="text-sm font-semibold text-foreground-900 break-words">{s.name}</h3>
                        <span className={`${statusChip(s.status)} capitalize`}>{s.status}</span>
                      </div>
                      <p className="text-xs text-foreground-500 break-words">
                        {s.templateName} · {describeBackendSchedule(s)}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-foreground-500 flex-wrap">
                        <span className="chip-muted">{appName(s.applicationId)}</span>
                        <span>To {s.recipients.length}</span>
                        <span>Cc {s.cc.length}</span>
                        <span>Bcc {(s.bcc || []).length}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
