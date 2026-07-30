/** Convert friendly schedule UI ↔ Cloud Scheduler cron + timezone. */

export type SchedulePattern =
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'monthly'
  | 'weekday_interval'
  | 'cron';

export interface ScheduleCadenceState {
  pattern: SchedulePattern;
  /** HH:mm (24h) */
  time: string;
  /** 0=Sun … 6=Sat — used when pattern is weekly */
  weekday: number;
  /** 1–28 — used when pattern is monthly */
  monthDay: number;
  /** Weekday interval: first hour (e.g. 9 for 9 AM) */
  startHour: number;
  /** Weekday interval: last hour in range (e.g. 18 for 6 PM) */
  endHour: number;
  /** Weekday interval: step in hours (e.g. 2 = every two hours) */
  intervalHours: number;
  /** Raw cron when pattern is cron */
  cronExpression: string;
  timezone: string;
}

export const DEFAULT_WEEKDAY_INTERVAL = {
  startHour: 9,
  endHour: 18,
  intervalHours: 2,
  minute: 0,
} as const;

/** ITSM legacy Cloud Scheduler: weekdays 9 AM–6 PM every 2 hours. */
export const ITSM_WEEKDAY_INTERVAL_CRON = '0 9-18/2 * * 1-5';

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
  if (state.pattern === 'weekday_interval') {
    const start = Math.min(Math.max(state.startHour ?? DEFAULT_WEEKDAY_INTERVAL.startHour, 0), 23);
    const end = Math.min(Math.max(state.endHour ?? DEFAULT_WEEKDAY_INTERVAL.endHour, start), 23);
    const step = Math.min(Math.max(state.intervalHours ?? DEFAULT_WEEKDAY_INTERVAL.intervalHours, 1), 12);
    const intervalMinute = Number.isFinite(minute) ? minute : 0;
    return `${intervalMinute} ${start}-${end}/${step} * * 1-5`;
  }
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
      startHour: DEFAULT_WEEKDAY_INTERVAL.startHour,
      endHour: DEFAULT_WEEKDAY_INTERVAL.endHour,
      intervalHours: DEFAULT_WEEKDAY_INTERVAL.intervalHours,
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
    startHour: DEFAULT_WEEKDAY_INTERVAL.startHour,
    endHour: DEFAULT_WEEKDAY_INTERVAL.endHour,
    intervalHours: DEFAULT_WEEKDAY_INTERVAL.intervalHours,
    cronExpression: parts.slice(0, 5).join(' '),
    timezone,
  };

  const intervalMatch = /^(\d{1,2})-(\d{1,2})\/(\d{1,2})$/.exec(hourPart);
  if (intervalMatch && domPart === '*' && monthPart === '*' && dowPart === '1-5') {
    return {
      ...base,
      pattern: 'weekday_interval',
      time: `${String(Number(intervalMatch[1])).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      startHour: Number(intervalMatch[1]),
      endHour: Number(intervalMatch[2]),
      intervalHours: Number(intervalMatch[3]),
    };
  }

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
  if (state.pattern === 'weekday_interval') {
    const start = state.startHour ?? DEFAULT_WEEKDAY_INTERVAL.startHour;
    const end = state.endHour ?? DEFAULT_WEEKDAY_INTERVAL.endHour;
    const step = state.intervalHours ?? DEFAULT_WEEKDAY_INTERVAL.intervalHours;
    const times = weekdayIntervalTimes(start, end, step, parseTimeParts(state.time).minute);
    return `Weekdays every ${step} hours (${formatHour12(start)}–${formatHour12(end)}): ${times.join(', ')} (${tz})`;
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

function formatHour12(hour24: number): string {
  const h = Math.min(Math.max(hour24, 0), 23);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${suffix}`;
}

/** Match Cloud Scheduler step syntax: e.g. 9-18/2 → 9, 11, 13, 15, 17 */
export function weekdayIntervalTimes(
  startHour: number,
  endHour: number,
  intervalHours: number,
  minute = 0,
): string[] {
  const start = Math.min(Math.max(startHour, 0), 23);
  const end = Math.min(Math.max(endHour, start), 23);
  const step = Math.min(Math.max(intervalHours, 1), 12);
  const mm = String(Math.min(Math.max(minute, 0), 59)).padStart(2, '0');
  const times: string[] = [];
  for (let h = start; h <= end; h += step) {
    times.push(`${String(h).padStart(2, '0')}:${mm}`);
  }
  return times;
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
  if (state.pattern === 'weekdays' || state.pattern === 'weekends' || state.pattern === 'weekday_interval') {
    return {
      type: 'cron' as const,
      cronExpression: cadenceStateToCron(state),
    };
  }
  return { type: 'daily' as const, time: state.time };
}
