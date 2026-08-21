#!/usr/bin/env node
'use strict';

/**
 * Count OpenedToday / ClosedToday from live Kissflow process list (Lead Tracker style).
 *
 * Env:
 *   KISSFLOW_ACCOUNT_ID, KISSFLOW_KEY (or KISSFLOW_KEY_ID), KISSFLOW_SECRET
 *   PROCESS_ID (required)
 *   APPLICATION_ID (optional — enables ITSM business-closed rules)
 *   ENTITY_FILTER (optional — e.g. Refex; empty = all entities)
 *   KISSFLOW_HOST (optional, default refexgroup.kissflow.com)
 *
 * Prints JSON: { opened_today, closed_today, item_count, entity_filter }
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
  return pickEntity(raw).toLowerCase() === entityFilter.toLowerCase();
}

function normalizeStatus(raw) {
  const s = String(raw?._status || raw?.Status || raw?.process_status || '').trim();
  return s;
}

function isItsmBusinessClosed(raw) {
  const status = normalizeStatus(raw);
  const step = String(raw?._current_step || raw?.Current_Step || '').toLowerCase();
  if (status === 'Completed' || status === 'Closed') return true;
  if (status === 'InProgress' && step.includes('it tech reopen')) return true;
  return false;
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

function itemCompletedAt(raw) {
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
  let scoped = 0;
  for (const raw of items) {
    if (!entityMatches(raw)) continue;
    scoped += 1;
    if (isTodayIst(itemCreatedAt(raw))) openedToday += 1;
    if (isTodayIst(itemCompletedAt(raw))) closedToday += 1;
  }
  process.stdout.write(
    JSON.stringify({
      opened_today: openedToday,
      closed_today: closedToday,
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
