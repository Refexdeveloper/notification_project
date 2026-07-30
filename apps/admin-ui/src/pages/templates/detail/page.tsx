import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Code2,
  Eye,
  Save,
  Trash2,
} from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { getApplicationById, getApplications } from '@/mocks/applications';
import {
  deleteTemplate,
  getTemplateById,
  renderPreviewHtml,
  updateTemplate,
} from '@/stores/reportTemplates';
import { isBackendApiMode } from '@/services/backendApi';
import { loadApplicationFromBackend } from '@/services/applicationsApi';
import {
  deleteTemplateOnBackend,
  loadTemplateFromBackend,
  updateTemplateOnBackend,
} from '@/services/reportsApi';
import type { KissflowApplication } from '@/mocks/applications';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const backendMode = isBackendApiMode();
  const appRouteId = searchParams.get('app') || '';

  const [loading, setLoading] = useState(backendMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendApp, setBackendApp] = useState<KissflowApplication | undefined>();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'archived'>('draft');
  const [applicationId, setApplicationId] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);

  const localExisting = !backendMode && id ? getTemplateById(id) : undefined;

  useEffect(() => {
    if (!backendMode || !id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);

      let app: KissflowApplication | undefined;
      if (appRouteId) {
        const appResult = await loadApplicationFromBackend(appRouteId);
        app = appResult.application || undefined;
        if (!app) {
          if (!cancelled) {
            setLoadError(appResult.error || 'Application not found');
            setLoading(false);
          }
          return;
        }
      }

      const result = await loadTemplateFromBackend(
        app || ({ id: appRouteId, environment: 'Production' } as KissflowApplication),
        id!,
      );

      if (cancelled) return;

      if (!result.ok || !result.template) {
        setLoadError(result.error || 'Template not found');
        setLoading(false);
        return;
      }

      if (app) setBackendApp(app);
      setApplicationId(app?.id || appRouteId);
      setName(result.template.name);
      setSubject(result.template.subject);
      setDescription(result.template.description);
      setHtml(result.template.html);
      setStatus(result.template.status);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [backendMode, id, appRouteId]);

  useEffect(() => {
    if (backendMode || !localExisting) return;
    setName(localExisting.name);
    setSubject(localExisting.subject);
    setDescription(localExisting.description);
    setHtml(localExisting.html);
    setStatus(localExisting.status);
    setApplicationId(localExisting.applicationId);
  }, [backendMode, localExisting]);

  const apps = useMemo(() => getApplications(), []);
  const app = backendMode
    ? backendApp
    : applicationId
      ? getApplicationById(applicationId)
      : undefined;

  const previewHtml = useMemo(() => renderPreviewHtml(html), [html]);

  const persist = useCallback(
    async (publish = false) => {
      if (!id) return;
      setSaving(true);
      setSaveMsg('');

      if (backendMode) {
        if (!backendApp && !appRouteId) {
          setLoadError('Missing application context. Open the template from an application tab.');
          setSaving(false);
          return;
        }

        const appForSave =
          backendApp ||
          ({ id: appRouteId, environment: 'Production' } as KissflowApplication);

        const result = await updateTemplateOnBackend(appForSave, id, {
          name,
          subject,
          description,
          html,
          status: publish ? 'published' : 'draft',
        });

        setSaving(false);
        if (!result.ok) {
          setLoadError(result.error || 'Save failed');
          return;
        }

        if (result.template) {
          setHtml(result.template.html);
          setStatus(result.template.status);
        } else if (publish) {
          setStatus('published');
        }

        setSaveMsg(publish ? 'Published' : 'Saved');
        setTimeout(() => setSaveMsg(''), 2000);
        return;
      }

      if (!localExisting) return;
      updateTemplate(id, {
        name,
        subject,
        description,
        html,
        applicationId,
        status: publish ? 'published' : 'draft',
      });
      setStatus(publish ? 'published' : 'draft');
      setSaveMsg(publish ? 'Published' : 'Saved');
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 2000);
    },
    [
      id,
      backendMode,
      backendApp,
      appRouteId,
      name,
      subject,
      description,
      html,
      applicationId,
      localExisting,
    ],
  );

  const handleDelete = async () => {
    if (!id || !confirm('Delete this template?')) return;

    if (backendMode) {
      const appForDelete =
        backendApp || ({ id: appRouteId, environment: 'Production' } as KissflowApplication);
      const result = await deleteTemplateOnBackend(appForDelete, id);
      if (!result.ok) {
        setLoadError(result.error || 'Delete failed');
        return;
      }
      navigate(appRouteId ? `/applications/${appRouteId}?tab=templates` : '/templates');
      return;
    }

    deleteTemplate(id);
    navigate('/templates');
  };

  if (loading) {
    return (
      <Layout breadcrumbs={[{ label: 'Templates', path: '/templates' }, { label: 'Loading…' }]}>
        <div className="surface p-8 text-center text-sm text-foreground-500">Loading template…</div>
      </Layout>
    );
  }

  if ((!backendMode && !localExisting) || (backendMode && loadError && !html)) {
    return (
      <Layout breadcrumbs={[{ label: 'Templates', path: '/templates' }, { label: 'Not found' }]}>
        <EmptyState
          variant="templates"
          title="Template not found"
          description={loadError || 'This template may have been deleted.'}
          primaryLabel="Back to templates"
          onPrimary={() =>
            navigate(appRouteId ? `/applications/${appRouteId}?tab=templates` : '/templates')
          }
        />
      </Layout>
    );
  }

  return (
    <Layout
      breadcrumbs={[
        { label: 'Templates', path: '/templates' },
        { label: name || 'Template' },
      ]}
    >
      <div className="mb-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate(appRouteId ? `/applications/${appRouteId}?tab=templates` : '/templates')
            }
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            Back
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-heading font-semibold text-foreground-950 truncate">{name}</h1>
            <p className="text-xs text-foreground-500">
              {app?.displayName || app?.name || 'Application'} ·{' '}
              <span className="capitalize">{status}</span>
              {backendMode && <span className="ml-1">· PostgreSQL</span>}
              {saveMsg && (
                <span className="ml-2 text-accent-700 font-semibold inline-flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {saveMsg}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex glass rounded-[12px] p-1">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`h-8 px-3 rounded-[10px] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                mode === 'edit' ? 'bg-primary-600 text-white' : 'text-foreground-600'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              HTML
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`h-8 px-3 rounded-[10px] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                mode === 'preview' ? 'bg-primary-600 text-white' : 'text-foreground-600'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Delete
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void persist(false)}
            loading={saving}
            leftIcon={!saving ? <Save className="w-3.5 h-3.5" /> : undefined}
          >
            Save draft
          </Button>
          <Button
            size="sm"
            onClick={() => void persist(true)}
            loading={saving}
            leftIcon={!saving ? <Check className="w-3.5 h-3.5" /> : undefined}
          >
            Publish
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="surface p-4 space-y-3.5 h-fit">
          <Input label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} hint="Use {{ReportTitle}} etc." />
          {!backendMode && (
            <div>
              <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Application</label>
              <select
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                className="field-input"
              >
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName || a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="field-input !h-auto py-2.5 resize-none"
              placeholder="When to use this design…"
            />
          </div>
          <div className="rounded-[14px] bg-background-50 border border-background-200/80 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400 mb-2">
              Placeholders
            </p>
            <p className="text-xs text-foreground-500 leading-relaxed">
              {'{{ReportTitle}} {{ReportDate}} {{WebsiteName}} {{TotalLeads}} {{OpenLeads}} {{ClosedLeads}} {{LeadTableHtml}} {{SignedInToday}}'}
            </p>
          </div>
        </div>

        <div className="surface overflow-hidden min-h-[560px] flex flex-col">
          {mode === 'edit' ? (
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full min-h-[560px] p-4 font-mono text-xs leading-relaxed bg-foreground-950 text-accent-100 outline-none resize-none border-0"
              aria-label="HTML template editor"
            />
          ) : (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={previewHtml}
              className="flex-1 w-full min-h-[560px] bg-white border-0"
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
