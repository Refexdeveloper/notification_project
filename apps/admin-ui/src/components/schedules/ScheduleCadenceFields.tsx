import {
  cadenceStateToCron,
  describeScheduleCadence,
  type ScheduleCadenceState,
  type SchedulePattern,
  weekdayLabel,
} from '@/services/scheduleCadence';

const TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
];

interface ScheduleCadenceFieldsProps {
  value: ScheduleCadenceState;
  onChange: (next: ScheduleCadenceState) => void;
  disabled?: boolean;
}

export default function ScheduleCadenceFields({ value, onChange, disabled }: ScheduleCadenceFieldsProps) {
  const set = (patch: Partial<ScheduleCadenceState>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">When to send</label>
        <select
          value={value.pattern}
          disabled={disabled}
          onChange={(e) => set({ pattern: e.target.value as SchedulePattern })}
          className="field-input w-full"
        >
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays only (Mon–Fri)</option>
          <option value="weekends">Weekends only (Sat–Sun)</option>
          <option value="weekly">Once a week</option>
          <option value="monthly">Once a month</option>
          <option value="cron">Custom cron expression</option>
        </select>
      </div>

      {value.pattern !== 'cron' && (
        <div>
          <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Time (24-hour)</label>
          <input
            type="time"
            value={value.time}
            disabled={disabled}
            onChange={(e) => set({ time: e.target.value || '09:00' })}
            className="field-input w-full max-w-[200px]"
          />
        </div>
      )}

      {value.pattern === 'weekly' && (
        <div>
          <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Day of week</label>
          <select
            value={value.weekday}
            disabled={disabled}
            onChange={(e) => set({ weekday: Number(e.target.value) })}
            className="field-input w-full max-w-[240px]"
          >
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {weekdayLabel(d)}
              </option>
            ))}
          </select>
        </div>
      )}

      {value.pattern === 'monthly' && (
        <div>
          <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Day of month</label>
          <input
            type="number"
            min={1}
            max={28}
            value={value.monthDay}
            disabled={disabled}
            onChange={(e) => set({ monthDay: Number(e.target.value) || 1 })}
            className="field-input w-full max-w-[120px]"
          />
          <p className="text-[11px] text-foreground-400 mt-1">Uses day 1–28 for consistent monthly runs.</p>
        </div>
      )}

      {value.pattern === 'cron' && (
        <div>
          <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Cron expression</label>
          <input
            type="text"
            value={value.cronExpression}
            disabled={disabled}
            onChange={(e) => set({ cronExpression: e.target.value })}
            placeholder="0 9 * * 1-5"
            className="field-input font-mono text-xs w-full"
          />
          <p className="text-[11px] text-foreground-400 mt-1">
            Format: minute hour day-of-month month day-of-week. Example:{' '}
            <code className="font-mono">5 17 * * 1-5</code> = weekdays at 17:05.
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Timezone</label>
        <select
          value={value.timezone}
          disabled={disabled}
          onChange={(e) => set({ timezone: e.target.value })}
          className="field-input w-full max-w-[280px]"
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <div className="font-semibold text-slate-800 mb-0.5">Preview</div>
        <div>{describeScheduleCadence(value)}</div>
        <div className="font-mono text-[11px] text-slate-500 mt-1">cron: {cadenceStateToCron(value)}</div>
      </div>
    </div>
  );
}
