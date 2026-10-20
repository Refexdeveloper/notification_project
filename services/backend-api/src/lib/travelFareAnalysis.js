'use strict';

/**
 * Flight fare analysis for Travel MIS records.
 * Uses only fields already on the record row. No Kissflow calls.
 */

const DEFAULT_POLICY = {
  minAdvanceDays: 7,
  fareCapMultiplier: 1.25,
  minRouteSamples: 3,
  lowestFareBandPct: 0.03,
  lowestFareWindowHours: 3,
};

function isFlightMode(travelMode) {
  const text = String(travelMode || '').trim().toLowerCase();
  if (!text) return false;
  if (text.includes('flight')) return true;
  // "air" / "by air" — not "chair"
  return /(^|[^a-z])air([^a-z]|$)/.test(text);
}

function fareRoute(fromCity, toCity) {
  const from = String(fromCity || '').trim().toUpperCase();
  const to = String(toCity || '').trim().toUpperCase();
  if (!from || !to || from === '—' || to === '—') return '';
  return `${from}-${to}`;
}

function toTime(value) {
  if (!value) return NaN;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : NaN;
}

function wholeDays(later, earlier) {
  const a = toTime(later);
  const b = toTime(earlier);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((a - b) / 86400000);
}

function median(values) {
  const sorted = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function hasFareOptions(row) {
  const options = row && (row.fare_options || row.search_fares || row.fare_quotes);
  return Array.isArray(options) && options.length > 0;
}

function hasCabinAndGrade(row) {
  const cabin = String(row?.cabin_class || row?.class_of_travel || '').trim();
  const grade = String(row?.employee_grade || row?.grade || '').trim();
  return Boolean(cabin && grade && cabin !== '—' && grade !== '—');
}

function annotate(rows, policy = DEFAULT_POLICY) {
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };
  const list = Array.isArray(rows) ? rows : [];
  const routeAmounts = new Map();

  for (const row of list) {
    if (!isFlightMode(row?.travel_mode)) continue;
    const route = fareRoute(row.from_city, row.to_city);
    if (!route) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const bucket = routeAmounts.get(route) || [];
    bucket.push(amount);
    routeAmounts.set(route, bucket);
  }

  const routeMedians = new Map();
  for (const [route, amounts] of routeAmounts.entries()) {
    routeMedians.set(route, {
      median: median(amounts),
      samples: amounts.length,
    });
  }

  return list.map((row) => {
    if (!isFlightMode(row?.travel_mode)) {
      return {
        ...row,
        fare_check: 'n/a',
        fare_flags: [],
        advance_check: 'not evaluated',
        cap_check: 'not evaluated',
        lowest_fare_check: 'not evaluated',
        cabin_check: 'not evaluated',
      };
    }

    const route = fareRoute(row.from_city, row.to_city) || undefined;
    const days = wholeDays(row.departure_date, row.created_at);
    const stats = route ? routeMedians.get(route) : null;
    const routeMedian = stats && Number.isFinite(stats.median) ? stats.median : null;
    const amount = Number(row.amount);
    const overMedianPct = (
      Number.isFinite(amount) && routeMedian != null && routeMedian > 0
        ? (amount - routeMedian) / routeMedian
        : null
    );

    let advanceCheck = 'not evaluated';
    if (days != null) {
      advanceCheck = days >= cfg.minAdvanceDays ? 'pass' : 'fail';
    }

    let capCheck = 'not evaluated';
    if (stats && stats.samples >= cfg.minRouteSamples && routeMedian != null && Number.isFinite(amount)) {
      capCheck = amount <= routeMedian * cfg.fareCapMultiplier ? 'pass' : 'fail';
    }

    const lowestFareCheck = hasFareOptions(row) ? 'not evaluated' : 'not evaluated';
    const cabinCheck = hasCabinAndGrade(row) ? 'not evaluated' : 'not evaluated';

    const flags = [];
    if (advanceCheck === 'fail') flags.push('Late booking');
    if (capCheck === 'fail') flags.push('Over fare cap');

    let fareCheck = 'Not evaluated';
    if (capCheck === 'fail') fareCheck = 'Blocked';
    else if (advanceCheck === 'fail') fareCheck = 'Flagged';
    else if (advanceCheck === 'pass' || capCheck === 'pass') fareCheck = 'Compliant';

    return {
      ...row,
      fare_route: route,
      advance_days: days,
      route_median: routeMedian,
      over_median_pct: overMedianPct,
      advance_check: advanceCheck,
      cap_check: capCheck,
      lowest_fare_check: lowestFareCheck,
      cabin_check: cabinCheck,
      fare_flags: flags,
      fare_check: fareCheck,
    };
  });
}

module.exports = {
  DEFAULT_POLICY,
  annotate,
  isFlightMode,
  fareRoute,
};
