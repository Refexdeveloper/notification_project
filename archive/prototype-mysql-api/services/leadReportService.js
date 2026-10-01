/**
 * Lead Tracker report builder — live Kissflow leads + fresh user login detail per send.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const adminUiEnv = path.join(__dirname, '../../../apps/admin-ui/.env.local');
require('dotenv').config({ path: adminUiEnv });

const PROCESS_ID = 'Lead_tracker_1_A00';
const VENWIND_PROCESS_ID = 'Vindview_Sales_Management_A00';
/** Ingest uses 100. 1000-byte pages can return truncated JSON on Cloud Run → silent 0 counts. */
const PAGE_SIZE = 100;
const TZ = 'Asia/Kolkata';
const LEAD_WEBSITES = [
  { groupName: '3iMedtech', websiteFilter: '3iMedtech', slug: '3i' },
  { groupName: 'Refex Mobility', websiteFilter: 'Refex Mobility', slug: 'refex-mobility' },
  { groupName: 'Adonis', websiteFilter: 'Adonis', slug: 'adonis' },
  { groupName: 'Modepro', websiteFilter: 'Modepro', slug: 'modepro' },
  { groupName: 'Venwind', websiteFilter: 'Venwind', slug: 'venwind' },
];

function canonicalizeWebsiteFilter(value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return '';
  const match = LEAD_WEBSITES.find((g) => {
    const names = [g.groupName, g.websiteFilter, g.slug].map((v) => String(v).toLowerCase());
    return names.some((n) => n === needle || n.includes(needle) || needle.includes(n));
  });
  return match ? match.websiteFilter : String(value || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const REPO_ROOT = process.env.REPO_ROOT || path.join(__dirname, '../../..');
const LEAD_TRACKER_TEMPLATE_PATH = path.join(
  REPO_ROOT,
  'db/seeds/lead-tracker-report-template.html',
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeLeadTemplateHtml(html) {
  return String(html || '')
    .replace(/refex-logo\.png/gi, 'refexone-logo.png')
    .replace(/alt="Refex"/gi, 'alt="refexOne"');
}

function resolveContentRef(contentRef) {
  if (!contentRef || !String(contentRef).trim()) return null;
  const trimmed = String(contentRef).trim();
  if (trimmed.startsWith('<')) return normalizeLeadTemplateHtml(trimmed);
  const abs = path.isAbsolute(trimmed) ? trimmed : path.join(REPO_ROOT, trimmed);
  if (fs.existsSync(abs)) {
    return normalizeLeadTemplateHtml(fs.readFileSync(abs, 'utf8'));
  }
  return null;
}

function loadLeadTrackerTemplateFromPg() {
  const templateId = (process.env.TEMPLATE_ID || '').trim();
  if (!UUID_RE.test(templateId)) return null;

  const pgHost = process.env.PGHOST || 'localhost';
  const pgPort = process.env.PGPORT || '5432';
  const pgDb = process.env.PGDATABASE || 'engagement_reporting';
  const pgUser = process.env.PGUSER || 'postgres';

  try {
    const contentRef = execFileSync(
      'psql',
      [
        `host=${pgHost} port=${pgPort} dbname=${pgDb} user=${pgUser}`,
        '-t',
        '-A',
        '-c',
        `SELECT COALESCE((SELECT rtv.content_ref FROM engagement_reporting.report_template_version rtv WHERE rtv.report_template_id = '${templateId}'::uuid ORDER BY rtv.version_number DESC LIMIT 1), '')`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
    return resolveContentRef(contentRef);
  } catch {
    return null;
  }
}

function replaceTemplateVariables(templateBody, variables = {}) {
  let body = String(templateBody || '');
  for (const key of Object.keys(variables)) {
    const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), String(variables[key] ?? ''));
  }
  return body;
}

function loadSeedLeadTrackerTemplate() {
  if (fs.existsSync(LEAD_TRACKER_TEMPLATE_PATH)) {
    return normalizeLeadTemplateHtml(fs.readFileSync(LEAD_TRACKER_TEMPLATE_PATH, 'utf8'));
  }
  return null;
}

function loadLeadTrackerTemplate() {
  const fromPg = loadLeadTrackerTemplateFromPg();
  // Published preview HTML can bake in 0s and drop {{TotalLeads}} — always need placeholders.
  if (fromPg && fromPg.includes('{{TotalLeads}}')) return fromPg;
  return loadSeedLeadTrackerTemplate();
}

function pickString(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (typeof val === 'number') return String(val);
    if (val && typeof val === 'object') {
      const nested = val;
      if (typeof nested.v === 'string' && nested.v.trim()) return nested.v.trim();
      const n = pickString(nested, ['Name', 'name', 'Email', 'DisplayName', '_id']);
      if (n) return n;
    }
  }
  return '';
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
  const withIst = /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00+05:30` : `${t}+05:30`;
  const d = new Date(withIst);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pickDateTime(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const parsed = coerceKissflowDate(obj[key]);
    if (parsed) return parsed;
  }
  return null;
}

function leadCreatedAt(lead) {
  // Dashboard FY / created_at uses Kissflow _created_at only — do not fall through
  // to Requested_Date or that extra lead is counted in email but not on the dashboard.
  return pickDateTime(lead, ['_created_at']);
}

function isLeadDraftItem(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const parts = [
    obj._status,
    obj.Status,
    obj.process_status,
    obj.Process_Status,
    obj._current_step,
    obj.current_step,
    obj.Step,
  ];
  return parts.some((p) => String(p || '').toLowerCase().includes('draft'));
}

function dedupeLeadItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const id = String(item._id || item.Lead_ID || item.Lead_Id || item.id || '').trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(item);
  }
  return out;
}

function leadCompletedAt(lead) {
  const explicit = pickDateTime(lead, ['_completed_at', '_closed_at', 'Completed_On', 'Closed_On']);
  if (explicit) return explicit;
  if (leadStatusBucket(extractStatus(lead)) !== 'closed') return null;
  return pickDateTime(lead, ['_modified_at']);
}

function countOpenedClosedToday(leads) {
  let openedToday = 0;
  let closedToday = 0;
  for (const lead of leads || []) {
    const created = leadCreatedAt(lead);
    if (created && isLoggedInToday(created)) openedToday += 1;
    const completed = leadCompletedAt(lead);
    if (completed && isLoggedInToday(completed)) closedToday += 1;
  }
  return { openedToday, closedToday };
}

function normalizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const userId = pickString(raw, ['_id', 'Id', 'id']);
  const email = pickString(raw, ['Email', 'email', 'MailId', 'UserName']).toLowerCase();
  const name =
    pickString(raw, ['Name', 'DisplayName', 'FullName']) || email || userId;
  if (!userId && !email) return null;
  const lastLogin =
    pickDateTime(raw, [
      'LastLoggedInAt',
      'LastLogin',
      'LastSignedIn',
      'LastActive',
      'LastLoginAt',
      'LastActivity',
      'last_login',
      'LastAccessedAt',
    ]) || null;
  return { userId: userId || email, email, name, lastLogin, raw };
}

async function kissflowFetch(host, keyId, keySecret, apiPath, { retries = 4 } = {}) {
  const url = `https://${host}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Access-Key-Id': keyId,
          'X-Access-Key-Secret': keySecret,
        },
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`Kissflow ${apiPath}: ${res.status}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Kissflow ${apiPath}: invalid JSON (${text.length} bytes)`);
        }
      }
      if (!res.ok) throw new Error(`Kissflow ${apiPath}: ${res.status}`);
      return data;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (!/429|503|invalid JSON|fetch/i.test(msg) || attempt === retries) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['Data', 'data', 'Users', 'users', 'Items', 'items']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

