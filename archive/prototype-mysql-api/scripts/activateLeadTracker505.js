/**
 * Build Lead Tracker report HTML from live Kissflow APIs (server-side).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../client/.env.local') });

const { buildLeadTrackerReport } = require('../services/leadReportService');

const LEAD_TRACKER_SALES_GROUPS = [
  { groupName: '3i Sales Team', websiteFilter: '3iMedtech', slug: '3i' },
  { groupName: 'Sales Team Modepro', websiteFilter: 'Modepro', slug: 'modepro' },
  { groupName: 'Sales Team Adonis', websiteFilter: 'Adonis', slug: 'adonis' },
  { groupName: 'Sales Team Refex Mobility', websiteFilter: 'Refex Mobility', slug: 'refex-mobility' },
];

const RECIPIENTS = [
  'raghul.je@refex.co.in',
  'murugesh.k@refex.co.in',
  'pravinkumar.raja@refex.co.in',
];

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function login(apiBase) {
  const email = process.env.ADMIN_EMAIL || 'admin@notificationengine.com';
  const password = process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password) throw new Error('ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD required');
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  return data.accessToken || data.token;
}

async function syncScheduler(apiBase, token, payload) {
  const res = await fetch(`${apiBase}/api/schedulers/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Sync failed: ${res.status}`);
  return data;
}

async function runSchedulerNow(apiBase, token, externalId) {
  const res = await fetch(`${apiBase}/api/schedulers/run-now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ external_id: externalId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Send failed: ${res.status}`);
  return data;
}

async function main() {
  const apiBase = process.env.API_BASE || 'http://localhost:4000';
  const cron = '5 17 * * *';
  const time = '17:05';

  console.log('Logging in to API...');
  const token = await login(apiBase);

  for (const group of LEAD_TRACKER_SALES_GROUPS) {
    const externalId = `sch-refex-lead-prod-${group.slug}`;
    console.log(`Building report: ${group.groupName}...`);
    let html;
    let subject;
    try {
      const built = await buildLeadTrackerReport({
        groupName: group.groupName,
        websiteFilter: group.websiteFilter,
      });
      html = built.html;
      subject = built.subject;
      console.log(`  → ${built.rowCount} users, ${built.totalLeads} leads`);
    } catch (err) {
      console.warn(`  Kissflow build failed (${err.message}), using placeholder HTML`);
      subject = `Lead Tracker — ${group.groupName} sales report`;
      html = `<p>Lead Tracker report for <strong>${group.groupName}</strong> — data fetch pending (${escapeHtml(err.message)}).</p>`;
    }

    console.log(`Syncing scheduler ${externalId} @ ${time} active...`);
    await syncScheduler(apiBase, token, {
      external_id: externalId,
      name: `Lead Tracker — ${group.groupName}`,
      cron_expression: cron,
      job_type: 'report_send',
      to_emails: RECIPIENTS,
      cc_emails: [],
      subject,
      html_body: html,
      is_active: true,
      meta: {
        applicationId: 'app-refex-lead-tracker-prod',
        templateId: 'tpl-refex-lead-tracker-prod',
        cadence: { type: 'daily', time },
        timezone: 'Asia/Kolkata',
        userGroupFilter: group.groupName,
        websiteFilter: group.websiteFilter,
      },
    });
    console.log(`  ✓ Published & synced`);

    console.log(`  → Sending now...`);
    const sent = await runSchedulerNow(apiBase, token, externalId);
    console.log(`  ✓ ${sent.message || 'Sent'}`);
  }

  console.log('\nDone. Recipients:', RECIPIENTS.join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
