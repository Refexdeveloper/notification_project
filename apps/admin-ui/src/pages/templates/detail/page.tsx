import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Code2,
  Eye,
  History,
  LayoutTemplate,
  PanelsTopBottom,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { getApplicationById, getApplications } from '@/mocks/applications';
import {
  deleteTemplate,
  extractVariables,
  getTemplateById,
  renderPreviewHtml,
  updateTemplate,
} from '@/stores/reportTemplates';
import {
  detectTemplateAppKind,
  type PreviewContext,
} from '@/lib/templatePreview';
import { ensureItsmSourcePlaceholders, preferExtrovisStarter } from '@/lib/itsmTemplateLayout';
import { isBackendApiMode } from '@/services/backendApi';
import { loadApplicationFromBackend } from '@/services/applicationsApi';
import {
  deleteTemplateOnBackend,
  generateTemplateHtmlOnBackend,
  loadReportStarterHtmlFromBackend,
  loadTemplateFromBackend,
  loadTemplateUsageFromBackend,
  loadTemplateVersionFromBackend,
  loadTemplateVersionsFromBackend,
  testSendScheduleOnBackend,
  updateTemplateOnBackend,
  type PipelineSyncResult,
} from '@/services/reportsApi';
import VersionHistory from '@/pages/templates/detail/components/VersionHistory';
import TestEmailDialog from '@/pages/templates/detail/components/TestEmailDialog';
import PlaceholderPicker from '@/pages/templates/detail/components/PlaceholderPicker';
import AiGeneratePanel from '@/pages/templates/detail/components/AiGeneratePanel';
import StarterPickerModal from '@/pages/templates/components/StarterPickerModal';
import type { TemplateVersion } from '@/mocks/templates';
import {
  formatSchedulersInUseMessage,
  getSchedulersByTemplateId,
} from '@/stores/reportSchedulers';
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
  const [pipelineMsg, setPipelineMsg] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionHistory, setVersionHistory] = useState<TemplateVersion[]>([]);
  const [currentVersionNumber, setCurrentVersionNumber] = useState(0);
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const htmlEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const subjectInputRef = useRef<HTMLInputElement | null>(null);

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
      const kind = detectTemplateAppKind({
        kissflowAppId: app?.appId || appRouteId,
        applicationId: app?.id || appRouteId,
      });
      const rawHtml = result.template.html || '';
      setHtml(kind === 'itsm' ? ensureItsmSourcePlaceholders(rawHtml).html : rawHtml);
      setStatus(result.template.status);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [backendMode, id, appRouteId]);

  const reloadVersionHistory = useCallback(async () => {
    if (!backendMode || !id) return;
    const appForVersions =
      backendApp || ({ id: appRouteId, environment: 'Production' } as KissflowApplication);
    if (!appForVersions.id && !appRouteId) return;

    setVersionsLoading(true);
    const result = await loadTemplateVersionsFromBackend(appForVersions, id);
    setVersionsLoading(false);

    if (!result.ok) return;

    setCurrentVersionNumber(result.currentVersion || 0);
    setVersionHistory(
      (result.versions || []).map((v) => ({
        id: `v${v.version_number}`,
        version: v.version_number,
        author: 'engagement_reporting',
        timestamp: v.created_at,
        message: v.checksum ? `Saved · ${v.checksum.slice(0, 8)}…` : 'Saved version',
        blocks: [],
      })),
    );
  }, [backendMode, id, backendApp, appRouteId]);

  useEffect(() => {
    if (!backendMode || !id || loading) return;
    void reloadVersionHistory();
  }, [backendMode, id, loading, reloadVersionHistory]);

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

  const previewContext = useMemo<PreviewContext>(
    () => ({
      templateName: name,
      subject,
      kissflowAppId: app?.appId || applicationId,
      applicationId,
    }),
    [name, subject, app?.appId, applicationId],
  );

  const previewHtml = useMemo(
    () => renderPreviewHtml(html, previewContext),
    [html, previewContext],
  );

  const previewSubject = useMemo(
    () => renderPreviewHtml(subject || name, previewContext),
    [subject, name, previewContext],
  );

  const previewKey = useMemo(
    () => `${name}::${subject}::${html.length}::${html.slice(0, 120)}`,
    [name, subject, html],
  );

  const placeholderHints = useMemo(() => extractVariables(html, subject), [html, subject]);

  const appKind = useMemo(() => detectTemplateAppKind(previewContext), [previewContext]);

  const applyLatestItsmLayout = useCallback(async () => {
    if (!backendMode || !id) return;
    const appForSave =
      backendApp || ({ id: appRouteId, environment: 'Production' } as KissflowApplication);
    if (!appForSave.id && !appRouteId) {
      setLoadError('Missing application context. Open the template from an application tab.');
      return;
    }
    const starterId = preferExtrovisStarter(name) ? 'itsm-extrovis' : 'itsm';
    if (
      !window.confirm(
        `Replace this template HTML with the latest ${
          starterId === 'itsm-extrovis' ? 'Extrovis' : 'Refex ITSM'
        } layout (includes Ticket source panels)?`,
      )
    ) {
      return;
    }
    setLayoutBusy(true);
    setLoadError(null);
    setSaveMsg('');
    const starter = await loadReportStarterHtmlFromBackend(appForSave, starterId);
    if (!starter.ok || !starter.item?.html) {
      setLoadError(starter.error || 'Could not load starter layout');
      setLayoutBusy(false);
      return;
    }
    const nextHtml = ensureItsmSourcePlaceholders(starter.item.html).html;
    setHtml(nextHtml);
    const updated = await updateTemplateOnBackend(appForSave, id, {
      html: nextHtml,
      description:
        starterId === 'itsm-extrovis'
          ? 'Extrovis ITSM report — tickets only (no user sign-in overview)'
          : description || 'ITSM engagement report with ticket source breakdown',
      status: status === 'published' ? 'published' : undefined,
    });
    setLayoutBusy(false);
    if (!updated.ok) {
      setLoadError(updated.error || 'Failed to save updated layout');
      return;
    }
    setSaveMsg(
      `Applied ${starterId === 'itsm-extrovis' ? 'Extrovis' : 'Refex ITSM'} layout with Ticket source. Preview updated — Publish if still draft.`,
    );
    setMode('preview');
  }, [backendMode, id, backendApp, appRouteId, name, description, status]);

  const insertPlaceholder = useCallback((token: string, target: 'html' | 'subject') => {
    if (target === 'subject') {
      const el = subjectInputRef.current;
      if (el) {
        const start = el.selectionStart ?? subject.length;
        const end = el.selectionEnd ?? start;
        const next = `${subject.slice(0, start)}${token}${subject.slice(end)}`;
        setSubject(next);
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + token.length;
          el.setSelectionRange(pos, pos);
        });
        return;
      }
      setSubject((prev) => `${prev}${token}`);
      return;
    }

    const el = htmlEditorRef.current;
    if (el) {
      const start = el.selectionStart ?? html.length;
      const end = el.selectionEnd ?? start;
      const next = `${html.slice(0, start)}${token}${html.slice(end)}`;
      setHtml(next);
      if (mode === 'preview') setMode('split');
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    setHtml((prev) => `${prev}\n${token}`);
    if (mode === 'preview') setMode('split');
  }, [html, subject, mode]);

  const formatPipelineSync = (sync?: PipelineSyncResult) => {
    if (!sync) return '';
    const parts: string[] = [];
    if (sync.synced) {
      parts.push(`pipeline synced${sync.path ? ` → ${sync.path}` : ''}`);
    } else if (sync.reason) {
      parts.push(`pipeline: ${sync.reason}`);
    }
    if (sync.cache_invalidation?.deleted != null) {
      parts.push(`cleared ${sync.cache_invalidation.deleted} cached report(s)`);
    }
    if (sync.cache_invalidation?.error) {
      parts.push(`cache clear error: ${sync.cache_invalidation.error}`);
    }
    if (sync.schedule_subject_sync?.updated != null && sync.schedule_subject_sync.updated > 0) {
      parts.push(`updated ${sync.schedule_subject_sync.updated} schedule subject(s)`);
    }
    return parts.join(' · ');
  };

  const persist = useCallback(
    async (publish = false): Promise<boolean> => {
      if (!id) return false;
      setSaving(true);
      setSaveMsg('');
      setPipelineMsg('');
      setLoadError(null);

      if (backendMode) {
        if (!backendApp && !appRouteId) {
          setLoadError('Missing application context. Open the template from an application tab.');
          setSaving(false);
          return false;
        }

        const appForSave =
          backendApp ||
          ({ id: appRouteId, environment: 'Production' } as KissflowApplication);

        // Always send full editor payload. On publish (or when already published), keep status published
        // so HTML edits immediately become the live email template.
        const payload: {
          name: string;
          subject: string;
          description: string;
          html: string;
          status: 'draft' | 'published';
        } = {
          name,
          subject,
          description,
          html,
          status: publish || status === 'published' ? 'published' : 'draft',
        };
        if (publish) payload.status = 'published';

        const result = await updateTemplateOnBackend(appForSave, id, payload);

        setSaving(false);
        if (!result.ok) {
          setLoadError(result.error || 'Save failed');
          return false;
        }

        if (result.template) {
          setName(result.template.name);
          setSubject(result.template.subject);
          setDescription(result.template.description);
          setHtml(result.template.html);
          setStatus(result.template.status);
        } else if (publish) {
          setStatus('published');
        }

        const live = publish || payload.status === 'published';
        setSaveMsg(
          publish
            ? 'Published — next test/scheduled send will use this HTML'
            : live
              ? 'Saved (live published template updated)'
              : 'Saved draft',
        );
        if (live && result.pipelineSync) {
          setPipelineMsg(formatPipelineSync(result.pipelineSync));
        }
        void reloadVersionHistory();
        setTimeout(() => {
          setSaveMsg('');
          setPipelineMsg('');
        }, live ? 8000 : 2500);
        return true;
      }

      if (!localExisting) return false;
      const patch: Parameters<typeof updateTemplate>[1] = {
        name,
        subject,
        description,
        html,
        applicationId,
      };
      if (publish) {
        patch.status = 'published';
      } else if (status !== 'published') {
        patch.status = 'draft';
      }
      updateTemplate(id, patch);
      if (publish) {
        setStatus('published');
      }
      setSaveMsg(publish ? 'Published' : 'Saved');
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 2000);
      return true;
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
      status,
      reloadVersionHistory,
    ],
  );

  const handleRestoreVersion = async (version: TemplateVersion) => {
    if (!id || !backendMode) return;
    if (
      !window.confirm(
        `Restore v${version.version} into the editor? Save draft to persist — this does not auto-publish.`,
      )
    ) {
      return;
    }

    const appForRestore =
      backendApp || ({ id: appRouteId, environment: 'Production' } as KissflowApplication);
    const result = await loadTemplateVersionFromBackend(appForRestore, id, version.version);
    if (!result.ok || !result.html) {
      setLoadError(result.error || 'Failed to load version');
      return;
    }
    setHtml(result.html);
    setSaveMsg(`Loaded v${version.version} — save draft to persist`);
    setTimeout(() => setSaveMsg(''), 4000);
  };

  const handleTestEmailSend = async (recipient: string) => {
    if (!id || !backendMode) {
      return { ok: false, error: 'Test email requires backend API mode' };
    }

    const appForTest =
      backendApp || ({ id: appRouteId, environment: 'Production' } as KissflowApplication);

    // Always publish current editor HTML before test send so the email matches the preview.
    const publishedOk = await persist(true);
    if (!publishedOk) {
      return {
        ok: false,
        error: 'Could not publish template before test send. Fix save errors and retry.',
      };
    }

    const usage = await loadTemplateUsageFromBackend(appForTest, id);
    if (!usage.ok) {
      return { ok: false, error: usage.error || 'Could not find a schedule for this template' };
    }
    if (!usage.schedules?.length) {
      return {
        ok: false,
        error:
          'No schedule uses this template yet. Create a schedule in Application → Schedulers, then retry test email.',
      };
    }

    const schedule = usage.schedules[0];
    const result = await testSendScheduleOnBackend(appForTest, schedule.id, recipient);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || result.logExcerpt || 'Test send failed',
      };
    }

    return {
      ok: true,
      message: result.message || 'Delivery confirmed — email uses the HTML you just published.',
    };
  };

  const handleAiGenerate = async (prompt: string, includeCurrentHtml: boolean) => {
    if (!backendMode) {
      throw new Error('AI generate requires backend API mode');
    }
    const appForAi =
      backendApp || ({ id: appRouteId, environment: 'Production' } as KissflowApplication);

    if (
      html.trim() &&
      !window.confirm(
        includeCurrentHtml
          ? 'AI will revise the current HTML in the editor. Continue? (Save draft still needed to persist.)'
          : 'AI will replace the current HTML with a new layout. Continue? (Save draft still needed to persist.)',
      )
    ) {
      return;
    }

    setAiBusy(true);
    try {
      const result = await generateTemplateHtmlOnBackend(appForAi, {
        prompt,
        currentHtml: html,
        includeCurrentHtml,
        templateName: name || appForAi.displayName || appForAi.name,
      });
      if (!result.ok || !result.html) {
        throw new Error(result.error || 'AI HTML generation failed');
      }
      setHtml(result.html);
      setMode('split');
      const modelHint = result.model ? ` · ${result.model}` : '';
      setSaveMsg(`AI draft loaded${modelHint} — save draft when ready`);
      setTimeout(() => setSaveMsg(''), 5000);
    } finally {
      setAiBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleteError(null);

    if (backendMode) {
      const appForDelete =
        backendApp || ({ id: appRouteId, environment: 'Production' } as KissflowApplication);

      setDeleting(true);
      const usage = await loadTemplateUsageFromBackend(appForDelete, id);
      setDeleting(false);

      if (!usage.ok) {
        setDeleteError(usage.error || 'Could not verify whether this template is in use.');
        return;
      }

      if (usage.inUse) {
        const names = (usage.schedules || []).map((s) => s.name).join(', ');
        const suffix = (usage.schedules?.length || 0) === 1 ? 'schedule' : 'schedules';
        setDeleteError(
          `This template is already in use by ${usage.schedules?.length || 0} ${suffix}: ${names}. Pause or delete those schedulers first, or assign a different template.`,
        );
        return;
      }

      if (!window.confirm('Do you want to delete this template?')) return;

      setDeleting(true);
      const result = await deleteTemplateOnBackend(appForDelete, id);
      setDeleting(false);

      if (!result.ok) {
        setDeleteError(
          result.errorCode === 'TEMPLATE_IN_USE'
            ? result.error || 'This template is already in use by a schedule.'
            : result.error || 'Delete failed',
        );
        return;
      }
      navigate(appRouteId ? `/applications/${appRouteId}?tab=templates` : '/templates');
      return;
    }

    const linked = getSchedulersByTemplateId(id);
    if (linked.length > 0) {
      setDeleteError(formatSchedulersInUseMessage(linked));
      return;
    }

    if (!window.confirm('Do you want to delete this template?')) return;

    deleteTemplate(id);
    navigate(appRouteId ? `/applications/${appRouteId}?tab=templates` : '/templates');
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
            {pipelineMsg && (
              <p className="text-xs text-emerald-700 mt-1">{pipelineMsg}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex glass rounded-[12px] p-1">
            <button
              type="button"
              onClick={() => setMode('split')}
              className={`h-8 px-3 rounded-[10px] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                mode === 'split' ? 'bg-primary-600 text-white' : 'text-foreground-600'
              }`}
            >
              <PanelsTopBottom className="w-3.5 h-3.5" />
              Split
            </button>
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
            variant="secondary"
            size="sm"
            onClick={() => setTestEmailOpen(true)}
            disabled={!backendMode}
            title={backendMode ? 'Send test via linked schedule' : 'Test email requires backend mode'}
            leftIcon={<Send className="w-3.5 h-3.5" />}
          >
            Test email
          </Button>
          {backendMode && appKind === 'itsm' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={layoutBusy}
              onClick={() => void applyLatestItsmLayout()}
              leftIcon={<LayoutTemplate className="w-3.5 h-3.5" />}
            >
              {layoutBusy
                ? 'Updating…'
                : preferExtrovisStarter(name)
                  ? 'Apply Extrovis layout'
                  : 'Apply Refex ITSM layout'}
            </Button>
          )}
          {backendMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStarterOpen(true)}
              leftIcon={<LayoutTemplate className="w-3.5 h-3.5" />}
            >
              Load starter
            </Button>
          )}
          {backendMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowVersionHistory((v) => !v)}
              leftIcon={<History className="w-3.5 h-3.5" />}
            >
              History
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={() => void handleDelete()}
            loading={deleting}
            leftIcon={!deleting ? <Trash2 className="w-3.5 h-3.5" /> : undefined}
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

      {deleteError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {deleteError}
        </div>
      )}

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="surface p-4 space-y-3.5 h-fit">
          <Input label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            ref={subjectInputRef}
            label="Email subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            hint="Use {{ReportTitle}} etc."
          />
          <div className="rounded-[14px] bg-background-50 border border-background-200/80 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400 mb-1">
              Subject preview
            </p>
            <p className="text-xs text-foreground-700 break-words">{previewSubject || '—'}</p>
          </div>
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
          <div className="rounded-[14px] border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-[11px] text-emerald-900 leading-relaxed">
            <strong className="font-semibold">Publish flow:</strong> click <em>Publish</em> after
            HTML edits (or use <em>Test email</em>, which publishes first). Only the published HTML
            is emailed — draft-only changes are not sent.
          </div>
          {backendMode && (
            <AiGeneratePanel busy={aiBusy} onGenerate={handleAiGenerate} />
          )}
          <PlaceholderPicker
            appKind={appKind}
            usedInTemplate={placeholderHints}
            onInsert={insertPlaceholder}
          />
        </div>

        <div className="flex min-h-[560px] gap-0">
          <div className="surface overflow-hidden min-h-[560px] flex flex-col flex-1 min-w-0">
          {(mode === 'edit' || mode === 'split') && (
            <textarea
              ref={htmlEditorRef}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              spellCheck={false}
              className={`w-full p-4 font-mono text-xs leading-relaxed bg-foreground-950 text-accent-100 outline-none resize-none border-0 ${
                mode === 'split' ? 'min-h-[280px] flex-1 border-b border-background-200' : 'flex-1 min-h-[560px]'
              }`}
              aria-label="HTML template editor"
            />
          )}
          {(mode === 'preview' || mode === 'split') && (
            <div className={mode === 'split' ? 'flex-1 min-h-[280px] flex flex-col' : 'flex-1 min-h-[560px] flex flex-col'}>
              {mode === 'split' && (
                <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-foreground-400 border-b border-background-200 bg-background-50">
                  Live preview
                </div>
              )}
              <iframe
                key={previewKey}
                title="Email preview"
                sandbox=""
                srcDoc={previewHtml}
                className="flex-1 w-full bg-white border-0 min-h-[240px]"
              />
            </div>
          )}
          </div>

          {backendMode && showVersionHistory && (
            <VersionHistory
              isOpen={showVersionHistory}
              onClose={() => setShowVersionHistory(false)}
              versions={versionHistory}
              currentVersion={currentVersionNumber}
              onRestoreVersion={(v) => void handleRestoreVersion(v)}
              loading={versionsLoading}
            />
          )}
        </div>
      </div>

      <TestEmailDialog
        isOpen={testEmailOpen}
        onClose={() => setTestEmailOpen(false)}
        templateName={name}
        subject={previewSubject}
            onSend={async (recipient, _overrides) => handleTestEmailSend(recipient)}
      />

      {backendMode && (backendApp || appRouteId) && (
        <StarterPickerModal
          open={starterOpen}
          onClose={() => setStarterOpen(false)}
          app={
            backendApp ||
            ({ id: appRouteId, environment: 'Production', name: name || 'Application' } as KissflowApplication)
          }
          mode="load"
          onConfirmLoad={(nextHtml) => {
            if (
              html.trim() &&
              !window.confirm('Replace the current HTML with this starter layout? Unsaved edits in the editor will be overwritten (Save draft still needed).')
            ) {
              return;
            }
            setHtml(nextHtml);
            setMode('split');
            setSaveMsg('Starter loaded — save draft when ready');
            setStarterOpen(false);
          }}
        />
      )}
    </Layout>
  );
}