function getKissflowConfig() {
  const host = process.env.KISSFLOW_PROD_HOST || 'refexgroup.kissflow.com';
  const accountId =
    process.env.VITE_KISSFLOW_PROD_ACCOUNT_ID ||
    process.env.KISSFLOW_PROD_ACCOUNT_ID ||
    process.env.KISSFLOW_ACCOUNT_ID ||
    'AcCMptlq60zH';
  const keyId =
    process.env.VITE_KISSFLOW_PROD_ACCESS_KEY_ID ||
    process.env.KISSFLOW_KEY ||
    process.env.KISSFLOW_KEY_ID ||
    '';
  const keySecret =
    process.env.VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET ||
    process.env.KISSFLOW_SECRET ||
    '';
  if (!keyId || !keySecret) throw new Error('Missing prod Kissflow keys in apps/admin-ui/.env.local');
  return { host, accountId, keyId, keySecret };
}

async function fetchAllUsers(host, accountId, keyId, keySecret) {
  const all = [];
  try {
    let page = 1;
    while (page <= 50) {
      const apiPath = `/user/2/${accountId}?page_number=${page}&page_size=${PAGE_SIZE}`;
      const data = await kissflowFetch(host, keyId, keySecret, apiPath);
      const batch = asArray(data);
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      page += 1;
    }
  } catch (err) {
    console.warn(`Lead Tracker user fetch skipped: ${err.message || err}`);
  }
  return all.map(normalizeUser).filter(Boolean);
}

