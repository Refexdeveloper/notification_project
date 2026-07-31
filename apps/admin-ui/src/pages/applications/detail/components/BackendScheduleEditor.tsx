import { useEffect, useMemo, useState } from 'react';
import { Check, Mail, Pause, Play, Save, Trash2 } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import type { ReportTemplate } from '@/stores/reportTemplates';
import { parseEmailList } from '@/stores/reportSchedulers';
import { describeBackendSchedule, deleteScheduleOnBackend, loadTemplatesFromBackend, testSendScheduleOnBackend, updateScheduleOnBackend } from '@/services/reportsApi';
import {
  cadenceStateToCron,
  cronToCadenceState,
  DEFAULT_TIMEZONE,
  type ScheduleCadenceState,
} from '@/services/scheduleCadence';
import ScheduleCadenceFields from '@/components/schedules/ScheduleCadenceFields';
import ScheduleFromEmailField from '@/components/schedules/ScheduleFromEmailField';
import ScheduleReportIdentityFields, {
  type ScheduleReportIdentityValue,
} from '@/components/schedules/ScheduleReportIdentityFields';
import { Button } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';

const SUGGESTED_FROM_EMAIL = 'reports@refex.co.in';

function formatCloudSchedulerMessage(sync?: { ok?: boolean; state?: string; job_name?: string; skipped?: boolean; reason?: string; error?: string }): string {
  if (!sync) return '';
  if (sync.ok) {
    return ` Cloud Scheduler is ${sync.state === 'ENABLED' ? 'enabled' : 'paused'} (${sync.job_name || 'job synced'}).`;
  }
  if (sync.skipped) {
    return ` Cloud Scheduler was not auto-synced: ${sync.reason || 'skipped'}.`;
  }
  return ` Cloud Scheduler sync issue: ${sync.error || 'unknown error'}.`;
}

interface BackendScheduleEditorProps {
  app: KissflowApplication;
  schedule: ReportScheduler;
  onUpdated: () => void;
  onClose: () => void;
  onDeleted?: () => void;
}

function normalizeFromEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return Boolean(value) && value.includes('@');
}

function scheduleToCadenceState(schedule: ReportScheduler): ScheduleCadenceState {
  const cron = schedule.cadence.cronExpression || '0 9 * * *';
  return cronToCadenceState(cron, schedule.timezone || DEFAULT_TIMEZONE);
}

function scheduleToIdentity(schedule: ReportScheduler, app: KissflowApplication): ScheduleReportIdentityValue {
  return {
    templateId: schedule.templateId,
    templateName: schedule.templateName,
    processId: schedule.processId || app.processIds?.[0] || '',
    websiteFilter: schedule.websiteFilter || '',
    userGroupFilter: schedule.userGroupFilter || '',
    subject: schedule.subject || schedule.templateName || schedule.name,
  };
}

