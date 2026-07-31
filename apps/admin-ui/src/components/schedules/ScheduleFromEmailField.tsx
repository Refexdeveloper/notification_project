import FromEmailAuthorizationHelp from '@/components/schedules/FromEmailAuthorizationHelp';

interface ScheduleFromEmailFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}

export default function ScheduleFromEmailField({
  value,
  onChange,
  disabled,
  required,
}: ScheduleFromEmailFieldProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">
          From address{required ? ' (required to activate)' : ''}
        </label>
        <input
          type="email"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="field-input font-mono text-xs w-full max-w-md"
          placeholder="reports@refex.co.in"
        />
        <p className="text-[11px] text-foreground-400 mt-1">
          Recipients see this address. It must be authorized in Google Workspace for the SMTP mailbox.
        </p>
      </div>
      <FromEmailAuthorizationHelp fromEmail={value} />
    </div>
  );
}
