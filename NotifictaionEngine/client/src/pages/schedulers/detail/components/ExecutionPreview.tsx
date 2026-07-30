import { useMemo } from 'react';
import type { Scheduler } from '@/mocks/schedulers';

interface ExecutionPreviewProps {
  scheduler: Scheduler;
  isOpen: boolean;
  onToggle: () => void;
}

function simulateNextExecutions(
  frequency: Scheduler['frequency'],
  count: number = 5,
): Date[] {
  const now = new Date();
  const results: Date[] = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(now);

    if (frequency.type === 'interval') {
      d.setMinutes(d.getMinutes() + (frequency.intervalMinutes || 30) * (i + 1));
    } else if (frequency.type === 'daily') {
      d.setDate(d.getDate() + i + 1);
      const times = frequency.dailyTimes || ['09:00'];
      const time = times[Math.min(i, times.length - 1)];
      const [h, m] = time.split(':').map(Number);
      d.setHours(h, m, 0, 0);
    } else if (frequency.type === 'weekly') {
      d.setDate(d.getDate() + (i + 1) * 7);
      const times = frequency.weeklyTimes || ['09:00'];
      const time = times[Math.min(i, times.length - 1)];
      const [h, m] = time.split(':').map(Number);
      d.setHours(h, m, 0, 0);
    } else if (frequency.type === 'monthly') {
      d.setMonth(d.getMonth() + i + 1);
      d.setDate(Math.min(frequency.monthlyDay || 1, 28));
      const times = frequency.monthlyTimes || ['09:00'];
      const time = times[Math.min(i, times.length - 1)];
      const [h, m] = time.split(':').map(Number);
      d.setHours(h, m, 0, 0);
    } else {
      d.setDate(d.getDate() + i + 1);
      d.setHours(9, 0, 0, 0);
    }
    results.push(new Date(d));
  }
  return results;
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ` at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ExecutionPreview({ scheduler, isOpen, onToggle }: ExecutionPreviewProps) {
  const nextRuns = useMemo(
    () => simulateNextExecutions(scheduler.frequency, 5),
    [scheduler.frequency],
  );

  const activeTriggers = scheduler.triggers.filter((t) => t.enabled);
  const totalScheduled = scheduler.executionCount + scheduler.errorCount;
  const successRate = totalScheduled > 0
    ? Math.round((scheduler.executionCount / totalScheduled) * 100)
    : 100;

  return (
    <div className="border border-background-200/70 rounded-xl bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-background-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <i className="ri-eye-line text-emerald-600"></i>
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-foreground-900">Execution Preview</h3>
            <p className="text-xs text-foreground-500 mt-0.5">
              {scheduler.status === 'active'
                ? `Next run: ${scheduler.nextExecution ? formatDateTime(new Date(scheduler.nextExecution)) : 'N/A'}`
                : 'Scheduler is not active'}
            </p>
          </div>
        </div>
        <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <i className="ri-arrow-down-s-line text-foreground-400"></i>
        </span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 border-t border-background-100">
          <div className="pt-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-background-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground-900">{scheduler.executionCount}</div>
                <div className="text-[11px] text-foreground-500 mt-0.5">Successful Runs</div>
              </div>
              <div className="bg-background-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-500">{scheduler.errorCount}</div>
                <div className="text-[11px] text-foreground-500 mt-0.5">Errors</div>
              </div>
              <div className="bg-background-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-600">{successRate}%</div>
                <div className="text-[11px] text-foreground-500 mt-0.5">Success Rate</div>
              </div>
            </div>

            {scheduler.lastExecuted && (
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <i className="ri-history-line"></i>
                Last executed: {formatDateTime(new Date(scheduler.lastExecuted))}
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold text-foreground-700 mb-2">Upcoming Executions</h4>
              <div className="space-y-2">
                {nextRuns.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2.5 bg-background-50 rounded-lg"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-500 shrink-0"></div>
                    <span className="text-xs text-foreground-800 flex-1">{formatDateTime(d)}</span>
                    <span className="text-[11px] text-foreground-400 whitespace-nowrap">
                      Run #{scheduler.executionCount + i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {activeTriggers.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-foreground-700 mb-2">
                  Active Triggers ({activeTriggers.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {activeTriggers.map((t) => (
                    <span
                      key={t.id}
                      className="px-2 py-1 rounded-md bg-accent-50 text-accent-700 text-[11px] font-medium flex items-center gap-1"
                    >
                      <i className="ri-flashlight-line"></i>
                      {t.label}
                      {t.config.days !== undefined && ` (${t.config.days}d)`}
                      {t.config.hours !== undefined && ` (${t.config.hours}h)`}
                      {t.config.status && ` → ${t.config.status}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold text-foreground-700 mb-2">Recipients</h4>
              <div className="flex flex-wrap gap-1.5">
                {scheduler.recipients.map((r, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 rounded-md bg-secondary-50 text-secondary-700 text-[11px] font-medium flex items-center gap-1"
                  >
                    <i className={r.type === 'email' ? 'ri-mail-line' : 'ri-user-line'}></i>
                    {r.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}