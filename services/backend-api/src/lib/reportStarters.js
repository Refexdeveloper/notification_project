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
      'SourceBreakdownHtml',
      'UserTableHtml',
      'ReportBody',
    ],
    best_for: ['IT_Service_Management_A00', 'itsm'],
  },
  {
    id: 'itsm-extrovis',
    name: 'Extrovis ITSM report',
    description: 'Extrovis ticket report — no user sign-in overview (tickets, source, activity, assignees only).',
    seed_path: 'db/seeds/itsm-extrovis-engagement-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'TotalTickets',
      'OpenTickets',
      'ClosedTickets',
      'SlaBreachedTotal',
      'SlaBreachedOpen',
      'SlaBreachedClosed',
      'OpenedToday',
      'ClosedToday',
      'SourceBreakdownHtml',
      'UserTableHtml',
      'ReportBody',
    ],
    best_for: ['extrovis', 'IT_Service_Management_A00'],
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
      'TotalUsers',
      'SignedInToday',
      'OpenedToday',
      'ClosedToday',
      'UserTableHtml',
      'ReportBody',
    ],
    best_for: ['Project_Management_Tracker_A00', 'pm', 'project'],
  },
  {
    id: 'solar-reinvestment',
    name: 'Solar Reinvestment Request report',
    description:
      'Solar Expense Hub layout with Total / Sign-in Rate Today / Open / Closed Requests + MIS user table.',
    seed_path: 'db/seeds/solar-reinvestment-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'TotalRequests',
      'SignInRateToday',
      'OpenRequests',
      'ClosedRequests',
      'OpenedToday',
      'ClosedToday',
      'UserTableHtml',
      'ReportBody',
    ],
    best_for: ['Solar_Site_Expense_Governance_Syst_A00', 'solar', 'reinvestment', 'technician_reimbursement'],
  },
  {
    id: 'lead',
    name: 'Lead Tracker report',
    description: 'Same layout as the Project Tracker email, labelled for leads (Open / Closed + user table).',
    seed_path: 'db/seeds/lead-tracker-report-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'CompanyName',
      'GroupName',
      'TotalLeads',
      'OpenLeads',
      'ClosedLeads',
      'TotalUsers',
      'SignedInToday',
      'OpenedToday',
      'ClosedToday',
      'UserTableHtml',
      'LeadTableHtml',
      'ReportBody',
    ],
    best_for: ['Lead_Trcaker_A00', 'lead'],
  },
  {
    id: 'expense',
    name: 'Expense Management report',
    description: 'Same layout as Project Tracker, labelled for claims (Pending / Closed + user table).',
    seed_path: 'db/seeds/expense-engagement-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'TotalClaims',
      'PendingClaims',
      'ClosedClaims',
      'TotalUsers',
      'SignedInToday',
      'OpenedToday',
      'ClosedToday',
      'UserTableHtml',
      'ReportBody',
    ],
    best_for: ['EMS_001_A00', 'expense'],
  },
  {
    id: 'travel',
    name: 'Travel Management usage report',
    description:
      'ITSM-style Travel Management daily usage report. Combines Advance Payment, Expense Management, and Travel Management into one email per entity (Venwind or Refex).',
    seed_path: 'db/seeds/travel-engagement-template.html',
    placeholders: [
      'ReportTitle',
      'ReportDate',
      'EntityScope',
      'EntityName',
      'TotalRequests',
      'PendingRequests',
      'CompletedRequests',
      'RejectedRequests',
      'UsersWithPending',
      'SlaBreachedTotal',
      'SlaBreachedOpen',
      'SlaBreachedClosed',
      'TotalUsers',
      'SignedInToday',
      'OpenedToday',
      'ClosedToday',
      'UserTableHtml',
      'UserTableSectionHtml',
      'PendingDetailsHtml',
      'SlaAnalysisHtml',
      'ReportBody',
    ],
    best_for: ['Expense_and_Travel_Management_A00', 'travel'],
  },
  {
    id: 'simple',
    name: 'Simple metrics + table',
    description: 'Easy starter for any new app. Edit labels and click placeholders.',
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
    best_for: ['generic'],
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

/**
 * Pick a starter layout from application / process / field signals.
 * Application id wins over attached process names (e.g. ITSM app with Extrovis process).
 * @param {string} applicationId
 * @param {{ applicationName?: string, processIds?: string[], processNames?: string[], fieldNames?: string[] }} [context]
 */
function suggestStarterId(applicationId = '', context = {}) {
  const id = String(applicationId || '').toLowerCase();
  if (id.includes('extrovis')) return 'itsm-extrovis';
  if (id.includes('it_service') || id.includes('itsm')) return 'itsm';
  if (id.includes('project_management') || id.includes('project_sub_task')) return 'pm';
  if (id.includes('solar') || id.includes('technician_reimbursement') || id.includes('reinvestment')) {
    return 'solar-reinvestment';
  }
  if (id.includes('lead')) return 'lead';
  if (id.includes('ems_001') || (id.includes('expense') && !id.includes('travel') && !id.includes('solar'))) {
    return 'expense';
  }
  if (id.includes('expense_and_travel') || id.includes('venwind') || id.includes('travel')) return 'travel';

  const haystack = [
    context.applicationName,
    ...(context.processIds || []),
    ...(context.processNames || []),
    ...(context.fieldNames || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (haystack.includes('extrovis')) return 'itsm-extrovis';
  if (
    haystack.includes('it_service')
    || haystack.includes('itsm')
    || haystack.includes('sla_breach')
    || (haystack.includes('ticket') && haystack.includes('assigned'))
  ) {
    return 'itsm';
  }
  if (
    haystack.includes('project_management')
    || haystack.includes('project_sub_task')
    || (haystack.includes('project') && haystack.includes('task'))
  ) {
    return 'pm';
  }
  if (
    haystack.includes('solar')
    || haystack.includes('technician_reimbursement')
    || haystack.includes('reinvestment')
  ) {
    return 'solar-reinvestment';
  }
  if (haystack.includes('lead')) return 'lead';
  if (
    haystack.includes('ems_001')
    || (haystack.includes('expense') && !haystack.includes('travel') && !haystack.includes('solar'))
  ) {
    return 'expense';
  }
  if (haystack.includes('expense_and_travel') || haystack.includes('venwind') || haystack.includes('travel')) {
    return 'travel';
  }
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
