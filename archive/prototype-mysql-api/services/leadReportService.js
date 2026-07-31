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
const PAGE_SIZE = 1000;
const TZ = 'Asia/Kolkata';
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
        `host=${pgHost}`,
        `port=${pgPort}`,
        `dbname=${pgDb}`,
        `user=${pgUser}`,
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
    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(variables[key] ?? ''));
  }
  return body;
}

function loadLeadTrackerTemplate() {
  const fromPg = loadLeadTrackerTemplateFromPg();
  if (fromPg) return fromPg;
  if (fs.existsSync(LEAD_TRACKER_TEMPLATE_PATH)) {
    return normalizeLeadTemplateHtml(fs.readFileSync(LEAD_TRACKER_TEMPLATE_PATH, 'utf8'));
  }
  return null;
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

function pickDateTime(obj, keys) {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (val && typeof val === 'object') {
      if (typeof val.v === 'string' && val.v.trim()) return val.v.trim();
      if (typeof val.dv === 'string' && val.dv.trim()) return val.dv.trim();
    }
  }
  return null;
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

async function kissflowFetch(host, keyId, keySecret, apiPath) {
  const url = `https://${host}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Access-Key-Id': keyId,
      'X-Access-Key-Secret': keySecret,
    },
  });
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new Error(`Kissflow ${apiPath}: ${res.status}`);
  return data;
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
    'AcCMptlq60zH';
  const keyId = process.env.VITE_KISSFLOW_PROD_ACCESS_KEY_ID || '';
  const keySecret = process.env.VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET || '';
  if (!keyId || !keySecret) throw new Error('Missing prod Kissflow keys in apps/admin-ui/.env.local');
  return { host, accountId, keyId, keySecret };
}

async function fetchAllUsers(host, accountId, keyId, keySecret) {
  const all = [];
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
  while (page <= 100) {
    const apiPath = `/process/2/${accountId}/admin/${processId}/item?page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=1`;
    try {
      const data = await kissflowFetch(host, keyId, keySecret, apiPath);
      const batch = asArray(data).filter((r) => r && typeof r === 'object');
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      page += 1;
    } catch (e) {
      if (page === 1) throw e;
      break;
    }
  }
  return all;
}

function extractWebsite(obj) {
  for (const key of ['Website_and_form', 'Website', 'website', 'Lead_Website', 'Website_Name', 'Source']) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (val && typeof val === 'object') {
      const label = pickString(val, ['Name', 'name', 'Label']);
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

function websiteMatches(leadWebsite, filter) {
  if (!filter.trim()) return true;
  const w = leadWebsite.toLowerCase();
  const f = filter.toLowerCase();
  return w === f || w.includes(f) || f.includes(w);
}

function istDateKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
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

function buildRows(users, leads, websiteFilter) {
  const filteredLeads = leads.filter((l) => websiteMatches(extractWebsite(l), websiteFilter));
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
    const lastLogin = detail?.lastLogin || null;
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
  const table = renderTable(rows);
  const open = totals.totalOpen ?? rows.reduce((n, r) => n + r.openLeads, 0);
  const closed = totals.totalClosed ?? rows.reduce((n, r) => n + r.closedLeads, 0);
  const signedInToday = rows.filter((r) => r.loggedInToday).length;
  const date = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: TZ });
  const reportBody = `Live data from Kissflow Lead Tracker (${groupName}): leads filtered by Website_and_form, grouped by assigned sales person.`;
  const variables = {
    CompanyName: 'REFEX',
    ReportTitle: `${groupName} — Lead Tracker`,
    GroupName: groupName,
    ReportDate: date,
    TotalLeads: String(totals.totalLeads),
    OpenLeads: String(open),
    ClosedLeads: String(closed),
    SignedInToday: String(signedInToday),
    LeadTableHtml: table,
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
  const { host, accountId, keyId, keySecret } = getKissflowConfig();
  const [users, leads] = await Promise.all([
    fetchAllUsers(host, accountId, keyId, keySecret),
    fetchAllLeads(host, accountId, keyId, keySecret),
  ]);

  const { rows, totalLeads, totalOpen, totalClosed } = buildRows(users, leads, websiteFilter);
  await enrichRowsWithFreshLogin(host, accountId, keyId, keySecret, rows, users);

  const html = renderHtml(groupName, rows, { totalLeads, totalOpen, totalClosed });
  const subject = `Lead Tracker — ${groupName} sales report`;
  return { html, subject, rowCount: rows.length, totalLeads, rows };
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
  TZ,
};
