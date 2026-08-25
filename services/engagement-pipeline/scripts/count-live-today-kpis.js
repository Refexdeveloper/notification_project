#!/usr/bin/env node
'use strict';

/**
 * Count OpenedToday / ClosedToday from live Kissflow process list (Lead Tracker style).
 *
 * ITSM Closed / Today Closed / Today Open match Admin All rules from
 * aasik_ITSM `kfITServiceDashboard.js` (isRefexServiceClosedTicket +
 * isDashboardRowClosedToday). No Me / My Team / Closed By filter.
 *
 * Env:
 *   KISSFLOW_ACCOUNT_ID, KISSFLOW_KEY (or KISSFLOW_KEY_ID), KISSFLOW_SECRET
 *   PROCESS_ID (required)
 *   APPLICATION_ID (optional — enables ITSM business-closed rules)
 *   ENTITY_FILTER (optional — e.g. Refex; empty = all entities)
 *   KISSFLOW_HOST (optional, default refexgroup.kissflow.com)
 *
 * Prints JSON: { opened_today, closed_today, open_tickets, closed_tickets, total_tickets, ... }
 */
const https = require('https');

const TZ = 'Asia/Kolkata';
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const ITSM_APP_ID = 'IT_Service_Management_A00';

const host = (process.env.KISSFLOW_HOST || 'refexgroup.kissflow.com').replace(/^https?:\/\//, '');
const accountId = process.env.KISSFLOW_ACCOUNT_ID || '';
const keyId = process.env.KISSFLOW_KEY || process.env.KISSFLOW_KEY_ID || '';
const keySecret = process.env.KISSFLOW_SECRET || '';
const processId = process.env.PROCESS_ID || process.env.ITSM_PROCESS_ID || process.env.PM_PROCESS_ID || process.env.SOLAR_PROCESS_ID || '';
const applicationId = process.env.APPLICATION_ID || process.env.ITSM_APP_ID || '';
const entityFilter = String(process.env.ENTITY_FILTER || '').trim();

function istDateKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

function isTodayIst(isoOrDate) {
  if (!isoOrDate) return false;
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return false;
  return istDateKey(d) === istDateKey(new Date());
}

function coerceKissflowDate(val) {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    const ms = val > 1e12 ? val : val * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof val === 'object') {
    return coerceKissflowDate(val.v || val.dv || val.Date || val.date || null);
  }
  if (typeof val !== 'string') return null;
  const t = val.trim();
  if (!t || !/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  if (/Z$|[+-]\d{2}(:?\d{2})?$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Naive datetime → treat as IST wall clock
  const d = new Date(`${t.replace(' ', 'T')}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pickDateTime(obj, keys) {
  for (const key of keys) {
    const parsed = coerceKissflowDate(obj?.[key]);
    if (parsed) return parsed;
  }
  return null;
}

function pickEntity(raw) {
  const e = raw?.Entity;
  if (typeof e === 'string' && e.trim()) return e.trim();
  if (e && typeof e === 'object') {
    const name = e.Name || e.name || e.Value || e.v;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return '';
}

function entityMatches(raw) {
  if (!entityFilter || entityFilter === 'all' || entityFilter === '*') return true;
  const entity = pickEntity(raw);
  // Classic Refex report: include blank Entity (many live tickets omit the field).
  if (!entity && entityFilter.toLowerCase() === 'refex') return true;
  return entity.toLowerCase() === entityFilter.toLowerCase();
}

function normalizeStatus(raw) {
  return String(raw?._status || raw?.Status || raw?.process_status || '').trim();
}

function statusToken(raw) {
  return normalizeStatus(raw).toLowerCase().replace(/[\s_-]+/g, '');
}

function currentStep(raw) {
  return String(raw?._current_step || raw?.Current_Step || '').trim();
}

function stepLower(raw) {
  return currentStep(raw).toLowerCase();
}

/** Rejected ≠ Closed (dashboard isRefexServiceRejectedTicket). */
function isItsmRejected(raw) {
  const candidates = [
    raw?._status,
    raw?.Status,
    raw?.systemStatus,
    raw?.Statu_1,
    raw?.Validation,
    raw?.Status_Validation,
  ];
  for (const value of candidates) {
    const token = String(value || '')
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (token === 'rejected' || token === 'reject' || token === 'declined') return true;
  }
  return false;
}

function isItsmCancelled(raw) {
  const candidates = [raw?.Statu_1, raw?.Validation, raw?.Status_Validation, raw?.Status, raw?._status];
  for (const value of candidates) {
    const token = String(value || '')
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (token === 'cancelled' || token === 'canceled') return true;
  }
  return false;
}

/**
 * Reopen hold step — Refex IT Tech Reopen / Extrovis ReOpen Window / Employee Feedback.
 * Mirrors aasik_ITSM isEmployeeApprovalRefexStep (step-name path only).
 */
function isItsmReopenHoldStep(raw) {
  const token = statusToken(raw);
  if (token === 'completed' || token === 'complete' || token === 'withdrawn') return false;
  const step = stepLower(raw);
  if (!step) return false;
  if (
    step.includes('it agent pickup') ||
    step.includes('it agent pick up') ||
    step.includes('it agent solution') ||
    (step.includes('tech support') && !step.includes('reopen')) ||
    step === 'it tech' ||
    step.includes('dependency')
  ) {
    return false;
  }
  return (
    step === 'it tech reopen' ||
    step.includes('it tech reopen') ||
    step === 'reopen window' ||
    step.includes('reopen window') ||
    step.includes('employee feedback') ||
    step.includes('employee verification') ||
    step === 'ticket reopen' ||
    (step.includes('ticket reopen') && !step.includes('reopened'))
  );
}

/** Kissflow process Completed only — not Statu_1 / Validation Closed. */
function isItsmProcessCompleted(raw) {
  const token = statusToken(raw);
  if (token === 'completed' || token === 'complete') return true;
  if (token === 'inprogress' || token === 'pending' || token === 'draft' || token === 'assigned') {
    return false;
  }
  if (token === 'open' || token === 'closed' || token === 'close') return false;
  const step = stepLower(raw).replace(/[\s_-]+/g, '');
  return step === 'completed' || step === 'complete';
}

/**
 * Admin All Closed KPI — aasik_ITSM isRefexServiceClosedTicket.
 * No Closed By / Me filter.
 */
function isItsmBusinessClosed(raw) {
  if (isItsmRejected(raw)) return false;
  if (isItsmReopenHoldStep(raw)) return true;
  return isItsmProcessCompleted(raw);
}

/** Base Open — not Closed, not Rejected, not Cancelled. */
function isItsmBusinessOpen(raw) {
  if (isItsmRejected(raw)) return false;
  if (isItsmBusinessClosed(raw)) return false;
  if (isItsmCancelled(raw)) return false;
  return true;
}

function isBusinessOpen(raw) {
  if (applicationId === ITSM_APP_ID) return isItsmBusinessOpen(raw);
  return normalizeStatus(raw) === 'InProgress';
}

function isBusinessClosed(raw) {
  if (applicationId === ITSM_APP_ID) return isItsmBusinessClosed(raw);
  const status = normalizeStatus(raw);
  const lead = String(raw?.Lead_Status || raw?.Status || '').toLowerCase().trim();
  return (
    status === 'Completed' ||
    status === 'Closed' ||
    lead === 'close' ||
    lead === 'closed' ||
    lead === 'completed' ||
    lead === 'done'
  );
}

function itemCreatedAt(raw) {
  return pickDateTime(raw, [
    '_created_at',
    'Requested_Date',
    'Requester_Date__Time',
    '_submitted_at',
    'CreatedAt',
    'Created_On',
  ]);
}

/**
 * Closed-at — aasik_ITSM getRefexClosedAtRaw:
 * reopen hold prefers _modified_at; Completed prefers explicit closed/completed then modified.
 */
function itemCompletedAt(raw) {
  if (applicationId === ITSM_APP_ID) {
    if (!isItsmBusinessClosed(raw)) return null;
    if (isItsmReopenHoldStep(raw)) {
      return (
        pickDateTime(raw, ['_modified_at']) ||
        pickDateTime(raw, ['_completed_at', '_closed_at', 'Completed_On', 'Closed_On', 'Completed_Date', 'Closed_Date'])
      );
    }
    return (
      pickDateTime(raw, [
        '_completed_at',
        '_closed_at',
        'Completed_On',
        'Closed_On',
        'Completed_Date',
        'Closed_Date',
      ]) || pickDateTime(raw, ['_modified_at'])
    );
  }
  const explicit = pickDateTime(raw, [
    '_completed_at',
    '_closed_at',
    'Completed_On',
    'Closed_On',
    'Completed_Date',
    'Closed_Date',
  ]);
  if (explicit) return explicit;
  if (!isBusinessClosed(raw)) return null;
  return pickDateTime(raw, ['_modified_at']);
}

/** Today Open (dashboard): created today and still in flight. */
function isOpenedToday(raw) {
  if (!isTodayIst(itemCreatedAt(raw))) return false;
  if (applicationId === ITSM_APP_ID) return isItsmBusinessOpen(raw);
  return true;
}

/** Today Closed (dashboard): Closed KPI + closed today. */
function isClosedToday(raw) {
  if (!isBusinessClosed(raw)) return false;
  return isTodayIst(itemCompletedAt(raw));
}

function httpsGetJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'GET',
        headers: {
          'X-Access-Key-Id': keyId,
          'X-Access-Key-Secret': keySecret,
          Accept: 'application/json',
        },
        timeout: 60000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Kissflow HTTP ${res.statusCode} for ${path}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${path}`));
    });
    req.end();
  });
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Items)) return payload.Items;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function fetchAllItems() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const path = `/process/2/${encodeURIComponent(accountId)}/admin/${encodeURIComponent(processId)}/item?page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=false`;
    const payload = await httpsGetJson(path);
    const batch = extractArray(payload);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  if (!accountId || !keyId || !keySecret || !processId) {
    console.error('Missing KISSFLOW creds or PROCESS_ID');
    process.exit(2);
  }
  const items = await fetchAllItems();
  let openedToday = 0;
  let closedToday = 0;
  let openCount = 0;
  let closedCount = 0;
  let scoped = 0;
  for (const raw of items) {
    if (!entityMatches(raw)) continue;
    scoped += 1;
    if (isBusinessOpen(raw)) openCount += 1;
    else if (isBusinessClosed(raw)) closedCount += 1;
    if (isOpenedToday(raw)) openedToday += 1;
    if (isClosedToday(raw)) closedToday += 1;
  }
  process.stdout.write(
    JSON.stringify({
      opened_today: openedToday,
      closed_today: closedToday,
      open_tickets: openCount,
      closed_tickets: closedCount,
      total_tickets: scoped,
      item_count: scoped,
      list_count: items.length,
      entity_filter: entityFilter || null,
      process_id: processId,
    }),
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
