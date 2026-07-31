import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Plus, Search, Sparkles } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { getApplications } from '@/mocks/applications';
import type { KissflowApplication } from '@/mocks/applications';
import {
  createTemplate,
  getTemplates,
  type ReportTemplate,
  type TemplateStatus,
} from '@/stores/reportTemplates';
import { isBackendApiMode } from '@/services/backendApi';
import { loadApplicationsFromBackend } from '@/services/applicationsApi';
import { createTemplateOnBackend, loadTemplatesFromBackend } from '@/services/reportsApi';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';

const statusChip = (s: TemplateStatus) =>
  s === 'published' ? 'chip-success' : s === 'draft' ? 'chip-warn' : 'chip-muted';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appFilterParam = searchParams.get('app') || '';
  const backendMode = isBackendApiMode();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | TemplateStatus>('all');
  const [appFilter, setAppFilter] = useState(appFilterParam);
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(backendMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendApps, setBackendApps] = useState<KissflowApplication[]>([]);
  const [backendTemplates, setBackendTemplates] = useState<ReportTemplate[]>([]);

  useEffect(() => {
    if (!backendMode) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadApplicationsFromBackend().then(async (appsResult) => {
      if (cancelled) return;
      const apps = appsResult.applications || [];
      setBackendApps(apps);

      if (appsResult.error) {
        setLoadError(appsResult.error);
      }

      const all: ReportTemplate[] = [];
      for (const app of apps) {
        const tplResult = await loadTemplatesFromBackend(app);
        if (tplResult.templates?.length) {
          all.push(...tplResult.templates);
        }
      }

      if (!cancelled) {
        setBackendTemplates(all);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [backendMode, tick]);

  const apps = useMemo(() => {
    if (backendMode) return backendApps;
    return getApplications();
  }, [backendMode, backendApps, tick]);

  const templates = useMemo(() => {
    if (backendMode) return backendTemplates;
    void tick;
    return getTemplates();
  }, [backendMode, backendTemplates, tick]);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (appFilter && t.applicationId !== appFilter) return false;
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      const q = search.toLowerCase();
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [templates, search, filterStatus, appFilter]);

  const selectedPreview = filtered[0] as ReportTemplate | undefined;
  const appName = (id: string) =>
    apps.find((a) => a.id === id)?.displayName || apps.find((a) => a.id === id)?.name || 'App';

  const handleCreate = async () => {
    if (!apps.length) {
      navigate('/applications');
      return;
    }
    const applicationId = appFilter || apps[0].id;
    setCreating(true);

    if (backendMode) {
      const app = apps.find((a) => a.id === applicationId);
      if (!app) {
        setCreating(false);
        return;
      }
      const result = await createTemplateOnBackend(app, {
        name: `Report template ${new Date().toLocaleDateString()}`,
        description: 'HTML email report for this Kissflow app',
        subject: `{{ReportTitle}} — ${appName(applicationId)}`,
      });
      setCreating(false);
      if (result.ok && result.template) {
        setTick((n) => n + 1);
        navigate(`/templates/${result.template.id}?app=${app.id}`);
      } else {
        setLoadError(result.error || 'Failed to create template');
      }
      return;
    }

    const tpl = createTemplate({
      applicationId,
      name: `Report template ${new Date().toLocaleDateString()}`,
      description: 'HTML email report for this Kissflow app',
      subject: `{{ReportTitle}} — ${appName(applicationId)}`,
    });
    setCreating(false);
    setTick((n) => n + 1);
    navigate(`/templates/${tpl.id}`);
  };

  const openTemplate = (tpl: ReportTemplate) => {
    const appQuery = tpl.applicationId ? `?app=${encodeURIComponent(tpl.applicationId)}` : '';
    navigate(`/templates/${tpl.id}${appQuery}`);
  };

  return (
    <Layout breadcrumbs={[{ label: 'Home', path: '/applications' }, { label: 'Email templates' }]}>
      <div className="mb-7 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Email report templates</h1>
          <p className="page-subtitle">
            Create multiple HTML report designs per Kissflow app, then pick the best one for a
            schedule.
            {backendMode && <span className="ml-1 text-foreground-400">· PostgreSQL</span>}
          </p>
        </div>
        <Button loading={creating} onClick={() => void handleCreate()} leftIcon={<Plus className="w-4 h-4" />}>
          New template
        </Button>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-5 min-h-[520px]">
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex-1 max-w-sm">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
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
              {(['all', 'published', 'draft', 'archived'] as const).map((s) => (
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

          {loading ? (
            <div className="surface p-8 text-center text-sm text-foreground-500">Loading templates…</div>
          ) : !apps.length ? (
            <EmptyState
              variant="apps"
              title="Connect an application first"
              description="Templates belong to a Kissflow app. Add Lead Tracker, ITSM, or any app, then design its report emails."
              primaryLabel="Connect application"
              onPrimary={() => navigate('/applications')}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              variant="templates"
              title="No templates for this filter"
              description="Create an HTML report template for this app. You can make several and choose the best for your schedule."
              primaryLabel="New template"
              onPrimary={() => void handleCreate()}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filtered.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => openTemplate(tpl)}
                  className="surface p-4 text-left hover:border-primary-300/70 cursor-pointer group"
                >
                  <div className="flex items-start gap-3">
                    <span className="icon-well">
                      <Mail className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <h3 className="text-sm font-semibold text-foreground-900 truncate">{tpl.name}</h3>
                        <span className={`${statusChip(tpl.status)} capitalize`}>{tpl.status}</span>
                      </div>
                      <p className="text-xs text-foreground-500 line-clamp-2">
                        {tpl.description || 'HTML email report'}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-foreground-400">
                        <span className="chip-muted">{appName(tpl.applicationId)}</span>
                        <span>{tpl.variables.length} vars</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <GlassCard className="p-5 hidden xl:flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary-600" />
            <p className="text-xs font-bold uppercase tracking-wider text-foreground-400">How it works</p>
          </div>
          <ol className="space-y-3 text-sm text-foreground-600 leading-relaxed list-decimal list-inside">
            <li>Create several HTML designs for one app</li>
            <li>Use placeholders like {'{{SignInRate}}'}</li>
            <li>Publish the best one</li>
            <li>Attach it to a schedule with recipients</li>
          </ol>
          {selectedPreview && (
            <div className="mt-6 pt-4 border-t border-background-200/80">
              <p className="text-xs font-semibold text-foreground-500 mb-2">Latest in list</p>
              <p className="text-sm font-semibold text-foreground-900">{selectedPreview.name}</p>
              <p className="text-xs text-foreground-400 font-mono mt-1 truncate">{selectedPreview.subject}</p>
              <Button
                className="mt-4 w-full"
                variant="secondary"
                onClick={() => openTemplate(selectedPreview)}
              >
                Open editor
              </Button>
            </div>
          )}
        </GlassCard>
      </div>
    </Layout>
  );
}
