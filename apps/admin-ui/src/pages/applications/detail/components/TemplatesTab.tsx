import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Plus } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import { getTemplatesByAppId, createTemplate, type ReportTemplate } from '@/stores/reportTemplates';
import { isBackendApiMode } from '@/services/backendApi';
import { loadTemplatesFromBackend } from '@/services/reportsApi';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface TemplatesTabProps {
  app: KissflowApplication;
}

export default function TemplatesTab({ app }: TemplatesTabProps) {
  const navigate = useNavigate();
  const backendMode = isBackendApiMode();
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(backendMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [backendList, setBackendList] = useState<ReportTemplate[]>([]);

  useEffect(() => {
    if (!backendMode) return;
    let cancelled = false;
    setLoading(true);
    loadTemplatesFromBackend(app).then((result) => {
      if (cancelled) return;
      setBackendList(result.templates);
      setLoadError(result.error || null);
      setLoadWarning(result.warning || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [app, backendMode, tick]);

  const list = useMemo(() => {
    if (backendMode) return backendList;
    void tick;
    return getTemplatesByAppId(app.id);
  }, [app.id, backendList, backendMode, tick]);

  const handleCreate = () => {
    const tpl = createTemplate({
      applicationId: app.id,
      name: `${app.displayName || app.name} report`,
      description: `HTML report for ${app.displayName || app.name}`,
    });
    setTick((n) => n + 1);
    navigate(`/templates/${tpl.id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-foreground-500">
          {backendMode
            ? 'Report templates stored in PostgreSQL (engagement_reporting.report_template).'
            : 'HTML report designs for this app only — create several, publish the best.'}
        </p>
        {!backendMode && (
          <Button size="sm" onClick={handleCreate} leftIcon={<Plus className="w-4 h-4" />}>
            New template
          </Button>
        )}
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not load templates from backend-api: {loadError}
        </div>
      )}
      {loadWarning && !loadError && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {loadWarning}
        </div>
      )}
      {backendMode && !loading && list.length === 0 && !loadError && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No templates in PostgreSQL yet. Pipeline HTML reports are generated separately; template
          migration from the MySQL prototype is the next convergence step.
        </div>
      )}

      {loading ? (
        <div className="surface p-8 text-center text-sm text-foreground-500">Loading templates…</div>
      ) : list.length === 0 ? (
        <EmptyState
          variant="templates"
          title="No templates for this app"
          description={
            backendMode
              ? 'Templates will appear here once report_template rows exist for this application.'
              : 'Design an HTML email report. You can make multiple versions and choose one in Schedules.'
          }
          primaryLabel={backendMode ? undefined : 'Create template'}
          onPrimary={backendMode ? undefined : handleCreate}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => !backendMode && navigate(`/templates/${tpl.id}`)}
              disabled={backendMode}
              className="surface p-4 text-left hover:border-primary-300/70 cursor-pointer disabled:cursor-default disabled:opacity-90"
            >
              <div className="flex items-start gap-3">
                <span className="icon-well">
                  <Mail className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground-900 truncate">{tpl.name}</h4>
                    <span
                      className={
                        tpl.status === 'published'
                          ? 'chip-success'
                          : tpl.status === 'draft'
                            ? 'chip-warn'
                            : 'chip-muted'
                      }
                    >
                      {tpl.status}
                    </span>
                  </div>
                  <p className="text-xs text-foreground-500 mt-0.5 line-clamp-2">
                    {tpl.description || tpl.subject}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
