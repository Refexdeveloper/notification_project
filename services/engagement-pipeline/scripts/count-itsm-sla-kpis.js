#!/usr/bin/env node
'use strict';

/**
 * ITSM SLA Breached (Open · Closed) for the scheduled HTML email — same rule as the
 * aasik_ITSM IT Admin dashboard (scope All, no Me / My Team), on the same Kissflow
 * process report the dashboard reads (Service_Items_Refex_A00 / All_tickets_A00).
 *
 * aasik_ITSM reference (kfITServiceDashboard.js): countServiceSlaKpiSplit with
 * matchesRefexMonitoringServiceTab(row, tab, null, 'all', 'final'):
 *   Open SLA  = Open Tickets row (Refex: agent pipeline, never approvals) that is a
 *               Service Request / Incident, Stages InProgress (else Hold — no clock),
 *               and Status says breached or (now − last modified) > Closure_Time.
 *               Extrovis: only owned Solution / Dependency work (PickUp TAT is MIS-only).
 *   Closed SLA = Closed row (reopen hold or process Completed, not Rejected) whose frozen
 *               IT Agent Solution status is Breached — the report carries no step history,
 *               so this is the Status column saying breached.
 *
 * Env: KISSFLOW_ACCOUNT_ID, KISSFLOW_KEY, KISSFLOW_SECRET, PROCESS_ID (or ITSM_PROCESS_ID),
 *      ENTITY_FILTER (optional), KISSFLOW_HOST (optional)
 * Prints JSON: { sla_breached_open, sla_breached_closed, by_user: { <kissflow user id>: n }, ... }
 */
const https = require('https');
const path = require('path');
const { itsmEntityMatchesFilter } = require(path.join(__dirname, 'itsm-entity-scope.js'));

const TZ = 'Asia/Kolkata';
const PAGE_SIZE = 500;
const MAX_PAGES = 200;
const APP_ID = 'IT_Service_Management_A00';

const PROFILES = {
  refex: {
    reportId: 'Service_Items_Refex_A00',
    col: {
      currentStep: 'Column_A855mbiBz_',
      systemStatus: 'Column_oJoMWOnj-_',
      modifiedAt: 'Column_JOmYm9Frwx',
      createdAt: 'Column_7-RiedjtKg',
      closure: 'Column_EJ_2bDMtnD',
      tat: 'Column_uzB76CIUdv',
      itemStatus: 'Column_WRiZDgVSqj',
      status: 'Column_0GDnNoEuA7',
      ticketType: 'Column_EM6o5_acb3',
      requestId: 'Column_0jda6rzCc3',
      entity: 'Column_HIi7H_DTSj',
      assignedTo: 'Column_Vz3Y600Rds',
    },
    processStagesKeys: ['Column_GooYV3HuY1', 'Column_JUGHj6d2Xj', 'Stages'],
    reportStagesKeys: ['Column_Bug5EApiHs', 'Stages'],
  },
  extrovis: {
    reportId: 'All_tickets_A00',
    col: {
      currentStep: 'Column_Yf9r2UCRuu',
      systemStatus: 'Column_ApNmcvK7J8',
      modifiedAt: 'Column_QpPzei51U2',
      createdAt: 'Column_OuyTOsNWaK',
      closure: 'Column_mEZwE_B6CW',
      tat: 'Column_VO-1shRU1Q',
      itemStatus: 'Column_ps84EEKkEI',
      status: 'Column_69zTtmtO92',
      ticketType: 'Column_ngHfbXhmqj',
      requestId: 'Column_y4srngcUo1',
      entity: 'Column_KOIeT2FK23',
      assignedTo: '',
    },
    processStagesKeys: ['Column_GooYV3HuY1', 'Column_JUGHj6d2Xj', 'Stages'],
    ticketStatusKeys: ['Statu_1', 'Column_ps84EEKkEI', 'Column_WRiZDgVSqj'],
  },
};

function text(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return String(value.Name || value.name || value.v || value.value || value.label || value.dv || '').trim();
  }
  return String(value).trim();
}