/** Fresh LastLoggedInAt from user detail API (called on every report send). */
async function fetchUserDetail(host, accountId, keyId, keySecret, userId) {
  if (!userId) return null;
  const apiPath = `/user/2/${accountId}/${encodeURIComponent(userId)}`;
  try {
    const data = await kissflowFetch(host, keyId, keySecret, apiPath);
    return normalizeUser(data);
  } catch {
    return null;
  }
}

async function fetchAllLeads(host, accountId, keyId, keySecret, processId = PROCESS_ID) {
  const all = [];
  let page = 1;
  while (page <= 200) {
    const apiPath = `/process/2/${accountId}/admin/${processId}/item?page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=false`;
    const data = await kissflowFetch(host, keyId, keySecret, apiPath);
    const batch = asArray(data).filter((r) => r && typeof r === 'object');
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
  }
  if (!all.length) {
    throw new Error(`Kissflow returned 0 Lead Tracker items for ${processId}`);
  }
  return all;
}

/**
 * List API omits _modified_at / _completed_at. Detail API has them — required for Closed Today.
 * Only fetch details for closed leads that still lack completion timestamps.
 */
function leadNeedsDetailEnrich(lead) {
  if (!lead || typeof lead !== 'object') return false;
  if (!extractWebsite(lead) || !leadCreatedAt(lead)) return true;
  if (leadStatusBucket(extractStatus(lead)) !== 'closed') return false;
  return !(lead._modified_at || lead._completed_at || lead._closed_at);
}

async function enrichLeadsWithDetails(host, accountId, keyId, keySecret, leads, processId = PROCESS_ID) {
  const out = leads.map((lead) => lead);
  const needDetail = [];
  for (let i = 0; i < out.length; i += 1) {
    const lead = out[i];
    if (!leadNeedsDetailEnrich(lead)) continue;
    const id = pickString(lead, ['_id', 'Id', 'id', 'Instance_ID']);
    if (!id) continue;
    needDetail.push({ index: i, id });
  }
  // Cloud Run cannot afford a detail GET per lead. Sparse list → use snapshot instead.
  if (needDetail.length > Math.max(40, Math.floor(out.length * 0.35))) {
    console.warn(
      `Lead Tracker list is sparse (${needDetail.length}/${out.length} need detail) — skipping mass detail fetch`,
    );
    return out;
  }
  const concurrency = 8;
  for (let i = 0; i < needDetail.length; i += concurrency) {
    const chunk = needDetail.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async ({ index, id }) => {
        try {
          const detail = await kissflowFetch(
            host,
            keyId,
            keySecret,
            `/process/2/${accountId}/admin/${processId}/${encodeURIComponent(id)}`,
          );
          if (detail && typeof detail === 'object') {
            out[index] = { ...out[index], ...detail, __requested_instance_id: id };
          }
        } catch {
          /* keep list row */
        }
      }),
    );
  }
  return out;
}

function extractWebsite(obj) {
  for (const key of ['Website_and_form', 'Website']) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (val && typeof val === 'object') {
      const label = pickString(val, ['Name', 'name', 'Label', 'v', 'Value', 'value', 'DisplayName']);
      if (label) return label;
    }
  }
  return '';
}

