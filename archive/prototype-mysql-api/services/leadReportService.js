/**
 * Lead Tracker report builder — live Kissflow leads + fresh user login detail per send.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const adminUiEnv = path.join(__dirname, '../../../apps/admin-ui/.env.local');
require('dotenv').config({ path: adminUiEnv });

const PROCESS_ID = 'Lead_tracker_1_A00';
const PAGE_SIZE = 1000;
const TZ = 'Asia/Kolkata';

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
    return '<p style="color:#64748b;font-size:13px;">No users/leads for this team.</p>';
  }
  const body = rows
    .map((row, idx) => {
      const bg = idx % 2 ? '#f8fafc' : '#fff';
      const sign = row.loggedInToday ? '✓' : '✕';
      const signBg = row.loggedInToday ? '#dcfce7;color:#16a34a' : '#fee2e2;color:#dc2626';
      const lastLogin = formatLogin(row.lastSignedIn);
      return `<tr style="background:${bg}">
<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px">${escapeHtml(row.email || '—')}</td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600">${escapeHtml(row.name)}</td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center;color:#ea580c;font-weight:700">${row.openLeads}</td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center;color:#059669;font-weight:700">${row.closedLeads}</td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:${signBg.split(';')[0]};${signBg.split(';')[1] || ''};font-weight:bold">${sign}</span></td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b">${escapeHtml(lastLogin)}</td>
</tr>`;
    })
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse">
<thead><tr style="background:#1e293b;color:#f1f5f9;font-size:10px;text-transform:uppercase">
<th style="padding:10px;text-align:left">Email</th><th style="padding:10px;text-align:left">Name</th>
<th style="padding:10px;text-align:center">Open</th><th style="padding:10px;text-align:center">Closed</th>
<th style="padding:10px;text-align:center">Signed in today</th><th style="padding:10px;text-align:left">Last signed in</th>
</tr></thead><tbody>${body}</tbody></table>`;
}

function renderHtml(groupName, rows, totals) {
  const table = renderTable(rows);
  const open = totals.totalOpen ?? rows.reduce((n, r) => n + r.openLeads, 0);
  const closed = totals.totalClosed ?? rows.reduce((n, r) => n + r.closedLeads, 0);
  const signedInToday = rows.filter((r) => r.loggedInToday).length;
  const date = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: TZ });
  return `<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;background:#f1f5f9;padding:24px">
<div style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<div style="background:linear-gradient(135deg,#ea580c,#f97316);padding:24px;color:#fff">
<div style="font-size:11px;opacity:.85">REFEX</div>
<div style="font-size:20px;font-weight:800;margin-top:4px">${escapeHtml(groupName)} — Lead Tracker</div>
<div style="font-size:13px;margin-top:6px">Team: ${escapeHtml(groupName)} · ${date}</div>
</div>
<div style="padding:20px;display:flex;gap:12px">
<div style="flex:1;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:#ea580c">${totals.totalLeads}</div><div style="font-size:11px">Total Leads</div></div>
<div style="flex:1;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:#ea580c">${open}</div><div style="font-size:11px">Open</div></div>
<div style="flex:1;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:#059669">${closed}</div><div style="font-size:11px">Closed</div></div>
</div>
<div style="padding:0 20px 24px">${table}</div>
<p style="padding:0 20px 16px;font-size:11px;color:#94a3b8;margin:0;">Login data refreshed from Kissflow at ${new Date().toLocaleString('en-IN', { timeZone: TZ })} · ${signedInToday} signed in today</p>
</div></body></html>`;
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