function token(value) {
  return text(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function firstText(item, keys) {
  for (const key of keys) {
    const v = text(item?.[key]);
    if (v) return v;
  }
  return '';
}

function parseSlaMinutes(value) {
  if (value == null || value === '' || value === '—') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 1_000_000 ? value / 60000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) return n > 1_000_000 ? n / 60000 : n;
    const hm = trimmed.match(/^(\d+)\s*:\s*(\d+)$/);
    if (hm) return (Number(hm[1]) * 60) + Number(hm[2]);
    const hours = trimmed.match(/^(\d+)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:in(?:utes?)?)?)?$/i);
    if (hours) return (Number(hours[1]) * 60) + (hours[2] ? Number(hours[2]) : 0);
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parseSlaMinutes(entry);
      if (parsed != null) return parsed;
    }
    return null;
  }
  if (typeof value === 'object') {
    const nested = value.Closure_Time ?? value.TurnAround_Time_TAT ?? value.SLA_Timing_Min
      ?? value.SLA_Minutes ?? value.Minutes ?? value.minutes ?? value.value;
    if (nested != null && nested !== value) {
      const parsed = parseSlaMinutes(nested);
      if (parsed != null) return parsed;
    }
    const h = Number(value.Hours ?? value.hours);
    const m = Number(value.Minutes ?? value.minutes);
    const total = (Number.isFinite(h) ? h * 60 : 0) + (Number.isFinite(m) ? m : 0);
    return total > 0 ? total : null;
  }
  return null;
}

