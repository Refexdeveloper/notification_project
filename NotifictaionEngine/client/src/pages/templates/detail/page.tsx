import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const existing = id ? getTemplateById(id) : undefined;

  const [name, setName] = useState(existing?.name || '');
  const [subject, setSubject] = useState(existing?.subject || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [html, setHtml] = useState(existing?.html || '');
  const [status, setStatus] = useState(existing?.status || 'draft');
  const [applicationId, setApplicationId] = useState(existing?.applicationId || '');
  const [saveMsg, setSaveMsg] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  const apps = useMemo(() => getApplications(), []);
  const app = applicationId ? getApplicationById(applicationId) : undefined;

  const previewHtml = useMemo(() => renderPreviewHtml(html), [html]);

  const persist = useCallback(
    (publish = false) => {
      if (!id || !existing) return;
      updateTemplate(id, {
        name,
        subject,
        description,
        html,
        applicationId,
        status: publish ? 'published' : 'draft',
      });
      if (publish) {
        setStatus('published');
      } else {
        setStatus('draft');
      }
      setSaveMsg(publish ? 'Published' : 'Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    },
    [id, existing, name, subject, description, html, status, applicationId],
  );

  if (!existing) {
    return (
      <Layout breadcrumbs={[{ label: 'Templates', path: '/templates' }, { label: 'Not found' }]}>
        <EmptyState
          variant="templates"
          title="Template not found"
          description="This template may have been deleted."
          primaryLabel="Back to templates"
          onPrimary={() => navigate('/templates')}
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
          <Button variant="ghost" size="sm" onClick={() => navigate('/templates')} leftIcon={<ArrowLeft className="w-4 h-4" />}>
            Back
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-heading font-semibold text-foreground-950 truncate">{name}</h1>
            <p className="text-xs text-foreground-500">
              {app?.displayName || app?.name || 'Application'} ·{' '}
              <span className="capitalize">{status}</span>
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
            onClick={() => {
              if (confirm('Delete this template?')) {
                deleteTemplate(id!);
                navigate('/templates');
              }
            }}
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={() => persist(false)} leftIcon={<Save className="w-3.5 h-3.5" />}>
            Save draft
          </Button>
          <Button size="sm" onClick={() => persist(true)} leftIcon={<Check className="w-3.5 h-3.5" />}>
            Publish
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="surface p-4 space-y-3.5 h-fit">
          <Input label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} hint="Use {{ReportTitle}} etc." />
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
