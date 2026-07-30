import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Pause, Play, Save, Send, Trash2 } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { getApplicationById } from '@/mocks/applications';
import {
  deleteScheduler,
  describeCadence,
  getSchedulerById,
  parseEmailList,
  updateScheduler,
  type CadenceType,
  type SchedulerStatus,
} from '@/stores/reportSchedulers';
import { getTemplatesByAppId } from '@/stores/reportTemplates';
import {
  removeSchedulerFromServer,
  runSchedulerNow,
  syncSchedulerToServer,
} from '@/services/schedulerSync';
import { LEAD_TRACKER_SALES_GROUPS } from '@/services/leadReport';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';

export default function SchedulerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const existing = id ? getSchedulerById(id) : undefined;

  const [name, setName] = useState(existing?.name || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [status, setStatus] = useState<SchedulerStatus>(existing?.status || 'draft');
  const [templateId, setTemplateId] = useState(existing?.templateId || '');
  const [cadenceType, setCadenceType] = useState<CadenceType>(existing?.cadence.type || 'daily');
  const [time, setTime] = useState(existing?.cadence.time || '09:00');
  const [weekday, setWeekday] = useState(existing?.cadence.weekday ?? 1);
  const [monthDay, setMonthDay] = useState(existing?.cadence.monthDay ?? 1);
  const [cronExpression, setCronExpression] = useState(existing?.cadence.cronExpression || '');
  const [recipientsText, setRecipientsText] = useState((existing?.recipients || []).join(', '));
  const [ccText, setCcText] = useState((existing?.cc || []).join(', '));
  const [websiteFilter, setWebsiteFilter] = useState(existing?.websiteFilter || '');
  const [userGroupFilter, setUserGroupFilter] = useState(existing?.userGroupFilter || '');
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const app = existing ? getApplicationById(existing.applicationId) : undefined;
  const templates = useMemo(
    () => (existing ? getTemplatesByAppId(existing.applicationId) : []),
    [existing],
  );

  if (!existing) {
    return (
      <Layout breadcrumbs={[{ label: 'Schedules', path: '/schedulers' }, { label: 'Not found' }]}>
        <EmptyState
          variant="schedules"
          title="Schedule not found"
          description="This schedule may have been deleted."
          primaryLabel="Back to schedules"
          onPrimary={() => navigate('/schedulers')}
        />
      </Layout>
    );
  }

  const buildLocal = (nextStatus?: SchedulerStatus) => {
    const tpl = templates.find((t) => t.id === templateId);
    const cadence = {
      type: cadenceType,
      time,
      weekday: cadenceType === 'weekly' ? weekday : undefined,
      monthDay: cadenceType === 'monthly' ? monthDay : undefined,
      cronExpression: cadenceType === 'cron' ? cronExpression : undefined,
    };
    return updateScheduler(id!, {
      name,
      description,
      templateId,
      templateName: tpl?.name || existing.templateName,
      cadence,
      recipients: parseEmailList(recipientsText),
      cc: parseEmailList(ccText),
      websiteFilter: websiteFilter.trim() || undefined,
      userGroupFilter: userGroupFilter.trim() || undefined,
      status: nextStatus || status,
    });
  };

  const persist = async (nextStatus?: SchedulerStatus) => {
    setError('');
    setBusy(true);
    const saved = buildLocal(nextStatus);
    if (nextStatus) setStatus(nextStatus);
    if (!saved) {
      setBusy(false);
      setError('Could not save locally');
      return;
    }

    if (saved.status === 'active') {
      const sync = await syncSchedulerToServer(saved);
      if (!sync.ok) {
        setBusy(false);
        setError(sync.error || 'Saved locally, but server sync failed — email will not send');
        return;
      }
      setSaveMsg('Saved & synced to server');
    } else {
      await removeSchedulerFromServer(saved.id);
      setSaveMsg('Saved (paused on server)');
    }
    setBusy(false);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const sendNow = async () => {
    setError('');
    setBusy(true);
    const saved = buildLocal(status === 'draft' ? 'active' : status);
    if (saved && status === 'draft') setStatus('active');
    if (!saved) {
      setBusy(false);
      setError('Save failed');
      return;
    }
    const result = await runSchedulerNow(saved.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Send failed');
      return;
    }
    setSaveMsg(result.message || 'Sent');
    setTimeout(() => setSaveMsg(''), 4000);
  };

  return (
    <Layout
      breadcrumbs={[
        { label: 'Schedules', path: '/schedulers' },
        { label: name || 'Schedule' },
      ]}
    >
      <div className="mb-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate('/schedulers')} leftIcon={<ArrowLeft className="w-4 h-4" />}>
            Back
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-heading font-semibold text-foreground-950 truncate">{name}</h1>
            <p className="text-xs text-foreground-500">
              {app?.displayName || app?.name} ·{' '}
              {describeCadence({ type: cadenceType, time, weekday, monthDay, cronExpression })}
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
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (!confirm('Delete this schedule?')) return;
              await removeSchedulerFromServer(id!);
              deleteScheduler(id!);
              navigate('/schedulers');
            }}
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Delete
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => void sendNow()}
            leftIcon={<Send className="w-3.5 h-3.5" />}
            disabled={!templateId || !parseEmailList(recipientsText).length}
          >
            Send now
          </Button>
          {status === 'active' ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => void persist('paused')}
              leftIcon={<Pause className="w-3.5 h-3.5" />}
            >
              Pause
            </Button>
          ) : (
            <Button
              size="sm"
              loading={busy}
              onClick={() => void persist('active')}
              leftIcon={<Play className="w-3.5 h-3.5" />}
              disabled={!templateId || !parseEmailList(recipientsText).length}
            >
              Activate
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => void persist()}
            leftIcon={<Save className="w-4 h-4" />}
          >
            Save
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[14px] bg-red-50 border border-red-200 text-sm text-red-800 font-medium">
          {error}
        </div>
      )}

      <div className="mb-4 px-4 py-3 rounded-[14px] bg-[#E8F3FC] border border-[#BFDDF0] text-xs text-[#0A5A9E]">
        Schedules run on the <strong>server</strong> (Asia/Kolkata). Use <strong>Activate</strong> or{' '}
        <strong>Save</strong> while Active to sync, then <strong>Send now</strong> to deliver immediately. A
        missed daily time is caught up automatically once the server is running.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface p-5 space-y-4">
          <h2 className="text-sm font-heading font-semibold text-foreground-950">Basics</h2>
          <Input label="Schedule name" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="field-input !h-auto py-2.5 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">
              HTML template (this app only)
            </label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="field-input">
              {templates.length === 0 && <option value="">No templates — create one first</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">
              Kissflow user group (Lead Tracker)
            </label>
            <select
              value={userGroupFilter}
              onChange={(e) => {
                const group = e.target.value;
                setUserGroupFilter(group);
                const match = LEAD_TRACKER_SALES_GROUPS.find((g) => g.groupName === group);
                if (match?.websiteFilter) setWebsiteFilter(match.websiteFilter);
              }}
              className="field-input"
            >
              <option value="">— Select sales team —</option>
              {LEAD_TRACKER_SALES_GROUPS.map((g) => (
                <option key={g.slug} value={g.groupName}>
                  {g.groupName}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-foreground-400 mt-1">
              Filters users from Kissflow Groups, then counts their assigned leads (Open / Closed).
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">
              Website filter (optional)
            </label>
            <Input
              value={websiteFilter}
              onChange={(e) => setWebsiteFilter(e.target.value)}
              placeholder="Auto-set from group — e.g. Modepro"
            />
          </div>
        </div>

        <div className="surface p-5 space-y-4">
          <h2 className="text-sm font-heading font-semibold text-foreground-950">When to send</h2>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Cadence</label>
            <select
              value={cadenceType}
              onChange={(e) => setCadenceType(e.target.value as CadenceType)}
              className="field-input"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="cron">Custom cron</option>
            </select>
          </div>
          {cadenceType !== 'cron' && (
            <Input
              label="Time (24h, Asia/Kolkata)"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          )}
          {cadenceType === 'weekly' && (
            <div>
              <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Weekday</label>
              <select
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
                className="field-input"
              >
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ),
                )}
              </select>
            </div>
          )}
          {cadenceType === 'monthly' && (
            <Input
              label="Day of month"
              type="number"
              min={1}
              max={28}
              value={monthDay}
              onChange={(e) => setMonthDay(Number(e.target.value))}
            />
          )}
          {cadenceType === 'cron' && (
            <Input
              label="Cron expression"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="35 15 * * *"
            />
          )}
        </div>

        <div className="surface p-5 space-y-4 lg:col-span-2">
          <h2 className="text-sm font-heading font-semibold text-foreground-950">Recipients</h2>
          <p className="text-xs text-foreground-500 -mt-2">
            Chosen people for this app’s report — separate from other apps.
          </p>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">To</label>
            <textarea
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              rows={3}
              className="field-input !h-auto py-2.5 resize-none font-mono text-xs"
              placeholder="manager@company.com, lead@company.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Cc (optional)</label>
            <textarea
              value={ccText}
              onChange={(e) => setCcText(e.target.value)}
              rows={2}
              className="field-input !h-auto py-2.5 resize-none font-mono text-xs"
              placeholder="ops@company.com"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
