'use strict';

const DEFAULT_REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';

function getDatePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
  };
}

function isSameCalendarDay(a, b, timeZone = DEFAULT_REPORT_TIMEZONE) {
  const left = getDatePartsInTimeZone(a, timeZone);
  const right = getDatePartsInTimeZone(b, timeZone);
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

function isLoggedInToday(lastSignIn, timeZone = DEFAULT_REPORT_TIMEZONE) {
  if (!lastSignIn) return false;
  const login = new Date(lastSignIn);
  if (Number.isNaN(login.getTime())) return false;
  return isSameCalendarDay(login, new Date(), timeZone);
}

function snapshotAgeHours(snapshotAt) {
  if (!snapshotAt) return null;
  const ts = new Date(snapshotAt);
  if (Number.isNaN(ts.getTime())) return null;
  return (Date.now() - ts.getTime()) / (1000 * 60 * 60);
}

module.exports = {
  DEFAULT_REPORT_TIMEZONE,
  isLoggedInToday,
  isSameCalendarDay,
  snapshotAgeHours,
};
