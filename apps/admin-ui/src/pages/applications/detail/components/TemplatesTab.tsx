import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Plus } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import { getTemplatesByAppId, createTemplate, type ReportTemplate } from '@/stores/reportTemplates';
import { isBackendApiMode } from '@/services/backendApi';
import { createTemplateOnBackend, loadTemplatesFromBackend } from '@/services/reportsApi';
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
  const [creating, setCreating] = useState(false);
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

  useEffect(() => {
    if (!backendMode) return;
    const onFocus = () => setTick((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [backendMode]);

  const list = useMemo(() => {
    if (backendMode) return backendList;
    void tick;
    return getTemplatesByAppId(app.id);
  }, [app.id, backendList, backendMode, tick]);

  const handleCreate = async () => {
    if (backendMode) {
      setCreating(true);
      const result = await createTemplateOnBackend(app, {
        name: `${app.displayName || app.name} report`,
        description: `HTML report for ${app.displayName || app.name}`,
        subject: `{{ReportTitle}} — ${app.displayName || app.name}`,
        status: 'draft',
      });
      setCreating(false);
      if (!result.ok || !result.template) {
        setLoadError(result.error || 'Failed to create template');
        return;
      }
      navigate(`/templates/${result.template.id}?app=${encodeURIComponent(app.id)}`);
      return;
    }

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
            ? 'Create and edit HTML report templates stored in PostgreSQL.'
            : 'HTML report designs for this app only — create several, publish the best.'}
        </p>
        <Button
          size="sm"
          onClick={handleCreate}
          loading={creating}
          leftIcon={!creating ? <Plus className="w-4 h-4" /> : undefined}
        >
          New template
        </Button>
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

      {loading ? (
        <div className="surface p-8 text-center text-sm text-foreground-500">Loading templates…</div>
      ) : list.length === 0 ? (
        <EmptyState
          variant="templates"
          title="No templates for this app"
          description={
            backendMode
              ? 'Create an HTML email template for this application, then attach it to a schedule.'
              : 'Design an HTML email report. You can make multiple versions and choose one in Schedules.'
          }
          primaryLabel="Create template"
          onPrimary={handleCreate}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() =>
                navigate(
                  backendMode
                    ? `/templates/${tpl.id}?app=${encodeURIComponent(app.id)}`
                    : `/templates/${tpl.id}`,
                )
              }
              className="surface p-4 text-left hover:border-primary-300/70 cursor-pointer"
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