export default function BackendScheduleEditor({
  app,
  schedule,
  onUpdated,
  onClose,
  onDeleted,
}: BackendScheduleEditorProps) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [reportIdentity, setReportIdentity] = useState<ScheduleReportIdentityValue>(() =>
    scheduleToIdentity(schedule, app),
  );
  const [fromEmail, setFromEmail] = useState(schedule.fromEmail || '');
  const [recipientsText, setRecipientsText] = useState(schedule.recipients.join(', '));
  const [ccText, setCcText] = useState(schedule.cc.join(', '));
  const [cadence, setCadence] = useState<ScheduleCadenceState>(() => scheduleToCadenceState(schedule));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testRecipientInput, setTestRecipientInput] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadTemplatesFromBackend(app).then((result) => {
      if (cancelled) return;
      setTemplates(result.templates);
    });
    return () => {
      cancelled = true;
    };
  }, [app]);

  useEffect(() => {
    setReportIdentity(scheduleToIdentity(schedule, app));
    setFromEmail(schedule.fromEmail || '');
    setRecipientsText(schedule.recipients.join(', '));
    setCcText(schedule.cc.join(', '));
    setCadence(scheduleToCadenceState(schedule));
    setError('');
    setSuccess('');
  }, [schedule.id, schedule.fromEmail, schedule.recipients, schedule.cc, schedule.cadence, schedule.timezone, schedule.templateId, schedule.processId, schedule.websiteFilter, schedule.userGroupFilter, schedule.subject, schedule.templateName, schedule.name]);

  const toRecipients = useMemo(() => parseEmailList(recipientsText), [recipientsText]);
  const normalizedFrom = normalizeFromEmail(fromEmail);
  const hasValidFrom = isValidEmail(normalizedFrom);
  const activationBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!hasValidFrom) blockers.push(`Add a valid From address (e.g. ${SUGGESTED_FROM_EMAIL})`);
    if (!toRecipients.length) blockers.push('Add at least one To recipient email');
    return blockers;
  }, [hasValidFrom, toRecipients.length]);
  const canActivate = activationBlockers.length === 0;

  const buildPayload = (extra?: { is_active?: boolean }) => {
    const normalizedFrom = normalizeFromEmail(fromEmail);
    return {
      from_email: normalizedFrom,
      recipients_to: parseEmailList(recipientsText),
      recipients_cc: parseEmailList(ccText),
      cron_expression: cadenceStateToCron(cadence),
      timezone: cadence.timezone || DEFAULT_TIMEZONE,
      template_id: reportIdentity.templateId,
      template_name: reportIdentity.templateName,
      process_id: reportIdentity.processId || undefined,
      website_filter: reportIdentity.websiteFilter || undefined,
      user_group_filter: reportIdentity.userGroupFilter || undefined,
      subject: reportIdentity.subject || undefined,
      ...extra,
    };
  };

  const validate = (requireFrom = false) => {
    const normalizedFrom = normalizeFromEmail(fromEmail);
    if (!reportIdentity.templateId) {
      setError('Select an HTML template for this schedule.');
      return false;
    }
    if (requireFrom && !isValidEmail(normalizedFrom)) {
      setError('From email is required before activating.');
      return false;
    }
    if (fromEmail.trim() && !isValidEmail(normalizedFrom)) {
      setError('From email must be a valid address.');
      return false;
    }
    if (cadence.pattern === 'cron' && !cadence.cronExpression.trim()) {
      setError('Enter a cron expression or choose a preset schedule.');
      return false;
    }
    return true;
  };

  const saveSettings = async () => {
    if (!validate()) return;
    setBusy(true);
    setError('');
    setSuccess('');
    const result = await updateScheduleOnBackend(app, schedule.id, buildPayload());
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Save failed');
      return;
    }
    setSuccess(`Schedule saved to PostgreSQL.${formatCloudSchedulerMessage(result.cloudScheduler)}`);
    onUpdated();
    setTimeout(() => setSuccess(''), 3500);
  };

  const toggleActive = async (nextActive: boolean) => {
    if (!validate(nextActive)) return;
    setBusy(true);
    setError('');
    setSuccess('');
    const result = await updateScheduleOnBackend(
      app,
      schedule.id,
      buildPayload({ is_active: nextActive }),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Update failed');
      return;
    }
    setSuccess(
      nextActive
        ? `Schedule activated.${formatCloudSchedulerMessage(result.cloudScheduler)}`
        : `Schedule paused.${formatCloudSchedulerMessage(result.cloudScheduler)}`,
    );
    onUpdated();
    setTimeout(() => setSuccess(''), 3500);
  };

  const removeSchedule = async () => {
    if (!window.confirm(`Delete schedule "${schedule.name}"?`)) return;
    setBusy(true);
    setError('');
    const result = await deleteScheduleOnBackend(app, schedule.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Delete failed');
      return;
    }
    onDeleted?.();
    onClose();
  };

  const openTestEmailModal = () => {
    setError('');
    setSuccess('');
    if (!hasValidFrom) {
      setError(`Enter a valid From address before testing (e.g. ${SUGGESTED_FROM_EMAIL}).`);
      return;
    }
    setTestRecipientInput(toRecipients[0] || '');
    setTestModalOpen(true);
  };

  const sendTestEmail = async () => {
    const testRecipient = testRecipientInput.trim().toLowerCase();
    if (!isValidEmail(testRecipient)) {
      setError('Test recipient must be a valid email address.');
      return;
    }

    setTesting(true);
    setError('');
    setSuccess('Saving schedule settings before test send…');

    const saveResult = await updateScheduleOnBackend(app, schedule.id, buildPayload());
    if (!saveResult.ok) {
      setTesting(false);
      setSuccess('');
      setError(saveResult.error || 'Could not save schedule before test send.');
      return;
    }

    setSuccess('Starting test send (ingest → render → email)…');
    const result = await testSendScheduleOnBackend(app, schedule.id, testRecipient);
    setTesting(false);
    setTestModalOpen(false);

    if (!result.ok) {
      setSuccess('');
      setError(result.error || 'Test send failed');
      return;
    }

    onUpdated();
    setSuccess(
      result.message ||
        `Test send started for ${testRecipient}. Check inbox in 2–5 minutes (and spam).`,
    );
    setTimeout(() => setSuccess(''), 10000);
  };

  return (
    <div className="surface p-5 space-y-4 border-primary-200/60">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground-900">{schedule.name}</h3>
          <p className="text-xs text-foreground-500 mt-0.5">
            {describeBackendSchedule(schedule)}
            {schedule.processId ? ` · Process: ${schedule.processId}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-foreground-500 hover:text-foreground-800 cursor-pointer"
        >
          Close
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-800 inline-flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          {success}
        </div>
      )}

      <ScheduleReportIdentityFields
        app={app}
        templates={templates}
        value={reportIdentity}
        onChange={setReportIdentity}
        disabled={busy}
      />

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <ScheduleCadenceFields value={cadence} onChange={setCadence} disabled={busy} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        From, To, and Cc are stored in PostgreSQL. Click <strong>Save schedule</strong> after editing.
        Activate requires a Workspace-authorized From address plus at least one To recipient; Cloud Scheduler syncs automatically on save/activate.
      </div>

      {schedule.status !== 'active' && activationBlockers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 space-y-1">
          <p className="font-semibold">Before you can Activate:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {activationBlockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <ScheduleFromEmailField
        value={fromEmail}
        onChange={setFromEmail}
        disabled={busy}
        required
      />

      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">To (required to activate)</label>
        <textarea
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          rows={3}
          className="field-input !h-auto py-2.5 resize-none font-mono text-xs w-full"
          placeholder="manager@company.com, lead@company.com"
        />
        {!toRecipients.length && (
          <p className="text-[11px] text-amber-700 mt-1">At least one To address is required to activate.</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Cc (optional)</label>
        <textarea
          value={ccText}
          onChange={(e) => setCcText(e.target.value)}
          rows={2}
          className="field-input !h-auto py-2.5 resize-none font-mono text-xs w-full"
          placeholder="ops@company.com"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={() => void saveSettings()}
          leftIcon={<Save className="w-3.5 h-3.5" />}
        >
          Save schedule
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={testing}
          disabled={busy}
          onClick={openTestEmailModal}
          leftIcon={<Mail className="w-3.5 h-3.5" />}
        >
          Test email
        </Button>
        {schedule.status === 'active' ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => void toggleActive(false)}
            leftIcon={<Pause className="w-3.5 h-3.5" />}
          >
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            loading={busy}
            onClick={() => void toggleActive(true)}
            leftIcon={<Play className="w-3.5 h-3.5" />}
            disabled={!canActivate || busy}
            title={canActivate ? 'Activate schedule' : activationBlockers.join(' · ')}
          >
            Activate
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={() => void removeSchedule()}
          leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          className="text-red-700 border-red-200 hover:bg-red-50"
        >
          Delete
        </Button>
      </div>

      <Modal open={testModalOpen} onClose={() => !testing && setTestModalOpen(false)} className="max-w-md">
        <div className="px-6 py-5 border-b border-background-200/70">
          <h2 className="text-lg font-heading font-semibold text-foreground-950">Send test email</h2>
          <p className="text-sm text-foreground-500 mt-1">
            Runs ingest → render → send for this schedule only. Usually takes 2–5 minutes.
          </p>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Test recipient</label>
            <Input
              type="email"
              value={testRecipientInput}
              onChange={(e) => setTestRecipientInput(e.target.value)}
              placeholder="you@refex.co.in"
              disabled={testing}
            />
          </div>
          <p className="text-[11px] text-foreground-500">
            From: <span className="font-mono">{normalizedFrom || '—'}</span> · Settings are saved automatically
            before send.
          </p>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2.5 bg-background-50/40">
          <Button type="button" variant="ghost" disabled={testing} onClick={() => setTestModalOpen(false)}>
            Cancel
          </Button>
          <Button type="button" loading={testing} disabled={!testRecipientInput.trim()} onClick={() => void sendTestEmail()}>
            Send test
          </Button>
        </div>
      </Modal>
    </div>
  );
}
