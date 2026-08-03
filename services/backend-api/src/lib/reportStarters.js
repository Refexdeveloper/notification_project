'use strict';

const fs = require('fs');
const path = require('path');
const { defaultReportHtml } = require('./defaultReportHtml');
const { repoRoot } = require('./templateContent');

function readSeedHtml(relativePath) {
  const full = path.join(repoRoot(), relativePath);
  if (!fs.existsSync(full)) {
    // Cloud Run image copies seeds to /app/db/seeds
    const alt = path.join('/app', relativePath);
    if (fs.existsSync(alt)) {
      return fs.readFileSync(alt, 'utf8');
    }
    return null;
  }
  return fs.readFileSync(full, 'utf8');
}

function simpleMetricStarter(appName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light only">
<title>{{ReportTitle}}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="background-color:#ffffff !important;border-radius:10px;overflow:hidden;" bgcolor="#ffffff">

<tr><td style="padding:26px 32px;" bgcolor="#ffffff">
<img src="https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png" alt="refexOne" width="140" style="display:block;max-width:140px;height:auto;">
<div style="font-size:18px;font-weight:bold;color:#1a1a1a !important;margin-top:14px;">{{ReportTitle}}</div>
<div style="font-size:12px;color:#6b6b6b !important;margin-top:4px;">${appName} · Generated {{ReportDate}}</div>
</td></tr>

<tr><td style="padding:8px 32px 20px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="32%" align="center" style="border:1px solid #dfe8f2;border-radius:8px;padding:16px 8px;">
<div style="font-size:22px;font-weight:bold;color:#1a1a1a !important;">{{TotalTickets}}</div>
<div style="font-size:11px;color:#5b7ba3 !important;margin-top:4px;">Total</div>
</td>
<td width="2%"></td>
<td width="32%" align="center" style="border:1px solid #f2e2c4;border-radius:8px;padding:16px 8px;">
<div style="font-size:22px;font-weight:bold;color:#1a1a1a !important;">{{OpenTickets}}</div>
<div style="font-size:11px;color:#9a7a3a !important;margin-top:4px;">Open</div>
</td>
<td width="2%"></td>
<td width="32%" align="center" style="border:1px solid #c7ead4;border-radius:8px;padding:16px 8px;">
<div style="font-size:22px;font-weight:bold;color:#1a1a1a !important;">{{ClosedTickets}}</div>
<div style="font-size:11px;color:#3f8f63 !important;margin-top:4px;">Closed</div>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:8px 32px 24px 32px;" bgcolor="#ffffff">
<div style="font-size:12px;font-weight:bold;color:#8a8a8a !important;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Details</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececea;border-radius:8px;overflow:hidden;">
<tr style="background-color:#0f6b4c;" bgcolor="#0f6b4c">
<td style="padding:10px 14px;color:#ffffff !important;font-size:12px;font-weight:bold;">User</td>
<td style="padding:10px 14px;color:#ffffff !important;font-size:12px;font-weight:bold;">Last Signed In</td>
<td style="padding:10px 14px;color:#ffffff !important;font-size:12px;font-weight:bold;" align="center">Open</td>
<td style="padding:10px 14px;color:#ffffff !important;font-size:12px;font-weight:bold;" align="center">Closed</td>
</tr>
{{UserTableHtml}}
</table>
<p style="margin:14px 0 0;font-size:12px;color:#6b6b6b !important;line-height:1.5;">{{ReportBody}}</p>
</td></tr>

<tr><td style="padding:14px 32px 22px 32px;border-top:1px solid #ececea;font-size:11px;color:#8a9aa5 !important;" bgcolor="#ffffff">
{{CompanyName}} · Automated report — do not reply
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const STARTER_CATALOG = [
  {
    id: 'itsm',
    name: 'ITSM engagement report',
    description: 'Same layout as the live IT Service Management email (sign-in + tickets + user table).',
    seed_path: 'db/seeds/itsm-engagement-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'SignedInUsers',
      'SignInRate',
      'SignedInToday',
      'SignInRateToday',
      'NeverSignedIn',
      'TotalUsers',
      'TotalTickets',
      'OpenTickets',
      'ClosedTickets',
      'SlaBreachedTotal',
      'OpenedToday',
      'ClosedToday',
      'UserTableHtml',
      'ReportBody',
    ],
    best_for: ['IT_Service_Management_A00', 'itsm'],
  },
  {
    id: 'pm',
    name: 'Project Management report',
    description: 'Same layout as the Project Management Tracker email (tasks + user table).',
    seed_path: 'db/seeds/pm-engagement-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'TotalTasks',
      'AssignedTasks',
      'PendingTasks',
      'CompletedTasks',
      'OpenedToday',
      'ClosedToday',
      'UserTableHtml',
      'ReportBody',
    ],
    best_for: ['Project_Management_Tracker_A00', 'pm', 'project'],
  },
  {
    id: 'lead',
    name: 'Lead Tracker report',
    description: 'Same layout as the Lead Tracker email (leads + lead table).',
    seed_path: 'db/seeds/lead-tracker-report-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'CompanyName',
      'GroupName',
      'TotalLeads',
      'OpenLeads',
      'ClosedLeads',
      'LeadTableHtml',
      'ReportBody',
    ],
    best_for: ['Lead_Trcaker_A00', 'lead'],
  },
  {
    id: 'simple',
    name: 'Simple metrics + table',
    description: 'Easy starter for any new app (Travel, Expense, etc.). Edit labels and click placeholders.',
    seed_path: null,
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'TotalTickets',
      'OpenTickets',
      'ClosedTickets',
      'UserTableHtml',
      'ReportBody',
      'CompanyName',
    ],
    best_for: ['generic', 'travel', 'expense'],
  },
  {
    id: 'blank',
    name: 'Minimal blank',
    description: 'Very small starter with title, date, and body only.',
    seed_path: null,
    placeholders: ['ReportTitle', 'ReportDate', 'RecipientName', 'ReportBody', 'CompanyName'],
    best_for: [],
  },
];

function suggestStarterId(applicationId = '') {
  const id = String(applicationId || '').toLowerCase();
  if (id.includes('it_service') || id.includes('itsm')) return 'itsm';
  if (id.includes('project_management') || id.includes('project_sub_task')) return 'pm';
  if (id.includes('lead')) return 'lead';
  if (id.includes('travel') || id.includes('expense')) return 'simple';
  return 'simple';
}

function listStarters(applicationId = '') {
  const suggested = suggestStarterId(applicationId);
  return STARTER_CATALOG.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    placeholders: item.placeholders,
    recommended: item.id === suggested,
  }));
}

function getStarterHtml(starterId, appName = 'Application') {
  const item = STARTER_CATALOG.find((row) => row.id === starterId);
  if (!item) {
    const err = new Error(`Unknown starter: ${starterId}`);
    err.code = 'STARTER_NOT_FOUND';
    throw err;
  }

  if (item.id === 'blank') {
    return defaultReportHtml(appName);
  }
  if (item.id === 'simple') {
    return simpleMetricStarter(appName);
  }
  if (item.seed_path) {
    const html = readSeedHtml(item.seed_path);
    if (html) return html;
  }
  return simpleMetricStarter(appName);
}

module.exports = {
  listStarters,
  getStarterHtml,
  suggestStarterId,
  STARTER_CATALOG,
};