function extractSalesPerson(obj) {
  const ids = [];
  const emails = [];
  const names = [];
  const roleNames = [];
  const push = (val, allowRole = false) => {
    if (!val) return;
    if (typeof val === 'string') {
      if (val.includes('@')) emails.push(val.toLowerCase());
      else names.push(val);
      return;
    }
    if (Array.isArray(val)) return val.forEach((entry) => push(entry, allowRole));
    if (typeof val === 'object') {
      const kind = pickString(val, ['Kind', 'kind']);
      if (kind === 'AppRole') {
        if (allowRole) {
          const roleName = pickString(val, ['Name', 'name']);
          if (roleName) roleNames.push(roleName);
        }
        return;
      }
      const id = pickString(val, ['_id', 'Id']);
      const email = pickString(val, ['Email', 'email', 'Sales_Person_Email', 'Final_sales_person_email']);
      const name = pickString(val, ['Name', 'DisplayName']);
      if (id) ids.push(id);
      if (email) emails.push(email.toLowerCase());
      if (name) names.push(name);
    }
  };
  for (const key of [
    'Final_Sales_Person_user',
    'Final_sales_person_email',
    'Sales_Person_1',
    'SalesPerson',
    'Sales Person',
    'Sales_Person',
    'AssignedTo',
    'Owner',
  ]) {
    if (key in obj) push(obj[key]);
  }
  for (const key of ['Sales_Person_Lookup', 'Sales_Person_Lookup__City', 'Sales_Person_Lookup__State']) {
    const lookup = obj[key];
    if (lookup && typeof lookup === 'object' && !Array.isArray(lookup) && Object.keys(lookup).length) {
      push(lookup);
    }
  }
  if (Array.isArray(obj._current_assigned_to)) push(obj._current_assigned_to, true);
  if (!emails.length && !names.length && !ids.length && roleNames.length) names.push(...roleNames);
  return { ids, emails, names };
}

function leadStatusBucket(status) {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'open') return 'open';
  if (s === 'close' || s === 'closed') return 'closed';
  if (/(complete|done|closed|reject)/.test(s)) return 'closed';
  return 'open';
}

function extractStatus(obj) {
  return pickString(obj, ['Lead_Status', 'LeadStatus', 'Status', 'status', '_status']) || 'Unknown';
}

function normalizeWebsiteToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
}

function websiteMatches(leadWebsite, filter) {
  const w = String(leadWebsite || '').toLowerCase();
  const f = String(filter || '').trim().toLowerCase();
  // Empty filter must not match every lead — that is the full report.
  if (!f) return false;
  if (!w) return false;
  if (w === f || w.includes(f) || f.includes(w)) return true;
  const wn = normalizeWebsiteToken(w);
  const fn = normalizeWebsiteToken(f);
  return Boolean(wn && fn && (wn === fn || wn.includes(fn) || fn.includes(wn)));
}

/**
 * IST calendar day as YYYY-MM-DD. Do not use toLocaleDateString.
 * Cloud Run bookworm-slim Node can emit unpadded dates (2026-6-2). In October
 * those sort after 2026-10-01, so every This-FY lead is dropped and send STOPs.
 * IST has no DST.
 */
function istDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isLoggedInToday(lastLogin) {
  if (!lastLogin) return false;
  const d = new Date(lastLogin);
  if (Number.isNaN(d.getTime())) return false;
  return istDateKey(d) === istDateKey(new Date());
}

function formatLogin(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function findUserForPerson(users, person) {
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email, u]));
  const byId = new Map(users.filter((u) => u.userId).map((u) => [u.userId, u]));
  const byName = new Map(users.filter((u) => u.name).map((u) => [u.name.toLowerCase(), u]));
  for (const email of person.emails) {
    const u = byEmail.get(email.toLowerCase());
    if (u) return u;
  }
  for (const id of person.ids) {
    const u = byId.get(id);
    if (u) return u;
  }
  for (const name of person.names) {
    const u = byName.get(name.toLowerCase());
    if (u) return u;
  }
  return null;
}

/**
 * Same calendar as ITSM/PM/Travel emails:
 *   TZ=Asia/Kolkata date +%Y-%m-%d
 *   (now() AT TIME ZONE 'Asia/Kolkata')::date
 * Never toLocaleDateString — Cloud Run bookworm-slim Node returns 10/1/2026,
 * which makes FY start NaN-04-01 and countable 0.
 */
