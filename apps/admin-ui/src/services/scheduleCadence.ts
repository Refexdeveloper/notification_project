/** Convert friendly schedule UI ↔ Cloud Scheduler cron + timezone. */

export type SchedulePattern = 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleCadenceState {
  pattern: SchedulePattern;
  /** HH:mm (24h) */
  time: string;
  /** 0=Sun … 6=Sat — used when pattern is weekly */
  weekday: number;
  /** 1–28 — used when pattern is monthly */
  monthDay: number;
  /** Raw cron when pattern is cron */
  cronExpression: string;
  timezone: string;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseTimeParts(time: string): { hour: number; minute: number } {
  const [hhRaw, mmRaw] = String(time || '09:00').split(':');
  const hour = Number(hhRaw);
  const minute = Number(mmRaw);
  return {
    hour: Number.isFinite(hour) ? hour : 9,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

export function cadenceStateToCron(state: ScheduleCadenceState): string {
  if (state.pattern === 'cron') {
    return state.cronExpression.trim() || '0 9 * * *';
  }
  const { hour, minute } = parseTimeParts(state.time);
  if (state.pattern === 'weekdays') {
    return `${minute} ${hour} * * 1-5`;
  }
  if (state.pattern === 'weekends') {
    return `${minute} ${hour} * * 0,6`;
  }
  if (state.pattern === 'weekly') {
    const dow = Math.min(Math.max(state.weekday ?? 1, 0), 6);
    return `${minute} ${hour} * * ${dow}`;
  }
  if (state.pattern === 'monthly') {
    const day = Math.min(Math.max(state.monthDay || 1, 1), 28);
    return `${minute} ${hour} ${day} * *`;
  }
  return `${minute} ${hour} * * *`;
}

export function cronToCadenceState(cron: string, timezone = DEFAULT_TIMEZONE): ScheduleCadenceState {
  const parts = String(cron || '0 9 * * *').trim().split(/\s+/);
  if (parts.length < 5) {
    return {
      pattern: 'cron',
      time: '09:00',
      weekday: 1,
      monthDay: 1,
      cronExpression: cron || '0 9 * * *',
      timezone,
    };
  }

  const [minPart, hourPart, domPart, monthPart, dowPart] = parts;
  const minute = /^\d+$/.test(minPart) ? Number(minPart) : 0;
  const hour = /^\d+$/.test(hourPart) ? Number(hourPart) : 9;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const base = {
    time,
    weekday: 1,
    monthDay: 1,
    cronExpression: parts.slice(0, 5).join(' '),
    timezone,
  };

  if (domPart !== '*' && monthPart === '*' && dowPart === '*') {
    const dom = Number(domPart);
    if (Number.isFinite(dom)) {
      return { ...base, pattern: 'monthly', monthDay: dom };
    }
  }

  if (domPart === '*' && monthPart === '*') {
    if (dowPart === '*') {
      return { ...base, pattern: 'daily' };
    }
    if (dowPart === '1-5') {
      return { ...base, pattern: 'weekdays' };
    }
    if (dowPart === '0,6' || dowPart === '6,0') {
      return { ...base, pattern: 'weekends' };
    }
    if (/^\d$/.test(dowPart)) {
      return { ...base, pattern: 'weekly', weekday: Number(dowPart) };
    }
  }

  return { ...base, pattern: 'cron', cronExpression: parts.slice(0, 5).join(' ') };
}

export function describeScheduleCadence(state: ScheduleCadenceState): string {
  const tz = state.timezone || DEFAULT_TIMEZONE;
  if (state.pattern === 'cron') {
    return `${state.cronExpression || '—'} (${tz})`;
  }
  if (state.pattern === 'daily') {
    return `Daily at ${state.time} (${tz})`;
  }
  if (state.pattern === 'weekdays') {
    return `Weekdays (Mon–Fri) at ${state.time} (${tz})`;
  }
  if (state.pattern === 'weekends') {
    return `Weekends (Sat–Sun) at ${state.time} (${tz})`;
  }
  if (state.pattern === 'weekly') {
    return `Weekly on ${WEEKDAY_LABELS[state.weekday ?? 1]} at ${state.time} (${tz})`;
  }
  if (state.pattern === 'monthly') {
    return `Monthly on day ${state.monthDay || 1} at ${state.time} (${tz})`;
  }
  return `${cadenceStateToCron(state)} (${tz})`;
}

export function weekdayLabel(index: number): string {
  return WEEKDAY_LABELS[Math.min(Math.max(index, 0), 6)] || 'Monday';
}

export function weekdayShort(index: number): string {
  return WEEKDAY_SHORT[Math.min(Math.max(index, 0), 6)] || 'Mon';
}

/** Map cadence state into reportSchedulers cadence shape (for local mode compatibility). */
export function cadenceStateToReportCadence(state: ScheduleCadenceState) {
  if (state.pattern === 'cron') {
    return { type: 'cron' as const, cronExpression: cadenceStateToCron(state) };
  }
  if (state.pattern === 'weekly') {
    return { type: 'weekly' as const, time: state.time, weekday: state.weekday };
  }
  if (state.pattern === 'monthly') {
    return { type: 'monthly' as const, time: state.time, monthDay: state.monthDay };
  }
  if (state.pattern === 'weekdays' || state.pattern === 'weekends') {
    return {
      type: 'cron' as const,
      cronExpression: cadenceStateToCron(state),
    };
  }
  return { type: 'daily' as const, time: state.time };
}
