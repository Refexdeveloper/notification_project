import { useState, useMemo } from 'react';
import { cronPresets } from '@/mocks/schedulers';
import type { Scheduler } from '@/mocks/schedulers';

interface CronBuilderProps {
  frequency: Scheduler['frequency'];
  onChange: (freq: Scheduler['frequency']) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function cronToHuman(cron: string): string {
  if (!cron) return '';
  const preset = cronPresets.find((p) => p.value === cron);
  if (preset) return preset.description;
  const parts = cron.split(' ');
  if (parts.length !== 5) return 'Custom cron expression';
  const [min, hour, dayOfMonth, , dayOfWeek] = parts;

  if (min === '0' && hour === '8' && dayOfMonth === '1') return 'First day of every month at 8:00 AM';
  if (min === '0' && dayOfMonth === '1' && dayOfWeek === '*') return `Monthly on 1st at ${hour.padStart(2, '0')}:00`;

  if (dayOfWeek === '*' && dayOfMonth === '*') {
    if (hour.includes('*/')) {
      const interval = hour.split('/')[1];
      return `Every ${interval} hours`;
    }
    if (hour === '*' && min === '0') return 'Every hour';
    if (min === '0') return `Daily at ${hour.padStart(2, '0')}:00`;
  }

  if (dayOfWeek.match(/^[0-9,-]+$/)) {
    if (min === '0') return `Weekdays at ${hour.padStart(2, '0')}:00`;
  }

  return `Runs at minute ${min}, hour ${hour}, day ${dayOfMonth}, month *, weekday ${dayOfWeek}`;
}

export default function CronBuilder({ frequency, onChange, isOpen, onToggle }: CronBuilderProps) {
  const [customCron, setCustomCron] = useState(frequency.cronExpression || '');
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const p = cronPresets.find((cp) => cp.value === frequency.cronExpression);
    return p ? p.value : (frequency.cronExpression ? '' : '');
  });

  const humanReadable = useMemo(() => {
    if (frequency.type === 'cron' && frequency.cronExpression) {
      return cronToHuman(frequency.cronExpression);
    }
    if (frequency.type === 'interval') {
      return `Every ${frequency.intervalMinutes} minute${frequency.intervalMinutes !== 1 ? 's' : ''}`;
    }
    if (frequency.type === 'daily') {
      const times = (frequency.dailyTimes || ['08:00']).join(', ');
      return `Daily at ${times}`;
    }
    if (frequency.type === 'weekly') {
      const days = (frequency.weeklyDays || [1]).map((d) => weekDays[d]).join(', ');
      const times = (frequency.weeklyTimes || ['09:00']).join(', ');
      return `Weekly on ${days} at ${times}`;
    }
    if (frequency.type === 'monthly') {
      const day = frequency.monthlyDay || 1;
      const times = (frequency.monthlyTimes || ['08:00']).join(', ');
      const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
      return `Monthly on ${day}${suffix} at ${times}`;
    }
    return 'Not configured';
  }, [frequency]);

  const handleTypeChange = (type: Scheduler['frequency']['type']) => {
    const base: Scheduler['frequency'] = { type };
    if (type === 'cron') base.cronExpression = '0 9 * * 1-5';
    if (type === 'interval') base.intervalMinutes = 30;
    if (type === 'daily') base.dailyTimes = ['09:00'];
    if (type === 'weekly') {
      base.weeklyDays = [1];
      base.weeklyTimes = ['09:00'];
    }
    if (type === 'monthly') {
      base.monthlyDay = 1;
      base.monthlyTimes = ['09:00'];
    }
    onChange(base);
  };

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    if (value) {
      onChange({ ...frequency, type: 'cron', cronExpression: value });
      setCustomCron(value);
    }
  };

  const handleCustomCronChange = (value: string) => {
    setCustomCron(value);
    onChange({ ...frequency, type: 'cron', cronExpression: value });
  };

  return (
    <div className="border border-background-200/70 rounded-xl bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-background-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
            <i className="ri-time-line text-primary-600"></i>
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-foreground-900">Schedule Configuration</h3>
            <p className="text-xs text-foreground-500 mt-0.5">{humanReadable}</p>
          </div>
        </div>
        <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <i className="ri-arrow-down-s-line text-foreground-400"></i>
        </span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 border-t border-background-100">
          <div className="pt-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-foreground-700 mb-2 block">Frequency Type</label>
              <div className="flex items-center gap-1 bg-background-50 rounded-lg p-0.5 w-fit">
                {(['cron', 'interval', 'daily', 'weekly', 'monthly'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleTypeChange(t)}
                    className={`h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      frequency.type === t
                        ? 'bg-white text-foreground-900 shadow-sm'
                        : 'text-foreground-500 hover:text-foreground-700'
                    }`}
                  >
                    {t === 'cron' ? 'Cron' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {frequency.type === 'cron' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-foreground-700 mb-2 block">Preset Schedules</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {cronPresets.map((preset) => (
                      <button
                        key={preset.value || 'custom'}
                        onClick={() => handlePresetChange(preset.value)}
                        className={`text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer border ${
                          selectedPreset === preset.value
                            ? 'border-primary-300 bg-primary-50 text-primary-700'
                            : 'border-background-200/70 hover:border-background-300 text-foreground-600'
                        }`}
                      >
                        <div className="font-medium">{preset.label}</div>
                        <div className="text-[11px] text-foreground-400 mt-0.5">{preset.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground-700 mb-1.5 block">Cron Expression</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customCron}
                      onChange={(e) => handleCustomCronChange(e.target.value)}
                      placeholder="0 9 * * 1-5"
                      className="flex-1 h-9 px-3 text-sm font-mono bg-background-50 border border-background-200/70 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                    />
                    <span className="text-xs text-foreground-400 whitespace-nowrap">min hour dom mon dow</span>
                  </div>
                  {customCron && (
                    <p className="text-xs text-primary-600 mt-1.5 flex items-center gap-1">
                      <i className="ri-information-line"></i>
                      {cronToHuman(customCron)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {frequency.type === 'interval' && (
              <div>
                <label className="text-xs font-medium text-foreground-700 mb-1.5 block">Run every (minutes)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={frequency.intervalMinutes || 30}
                    onChange={(e) =>
                      onChange({ ...frequency, intervalMinutes: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                    min={1}
                    className="w-24 h-9 px-3 text-sm bg-background-50 border border-background-200/70 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                  />
                  <span className="text-xs text-foreground-400">minutes</span>
                </div>
              </div>
            )}

            {frequency.type === 'daily' && (
              <div>
                <label className="text-xs font-medium text-foreground-700 mb-1.5 block">At times</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {(frequency.dailyTimes || ['09:00']).map((t, i) => (
                    <input
                      key={i}
                      type="time"
                      value={t}
                      onChange={(e) => {
                        const newTimes = [...(frequency.dailyTimes || [])];
                        newTimes[i] = e.target.value;
                        onChange({ ...frequency, dailyTimes: newTimes });
                      }}
                      className="h-9 px-3 text-sm bg-background-50 border border-background-200/70 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                    />
                  ))}
                  <button
                    onClick={() =>
                      onChange({
                        ...frequency,
                        dailyTimes: [...(frequency.dailyTimes || ['09:00']), '17:00'],
                      })
                    }
                    className="h-9 w-9 rounded-lg border border-dashed border-background-300 hover:border-primary-300 hover:bg-primary-50 flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <i className="ri-add-line text-foreground-400"></i>
                  </button>
                </div>
              </div>
            )}

            {frequency.type === 'weekly' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-foreground-700 mb-1.5 block">On days</label>
                  <div className="flex items-center gap-1">
                    {weekDays.map((day, i) => (
                      <button
                        key={day}
                        onClick={() => {
                          const days = frequency.weeklyDays || [1];
                          const newDays = days.includes(i)
                            ? days.filter((d) => d !== i)
                            : [...days, i].sort();
                          if (newDays.length > 0) {
                            onChange({ ...frequency, weeklyDays: newDays });
                          }
                        }}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                          (frequency.weeklyDays || [1]).includes(i)
                            ? 'bg-primary-500 text-white'
                            : 'bg-background-50 text-foreground-500 hover:bg-background-100'
                        }`}
                      >
                        {day.slice(0, 2)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-700 mb-1.5 block">At times</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(frequency.weeklyTimes || ['09:00']).map((t, i) => (
                      <input
                        key={i}
                        type="time"
                        value={t}
                        onChange={(e) => {
                          const newTimes = [...(frequency.weeklyTimes || [])];
                          newTimes[i] = e.target.value;
                          onChange({ ...frequency, weeklyTimes: newTimes });
                        }}
                        className="h-9 px-3 text-sm bg-background-50 border border-background-200/70 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                      />
                    ))}
                    <button
                      onClick={() =>
                        onChange({
                          ...frequency,
                          weeklyTimes: [...(frequency.weeklyTimes || ['09:00']), '17:00'],
                        })
                      }
                      className="h-9 w-9 rounded-lg border border-dashed border-background-300 hover:border-primary-300 hover:bg-primary-50 flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <i className="ri-add-line text-foreground-400"></i>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {frequency.type === 'monthly' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-foreground-700 mb-1.5 block">On day of month</label>
                  <input
                    type="number"
                    value={frequency.monthlyDay || 1}
                    onChange={(e) =>
                      onChange({
                        ...frequency,
                        monthlyDay: Math.min(28, Math.max(1, parseInt(e.target.value) || 1)),
                      })
                    }
                    min={1}
                    max={28}
                    className="w-24 h-9 px-3 text-sm bg-background-50 border border-background-200/70 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-700 mb-1.5 block">At times</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(frequency.monthlyTimes || ['09:00']).map((t, i) => (
                      <input
                        key={i}
                        type="time"
                        value={t}
                        onChange={(e) => {
                          const newTimes = [...(frequency.monthlyTimes || [])];
                          newTimes[i] = e.target.value;
                          onChange({ ...frequency, monthlyTimes: newTimes });
                        }}
                        className="h-9 px-3 text-sm bg-background-50 border border-background-200/70 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}