function parseIsoYmd(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function istTodayYmd() {
  return istDateKey(new Date());
}

function currentIndianFyStartYear(todayYmd = istTodayYmd()) {
  const parts = parseIsoYmd(todayYmd) || parseIsoYmd(istTodayYmd());
  if (!parts) {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const year = ist.getUTCFullYear();
    const month = ist.getUTCMonth() + 1;
    return month >= 4 ? year : year - 1;
  }
  return parts.month >= 4 ? parts.year : parts.year - 1;
}

function currentFyBounds() {
  const to = istTodayYmd();
  const start = currentIndianFyStartYear(to);
  const from = `${start}-04-01`;
  if (!parseIsoYmd(from) || !parseIsoYmd(to)) {
    throw new Error(`Lead Tracker FY bounds invalid: ${from}..${to}`);
  }
  return { from, to };
}

function leadCreatedYmd(lead) {
  const created = leadCreatedAt(lead);
  if (!created) return '';
  return istDateKey(new Date(created));
}

/** Same as the Lead dashboard default period (This FY · created_at). */
function inCurrentFy(lead) {
  const ymd = leadCreatedYmd(lead);
  if (!ymd) return false;
  const { from, to } = currentFyBounds();
  return ymd >= from && ymd <= to;
}

function isCountableLeadForReport(lead, websiteFilter) {
  if (isLeadDraftItem(lead)) return false;
  if (!websiteMatches(extractWebsite(lead), websiteFilter)) return false;
  return inCurrentFy(lead);
}

function filterLeadsForReport(leads, websiteFilter) {
  return dedupeLeadItems(leads).filter((l) => isCountableLeadForReport(l, websiteFilter));
}

function buildRows(users, leads, websiteFilter) {
  const filteredLeads = filterLeadsForReport(leads, websiteFilter);
  const rows = new Map();
  let totalOpen = 0;
  let totalClosed = 0;

  for (const lead of filteredLeads) {
    const person = extractSalesPerson(lead);
    const status = extractStatus(lead);
    const bucket = leadStatusBucket(status);
    if (bucket === 'closed') totalClosed += 1;
    else totalOpen += 1;

    const key = (person.emails[0] || person.names[0] || person.ids[0] || '').toLowerCase();
    if (!key) continue;

    const matched = findUserForPerson(users, person);
    if (!rows.has(key)) {
      rows.set(key, {
        email: matched?.email || person.emails[0] || '',
        name: matched?.name || person.names[0] || person.emails[0] || key,
        userId: matched?.userId || person.ids[0] || '',
        openLeads: 0,
        closedLeads: 0,
        loggedInToday: false,
        lastSignedIn: null,
      });
    } else if (matched) {
      const row = rows.get(key);
      if (!row.userId && matched.userId) row.userId = matched.userId;
      if (!row.email && matched.email) row.email = matched.email;
    }

    const row = rows.get(key);
    if (bucket === 'closed') row.closedLeads += 1;
    else row.openLeads += 1;
  }

  return {
    rows: [...rows.values()]
      .filter((r) => r.openLeads + r.closedLeads > 0)
      .sort((a, b) => b.openLeads + b.closedLeads - (a.openLeads + a.closedLeads) || a.name.localeCompare(b.name)),
    totalLeads: filteredLeads.length,
    totalOpen,
    totalClosed,
  };
}

/** Hit user detail API for every assignee row — fresh login on each report send. */
async function enrichRowsWithFreshLogin(host, accountId, keyId, keySecret, rows, users) {
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email, u]));
  const byName = new Map(users.filter((u) => u.name).map((u) => [u.name.toLowerCase(), u]));

  for (const row of rows) {
    let userId = row.userId;
    if (!userId && row.email) userId = byEmail.get(row.email.toLowerCase())?.userId;
    if (!userId && row.name) userId = byName.get(row.name.toLowerCase())?.userId;
    if (!userId) continue;

    const detail = await fetchUserDetail(host, accountId, keyId, keySecret, userId);
    const lastLogin = detail?.lastLogin || row.lastSignedIn || null;
    row.lastSignedIn = lastLogin;
    row.loggedInToday = isLoggedInToday(lastLogin);
    if (detail?.email && !row.email) row.email = detail.email;
    if (detail?.name && (row.name === row.email || !row.name)) row.name = detail.name;
  }
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderUserTableRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="4" style="padding:12px 14px; color:#888888 !important;">No users with open or recent leads.</td></tr>';
  }
  return rows
    .map((row, idx) => {
      const bg = row.loggedInToday ? '#dcfce7' : idx % 2 ? '#ffffff' : '#faf9f7';
      const lastLogin = formatLogin(row.lastSignedIn);
      const lastCell = !lastLogin || lastLogin === 'Never' ? '-' : lastLogin;
      const lastStyle = row.loggedInToday
        ? 'padding:12px 14px; border-bottom:1px solid #bbf7d0; color:#166534 !important; font-weight:bold;'
        : 'padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;';
      return `<tr style="background-color:${bg};" bgcolor="${bg}">
<td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">${escapeHtml(row.name)}</td>
<td style="${lastStyle}">${escapeHtml(lastCell)}</td>
<td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>${row.openLeads}</b></td>
<td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">${row.closedLeads}</td>
</tr>`;
    })
    .join('');
}

