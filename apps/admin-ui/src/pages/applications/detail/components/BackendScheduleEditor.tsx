import { useEffect, useState } from 'react';
import { Check, Pause, Play, Save, Trash2 } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import type { ReportTemplate } from '@/stores/reportTemplates';
import { parseEmailList } from '@/stores/reportSchedulers';
import { describeBackendSchedule, deleteScheduleOnBackend, loadTemplatesFromBackend, updateScheduleOnBackend } from '@/services/reportsApi';
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
    setSuccess('Schedule saved to PostgreSQL. Run ops/runbook 32 to sync Cloud Scheduler if active.');
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
        ? 'Schedule activated. Run ops/runbook 32 to sync Cloud Scheduler with the new time.'
        : 'Schedule paused',
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
        From, To, and Cc are stored in PostgreSQL. After changing send time, run ops/runbook 32 so Cloud Scheduler
        matches.
      </div>

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
            disabled={
              !parseEmailList(recipientsText).length || !isValidEmail(normalizeFromEmail(fromEmail))
            }
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
    </div>
  );
}