function toMs(value) {
  const raw = text(value) || value;
  if (!raw) return null;
  const ms = typeof raw === 'number' ? (raw > 1e12 ? raw : raw * 1000) : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function istFyRange(now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const [y, m] = ymd.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return {
    from: Date.parse(`${start}-04-01T00:00:00+05:30`),
    to: Date.parse(`${start + 1}-04-01T00:00:00+05:30`),
  };
}

function isReopenHoldStep(step) {
  const s = step.toLowerCase();
  if (s.includes('reopened')) return false;
  return s.includes('it tech reopen')
    || s.includes('reopen window')
    || s.includes('employee feedback')
    || s.includes('employee verification')
    || s === 'ticket reopen'
    || s.includes('ticket reopen');
}

function isApprovalStep(step) {
  const s = step.toLowerCase();
  return /\bl1\b/.test(s) || /\bl2\b/.test(s) || s.includes('l1 approval') || s.includes('l2 approval')
    || s.includes('it manager approval') || s.includes('it head approval');
}

function classify(item, profileKey, now = Date.now()) {
  const p = PROFILES[profileKey];
  const c = p.col;
  const step = text(item?.[c.currentStep]);
  const stepLc = step.toLowerCase();
  const system = token(item?.[c.systemStatus]);
  const itemStatus = text(item?.[c.itemStatus]);
  const itemStatusLc = itemStatus.toLowerCase();
  const statusLc = text(item?.[c.status]).toLowerCase();

  const rejected = ['rejected', 'reject', 'declined'].includes(system)
    || ['rejected', 'reject', 'declined'].includes(token(itemStatus));
  const completed = system === 'completed' || system === 'complete';
  const reopenHold = isReopenHoldStep(step);
  const closed = !rejected && (reopenHold || completed);
  const cancelled = token(itemStatus) === 'cancelled' || token(itemStatus) === 'canceled';
  const open = !rejected && !closed && !cancelled;

  const ticketType = text(item?.[c.ticketType]).toLowerCase();
  const requestId = text(item?.[c.requestId]).toLowerCase();
  const serviceOrIncident = !(ticketType.includes('change request') || requestId.startsWith('it-cr'))
    && (!ticketType || ticketType === '—' || ticketType.includes('service') || ticketType.includes('incident'));

  const breachedStatus = itemStatusLc.includes('breach') || statusLc === 'sla breached' || statusLc === 'breached';

  let closedSla = false;
  if (closed && serviceOrIncident) closedSla = breachedStatus;

  let openSla = false;
  if (open && serviceOrIncident && !isApprovalStep(step)) {
    const resolvedLike = ['resolved', 'closed', 'completed'].includes(token(itemStatus))
      || itemStatusLc.includes('resolved') || itemStatusLc.includes('closed');
    let pipeline;
    let liveStage;
    let slaMinutes;
    if (profileKey === 'extrovis') {
      const pickup = stepLc.includes('it agent pickup') || stepLc.includes('it agent pick up');
      pipeline = !pickup && !stepLc.includes('reopen') && !stepLc.includes('employee feedback')
        && (stepLc.includes('solution') || stepLc.includes('dependency') || stepLc.includes('it agent'));
      const processStage = firstText(item, p.processStagesKeys);
      const ticketStage = firstText(item, p.ticketStatusKeys);
      liveStage = token(processStage) === 'inprogress' || token(ticketStage) === 'inprogress';
      slaMinutes = parseSlaMinutes(item?.[c.closure]) ?? parseSlaMinutes(item?.[c.tat]);
    } else {
      pipeline = stepLc.includes('it tech') || stepLc.includes('tech support') || stepLc.includes('pickup')
        || stepLc.includes('pick up') || stepLc.includes('dependency') || stepLc.includes('it agent');
      const processStage = firstText(item, p.processStagesKeys);
      if (processStage) {
        liveStage = token(processStage) === 'inprogress';
      } else {
        const reportStage = firstText(item, p.reportStagesKeys);
        liveStage = reportStage ? token(reportStage) === 'inprogress' : true;
      }
      slaMinutes = parseSlaMinutes(item?.[c.closure]) ?? parseSlaMinutes(item?.[c.tat]);
    }
    if (pipeline && liveStage && !resolvedLike) {
      if (breachedStatus) {
        openSla = true;
      } else if (slaMinutes) {
        const start = toMs(item?.[c.modifiedAt]) ?? toMs(item?._modified_at) ?? toMs(item?.[c.createdAt]);
        openSla = Boolean(start && (now - start) / 60000 > slaMinutes);
      }
    }
  }

  return { open, closed, openSla, closedSla, requestId: text(item?.[c.requestId]) };
}

function assigneeIds(item, profileKey) {
  const key = PROFILES[profileKey].col.assignedTo;
  const value = key ? item?.[key] : null;
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return list.map((entry) => (entry && typeof entry === 'object' ? String(entry._id || entry.id || '') : '')).filter(Boolean);
}

/** Pure counter — exported for tests. */
function countItsmSla(items, { profileKey = 'refex', entityFilter = '', now = Date.now() } = {}) {
  const fy = istFyRange(new Date(now));
  const want = String(entityFilter || '').trim();
  const scoped = (items || []).filter((item) => {
    if (!want || want === 'all' || want === '*') return true;
    const entity = text(item?.[PROFILES[profileKey].col.entity]);
    // Refex report = whole Refex queue (Venwind / Pharma Products included), like the dashboard Refex tab.
    if (profileKey === 'refex' && want.toLowerCase() === 'refex') return true;
    return itsmEntityMatchesFilter(entity, want);
  });
  let open = 0;
  let closed = 0;
  const byUser = {};
  const openIds = [];
  scoped.forEach((item) => {
    const r = classify(item, profileKey, now);
    if (r.closedSla) {
      const created = toMs(item?.[PROFILES[profileKey].col.createdAt]);
      if (created == null || (created >= fy.from && created < fy.to)) closed += 1;
      return;
    }
    if (r.openSla) {
      open += 1;
      openIds.push(r.requestId);
      assigneeIds(item, profileKey).forEach((id) => { byUser[id] = (byUser[id] || 0) + 1; });
    }
  });
  return { sla_breached_open: open, sla_breached_closed: closed, by_user: byUser, rows: scoped.length, open_ids: openIds };
}

function httpsGetJson(host, path, keyId, keySecret) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path,
      method: 'GET',
      headers: { 'X-Access-Key-Id': keyId, 'X-Access-Key-Secret': keySecret, Accept: 'application/json' },
      timeout: 60000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Kissflow HTTP ${res.statusCode} for ${path}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout ${path}`)); });
    req.end();
  });
}

async function fetchReport({ host, accountId, processId, reportId, keyId, keySecret }) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const path = `/process-report/2/${encodeURIComponent(accountId)}/${encodeURIComponent(processId)}/${encodeURIComponent(reportId)}?page_number=${page}&page_size=${PAGE_SIZE}&_application_id=${APP_ID}`;
    const payload = await httpsGetJson(host, path, keyId, keySecret);
    const batch = Array.isArray(payload?.Data) ? payload.Data : (Array.isArray(payload) ? payload : []);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  const host = (process.env.KISSFLOW_HOST || 'refexgroup.kissflow.com').replace(/^https?:\/\//, '');
  const accountId = process.env.KISSFLOW_ACCOUNT_ID || 'AcCMptlq60zH';
  const keyId = process.env.KISSFLOW_KEY || process.env.KISSFLOW_KEY_ID || '';
  const keySecret = process.env.KISSFLOW_SECRET || '';
  const processId = process.env.PROCESS_ID || process.env.ITSM_PROCESS_ID || '';
  if (!keyId || !keySecret || !processId) throw new Error('KISSFLOW_KEY, KISSFLOW_SECRET and PROCESS_ID are required');
  const profileKey = /extrovis/i.test(processId) ? 'extrovis' : 'refex';
  const items = await fetchReport({
    host, accountId, processId, reportId: PROFILES[profileKey].reportId, keyId, keySecret,
  });
  const result = countItsmSla(items, { profileKey, entityFilter: process.env.ENTITY_FILTER || '' });
  delete result.open_ids;
  process.stdout.write(`${JSON.stringify({ ...result, process_id: processId, report_id: PROFILES[profileKey].reportId })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`count-itsm-sla-kpis: ${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = { countItsmSla, classify, PROFILES };