function renderTable(rows) {
  if (!rows.length) {
    return '<p style="color:#888888;font-size:13px;">No users/leads for this team.</p>';
  }
  const body = rows
    .map((row, idx) => {
      const bg = idx % 2 ? '#faf9f7' : '#ffffff';
      const sign = row.loggedInToday ? '✓' : '✕';
      const signBg = row.loggedInToday ? '#dcfce7;color:#16a34a' : '#fee2e2;color:#c8102e';
      const lastLogin = formatLogin(row.lastSignedIn);
      return `<tr style="background:${bg}">
<td style="padding:10px 12px;border-bottom:1px solid #ececea;font-size:13px;color:#1a1a1a;">${escapeHtml(row.email || '—')}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;font-weight:600;color:#1a1a1a;">${escapeHtml(row.name)}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;text-align:center;color:#c8102e;font-weight:700;">${row.openLeads}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;text-align:center;color:#1a1a1a;font-weight:700;">${row.closedLeads}</td>
<td style="padding:10px 12px;border-bottom:1px solid #ececea;text-align:center;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:${signBg.split(';')[0]};${signBg.split(';')[1] || ''};font-weight:bold;">${sign}</span></td>
<td style="font-size:11px;padding:10px 12px;border-bottom:1px solid #ececea;color:#888888;">${escapeHtml(lastLogin)}</td>
</tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececea;border-radius:4px;border-collapse:collapse;overflow:hidden;">
<thead><tr style="background:#faf9f7;color:#888888;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">
<th style="padding:10px 12px;text-align:left;font-weight:700;">Email</th><th style="padding:10px 12px;text-align:left;font-weight:700;">Name</th>
<th style="padding:10px 12px;text-align:center;font-weight:700;">Open</th><th style="padding:10px 12px;text-align:center;font-weight:700;">Closed</th>
<th style="padding:10px 12px;text-align:center;font-weight:700;">Signed in today</th><th style="padding:10px 12px;text-align:left;font-weight:700;">Last signed in</th>
</tr></thead><tbody>${body}</tbody></table>`;
}

function renderHtml(groupName, rows, totals) {
  const userRows = renderUserTableRows(rows);
  const open = totals.totalOpen ?? rows.reduce((n, r) => n + r.openLeads, 0);
  const closed = totals.totalClosed ?? rows.reduce((n, r) => n + r.closedLeads, 0);
  const signedInToday = rows.filter((r) => r.loggedInToday).length;
  const openedToday = totals.openedToday ?? 0;
  const closedToday = totals.closedToday ?? 0;
  const date = new Date().toLocaleString('en-IN', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' IST';
  const reportBody = `Live data from Kissflow Lead Tracker (${groupName}): ${groupName} leads only, grouped by assigned sales person.`;
  const variables = {
    CompanyName: groupName,
    ReportTitle: `${groupName} — Lead Tracker`,
    GroupName: groupName,
    WebsiteName: groupName,
    ReportDate: date,
    TotalLeads: String(totals.totalLeads),
    OpenLeads: String(open),
    ClosedLeads: String(closed),
    TotalUsers: String(rows.length),
    SignedInToday: String(signedInToday),
    OpenedToday: String(openedToday),
    ClosedToday: String(closedToday),
    UserTableHtml: userRows,
    LeadTableHtml: userRows,
    ReportBody: reportBody,
  };

  const template = loadLeadTrackerTemplate();
  if (template) {
    return replaceTemplateVariables(template, variables);
  }

  return replaceTemplateVariables(
    `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f2;padding:24px">
<div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e5e0;border-radius:6px;padding:24px;">
<div style="font-size:20px;font-weight:bold;color:#1a1a1a;border-bottom:3px solid #c8102e;padding-bottom:12px;">{{CompanyName}}</div>
<div style="font-size:18px;font-weight:bold;margin-top:16px;">{{ReportTitle}}</div>
<div style="font-size:13px;color:#888888;margin-top:4px;">Generated {{ReportDate}} · Team: {{GroupName}}</div>
<div style="margin-top:16px;">{{LeadTableHtml}}</div>
<p style="font-size:13px;color:#5b5b5b;">{{ReportBody}}</p>
</div></body></html>`,
    variables,
  );
}

async function buildLeadTrackerReport({ groupName, websiteFilter }) {
  const company = canonicalizeWebsiteFilter(websiteFilter || groupName);
  if (!company) {
    throw new Error('Lead Tracker report requires a website filter (will not send the full report).');
  }
  const { host, accountId, keyId, keySecret } = getKissflowConfig();
  const [mainLeads, venwindLeads] = await Promise.all([
    fetchAllLeads(host, accountId, keyId, keySecret, PROCESS_ID),
    fetchAllLeads(host, accountId, keyId, keySecret, VENWIND_PROCESS_ID).catch(() => []),
  ]);
  const listLeads = [
    ...mainLeads,
    ...venwindLeads.map((lead) => ({
      ...lead,
      _process_id: VENWIND_PROCESS_ID,
      Website_and_form: lead.Website_and_form || lead.Website || 'Venwind',
    })),
  ];
  const users = await fetchAllUsers(host, accountId, keyId, keySecret);
  const leads = await enrichLeadsWithDetails(host, accountId, keyId, keySecret, listLeads);
  const withWebsite = leads.filter((lead) => extractWebsite(lead)).length;
  if (!withWebsite) {
    throw new Error('Lead Tracker items have no Website_and_form — refusing to send a 0-count email');
  }

  // Same rules as the Lead dashboard: Website_and_form, no drafts, FY via _created_at, Lead_Status.
  const websiteLeads = filterLeadsForReport(leads, company);
  const { openedToday, closedToday } = countOpenedClosedToday(websiteLeads);
  const { rows, totalLeads, totalOpen, totalClosed } = buildRows(users, leads, company);
  if (!totalLeads) {
    const { from, to } = currentFyBounds();
    const websites = [...new Set(leads.map((lead) => extractWebsite(lead)).filter(Boolean))].slice(0, 16);
    throw new Error(
      `Lead Tracker countable is 0 for ${company} (items=${leads.length}, withWebsite=${withWebsite}, withCreatedAt=${leads.filter((l) => leadCreatedAt(l)).length}, fy=${from}..${to}, websites=${websites.join('|') || 'none'})`,
    );
  }
  try {
    await enrichRowsWithFreshLogin(host, accountId, keyId, keySecret, rows, users);
  } catch (err) {
    console.warn(`Lead Tracker login enrich skipped: ${err.message || err}`);
  }

  const html = renderHtml(company, rows, {
    totalLeads,
    totalOpen,
    totalClosed,
    openedToday,
    closedToday,
  });
  const subject = `Lead Tracker — ${groupName} sales report`;
  return {
    html,
    subject,
    rowCount: rows.length,
    totalLeads,
    openedToday,
    closedToday,
    source: 'live',
    rows,
  };
}

function isLeadTrackerScheduler(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.websiteFilter) return true;
  const appId = String(meta.applicationId || '');
  return appId.includes('lead-tracker');
}

module.exports = {
  buildLeadTrackerReport,
  isLeadTrackerScheduler,
  isLeadDraftItem,
  isCountableLeadForReport,
  filterLeadsForReport,
  istDateKey,
  istTodayYmd,
  currentFyBounds,
  currentIndianFyStartYear,
  TZ,
};
