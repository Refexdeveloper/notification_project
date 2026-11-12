import { useEffect, useMemo, useState } from 'react';
import { Check, Save, X } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import { parseEmailList } from '@/stores/reportSchedulers';
import { describeBackendSchedule, updateScheduleOnBackend } from '@/services/reportsApi';
import { Button } from '@/components/ui/Button';

interface ScheduleRecipientsEditorProps {
  app: KissflowApplication;
  schedule: ReportScheduler;
  onSaved: (schedule: ReportScheduler) => void;
  onClose: () => void;
}

/** Tokens that are not email addresses — the backend would silently drop them. */
function invalidTokens(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((token) => token.trim())
    .filter((token) => token && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token));
}

const FIELDS = [
  { key: 'to', label: 'To', hint: 'Required while the schedule is active', placeholder: 'manager@company.com, lead@company.com' },
  { key: 'cc', label: 'Cc', hint: 'Optional', placeholder: 'ops@company.com' },
  { key: 'bcc', label: 'Bcc', hint: 'Optional · hidden from To / Cc · test email never goes to Bcc', placeholder: 'audit@company.com' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

function recipientsOf(schedule: ReportScheduler): Record<FieldKey, string> {
  return {
    to: schedule.recipients.join(', '),
    cc: schedule.cc.join(', '),
    bcc: (schedule.bcc || []).join(', '),
  };
}

export default function ScheduleRecipientsEditor({
  app,
  schedule,
  onSaved,
  onClose,
}: ScheduleRecipientsEditorProps) {
  const [values, setValues] = useState<Record<FieldKey, string>>(() => recipientsOf(schedule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setValues(recipientsOf(schedule));
    setError('');
    setSuccess('');
  }, [schedule.id, schedule.recipients, schedule.cc, schedule.bcc]);

  const saved = useMemo(() => recipientsOf(schedule), [schedule]);
  const dirty = FIELDS.some(({ key }) => parseEmailList(values[key]).join(',') !== parseEmailList(saved[key]).join(','));

  const save = async () => {
    setError('');
    setSuccess('');
    const bad = FIELDS.flatMap(({ key, label }) => invalidTokens(values[key]).map((t) => `${label}: ${t}`));
    if (bad.length) {
      setError(`Not a valid email address — ${bad.join(', ')}`);
      return;
    }
    const to = parseEmailList(values.to);
    if (schedule.status === 'active' && !to.length) {
      setError('An active schedule needs at least one To address. Pause it in the app Schedules tab first.');
      return;
    }
    setSaving(true);
    const result = await updateScheduleOnBackend(app, schedule.id, {
      recipients_to: to,
      recipients_cc: parseEmailList(values.cc),
      recipients_bcc: parseEmailList(values.bcc),
    });
    setSaving(false);
    if (!result.ok || !result.schedule) {
      setError(result.error || 'Save failed');
      return;
    }
    onSaved(result.schedule);
    setSuccess('Recipients saved. The next scheduled send uses them.');
    setTimeout(() => setSuccess(''), 4000);
  };

  return (
    <div className="surface p-4 sm:p-5 space-y-4 border-primary-200/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground-900 break-words">{schedule.name}</h2>
          <p className="text-xs text-foreground-500 mt-0.5 break-words">
            {app.displayName || app.name} · {describeBackendSchedule(schedule)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-1 text-foreground-500 hover:bg-background-100 hover:text-foreground-800 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 break-words">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-800 inline-flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 shrink-0" />
          {success}
        </div>
      )}

      {FIELDS.map(({ key, label, hint, placeholder }) => (
        <div key={key}>
          <label htmlFor={`sched-${key}`} className="block text-xs font-semibold text-foreground-700 mb-1.5">
            {label}
            <span className="ml-1.5 font-normal text-foreground-400">
              ({parseEmailList(values[key]).length})
            </span>
          </label>
          <textarea
            id={`sched-${key}`}
            value={values[key]}
            onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
            rows={key === 'to' ? 3 : 2}
            disabled={saving}
            className="field-input !h-auto py-2.5 resize-y font-mono text-xs w-full break-all"
            placeholder={placeholder}
          />
          <p className="text-[11px] text-foreground-500 mt-1">{hint}</p>
        </div>
      ))}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button
          size="sm"
          loading={saving}
          disabled={!dirty}
          onClick={() => void save()}
          leftIcon={<Save className="w-3.5 h-3.5" />}
        >
          Save recipients
        </Button>
        <Button size="sm" variant="ghost" disabled={saving || !dirty} onClick={() => setValues(saved)}>
          Reset
        </Button>
      </div>
    </div>
  );
}
