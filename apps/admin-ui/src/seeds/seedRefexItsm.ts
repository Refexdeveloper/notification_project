/**
 * Seeds ITSM engagement template + daily scheduler on top of the Refex app catalog.
 * App registration (credentials, process IDs) lives in seedRefexApps / refexAppCatalog.
 *
 * Source: refex-adoption-user-report-Live_IT_Service_Request_A00
 */

import {
  getApplications,
  saveApplication,
  type DiscoveredField,
  type KissflowApplication,
} from '@/mocks/applications';
import {
  extractVariables,
  getTemplatesByAppId,
  type ReportTemplate,
} from '@/stores/reportTemplates';
import {
  computeNextRun,
  getSchedulersByAppId,
  type ReportScheduler,
} from '@/stores/reportSchedulers';
import itsmFields from './itsmFields.json';
import {
  REFEX_ENV_CONFIG,
  REFEX_ITSM_DEV_APP_ID,
} from './refexAppCatalog';

export const REFEX_ITSM_APP_ID = REFEX_ITSM_DEV_APP_ID;
const TEMPLATE_ID = 'tpl-refex-itsm-engagement';
const SCHEDULER_ID = 'sch-refex-itsm-daily';
const TEMPLATES_KEY = 'ne_report_templates';
const SCHEDULERS_KEY = 'ne_report_schedulers';

/** Discovery snapshot metrics from Refex report-latest + discovery-manifest */
export const REFEX_ITSM_SNAPSHOT = {
  accountId: REFEX_ENV_CONFIG.Development.accountId,
  kissflowAppId: 'IT_Service_Management_A00',
  processId: 'Live_IT_Service_Request_A00',
  processName: 'Live IT Service Request',
  applicationName: 'IT Service Management',
  subdomain: REFEX_ENV_CONFIG.Development.subdomain,
  baseUrl: `https://${REFEX_ENV_CONFIG.Development.subdomain}.kissflow.com`,
  environment: 'Development' as const,
  region: 'com' as const,
  /** Admin Get-all-items process ID */
  adminProcessId: 'Live_IT_Service_Request_A00',
  userCount: 46,
  itemCount: 209,
  /** From generated report-latest.html (Entity=Refex scope) */
  reportMetrics: {
    assignedUsers: 262,
    signedIn: 149,
    signInRate: '56%',
    openTickets: 4,
    closedTickets: 128,
    neverSignedIn: 113,
  },
};

const REFEX_ENGAGEMENT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{ReportTitle}}</title>
</head>
<body style="margin:0; padding:0; background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="background-color:#ffffff !important; border-radius:10px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.10);" bgcolor="#ffffff">

<tr><td style="background:linear-gradient(180deg,#ffffff 0%,#f7f7f6 100%) !important; padding:26px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="180" valign="middle">
<img src="https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png" alt="refexOne" width="168" style="display:block; max-width:168px; height:auto;">
</td>
<td valign="middle" style="padding-left:18px; border-left:1px solid #e5e5e0;">
<div style="font-size:18px; font-weight:bold; color:#1a1a1a !important;">{{ReportTitle}}</div>
<div style="font-size:12px; color:#6b6b6b !important; margin-top:4px;">Live IT Service Request &middot; IT Service Management</div>
<div style="font-size:12px; color:#6b6b6b !important; margin-top:2px;">Generated {{ReportDate}} &middot; Refex tickets only</div>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:0; line-height:0;">
<img src="https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif" alt="" width="680" height="6" style="display:block; width:100%; height:6px; border:0;">
</td></tr>

<tr><td style="padding:22px 32px 6px 32px;" bgcolor="#ffffff">
<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Overall ITSM Ticket Summary</div>
</td></tr>
<tr><td style="padding:10px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="18%" align="center" valign="top" style="background:linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%) !important; border:1px solid #dfe8f2; border-radius:8px; padding:14px 4px; box-shadow:0 2px 6px rgba(30,80,160,0.06);">
<div style="font-size:18px; font-weight:bold; color:#1a1a1a !important;">{{TotalTickets}}</div>
<div style="font-size:10px; color:#5b7ba3 !important; margin-top:4px;">All Tickets</div>
<div style="font-size:9px; color:#5b7ba3 !important; margin-top:2px; line-height:1;">&nbsp;</div></td>
<td width="1.5%"></td>
<td width="18%" align="center" valign="top" style="background:linear-gradient(180deg,#fffaf2 0%,#fef3e2 100%) !important; border:1px solid #f2e2c4; border-radius:8px; padding:14px 4px; box-shadow:0 2px 6px rgba(180,120,20,0.07);">
<div style="font-size:18px; font-weight:bold; color:#1a1a1a !important;">{{OpenTickets}}</div>
<div style="font-size:10px; color:#9a7a3a !important; margin-top:4px;">Open Tickets</div>
<div style="font-size:9px; color:#9a7a3a !important; margin-top:2px; line-height:1;">&nbsp;</div></td>
<td width="1.5%"></td>
<td width="18%" align="center" valign="top" style="background:linear-gradient(180deg,#f4fbf5 0%,#e0f5e8 100%) !important; border:1px solid #c7ead4; border-radius:8px; padding:14px 4px; box-shadow:0 2px 6px rgba(26,140,92,0.08);">
<div style="font-size:18px; font-weight:bold; color:#1a1a1a !important;">{{ClosedTickets}}</div>
<div style="font-size:10px; color:#3f8f63 !important; margin-top:4px;">Closed Tickets</div>
<div style="font-size:9px; color:#3f8f63 !important; margin-top:2px; line-height:1;">&nbsp;</div></td>
<td width="1.5%"></td>
<td width="18%" align="center" valign="top" style="background:linear-gradient(180deg,#fff5f5 0%,#ffe9e9 100%) !important; border:1px solid #f3cccc; border-radius:8px; padding:14px 4px; box-shadow:0 2px 6px rgba(200,16,46,0.08);">
<div style="font-size:18px; font-weight:bold; color:#c8102e !important;">{{SlaBreachedTotal}}</div>
<div style="font-size:10px; color:#a35560 !important; margin-top:4px;">SLA Breached</div>
<div style="font-size:9px; color:#a35560 !important; margin-top:2px;">Open {{SlaBreachedOpen}} &middot; Closed {{SlaBreachedClosed}}</div></td>
<td width="1.5%"></td>
<td width="20%" align="center" valign="top" style="background:linear-gradient(180deg,#f0fbf4 0%,#e0f5e8 100%) !important; border:1px solid #c7ead4; border-radius:8px; padding:14px 4px; box-shadow:0 2px 6px rgba(26,140,92,0.08);">
<div style="font-size:18px; font-weight:bold; color:#14503a !important;">{{TotalUsers}}</div>
<div style="font-size:10px; color:#3f8f63 !important; margin-top:4px;">Total Users</div>
<div style="font-size:9px; color:#3f8f63 !important; margin-top:2px;">{{SignedInToday}} signed in today</div></td>
</tr></table></td></tr>

{{SourceBreakdownHtml}}

<tr><td style="padding:22px 32px 6px 32px;" bgcolor="#ffffff">
<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Today's Ticket Activity</div>
</td></tr>
<tr><td style="padding:10px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="48%" align="center" style="background:linear-gradient(180deg,#fffaf2 0%,#fdecd0 100%) !important; border:1px solid #f0d9a8; border-radius:10px; padding:26px 10px; box-shadow:0 3px 10px rgba(180,120,20,0.10);">
<div style="font-size:30px; font-weight:bold; color:#9a7a3a !important;">{{OpenedToday}}</div>
<div style="font-size:12px; color:#9a7a3a !important; margin-top:6px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Opened Today</div></td>
<td width="4%"></td>
<td width="48%" align="center" style="background:linear-gradient(180deg,#f2f6fb 0%,#dfeafa 100%) !important; border:1px solid #bcd6f0; border-radius:10px; padding:26px 10px; box-shadow:0 3px 10px rgba(30,80,160,0.10);">
<div style="font-size:30px; font-weight:bold; color:#3468a8 !important;">{{ClosedToday}}</div>
<div style="font-size:12px; color:#3468a8 !important; margin-top:6px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Closed Today</div></td>
</tr></table></td></tr>

<tr><td style="padding:26px 32px 6px 32px; font-size:13.5px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">Users with open or recent activity</td></tr>
<tr><td style="padding:8px 32px 28px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12.5px; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
<tr style="background:linear-gradient(90deg,#14503a 0%,#1a8c5c 100%) !important;" bgcolor="#14503a">
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;">User</td>
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;">Last Signed In</td>
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;" align="center">Open Tickets</td>
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;" align="center">Closed Tickets</td>
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;" align="center">SLA Breached</td>
</tr>
{{UserTableHtml}}
</table></td></tr>

<tr><td style="padding:4px 32px 24px 32px; font-size:11px; color:#a0a0a0 !important; line-height:1.6;" bgcolor="#ffffff">
{{ReportBody}}
</td></tr>

<tr><td style="background-color:#faf9f7 !important; padding:18px 32px; border-top:1px solid #ececea; font-size:11px; color:#a0a0a0 !important;" bgcolor="#faf9f7">
Refex User Engagement Report &middot; Automated &middot; Do not reply to this email
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

function upsertTemplate(tpl: ReportTemplate) {
  const raw = localStorage.getItem(TEMPLATES_KEY);
  const list: ReportTemplate[] = raw ? (JSON.parse(raw) as ReportTemplate[]) : [];
  const idx = list.findIndex((t) => t.id === tpl.id);
  if (idx >= 0) list[idx] = tpl;
  else list.unshift(tpl);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
}

function upsertScheduler(sch: ReportScheduler) {
  const raw = localStorage.getItem(SCHEDULERS_KEY);
  const list: ReportScheduler[] = raw ? (JSON.parse(raw) as ReportScheduler[]) : [];
  const idx = list.findIndex((s) => s.id === sch.id);
  if (idx >= 0) list[idx] = sch;
  else list.unshift(sch);
  localStorage.setItem(SCHEDULERS_KEY, JSON.stringify(list));
}

function buildApp(existing?: KissflowApplication): KissflowApplication {
  const now = new Date().toISOString();
  const fields = itsmFields as DiscoveredField[];
  const processId = REFEX_ITSM_SNAPSHOT.processId;
  const creds = REFEX_ENV_CONFIG.Development;
  const accessKeyId = creds.accessKeyId || existing?.accessKeyId || '';
  const accessKeySecret = creds.accessKeySecret || existing?.accessKeySecret || '';

  return {
    id: REFEX_ITSM_APP_ID,
    accountId: REFEX_ITSM_SNAPSHOT.accountId,
    /** Admin Get-all-items uses the process ID */
    appId: REFEX_ITSM_SNAPSHOT.adminProcessId,
    subdomain: REFEX_ITSM_SNAPSHOT.subdomain,
    name: REFEX_ITSM_SNAPSHOT.applicationName,
    displayName: REFEX_ITSM_SNAPSHOT.applicationName,
    description: REFEX_ITSM_SNAPSHOT.processName,
    region: REFEX_ITSM_SNAPSHOT.region,
    environment: REFEX_ITSM_SNAPSHOT.environment,
    status: 'Active',
    processIds: [processId],
    dataformIds: [],
    boardIds: [],
    datasetIds: [],
    accessKeyId,
    accessKeySecret,
    discoveredFields: fields,
    discoveredItemCount: REFEX_ITSM_SNAPSHOT.itemCount,
    lastFieldSyncAt: now,
    fieldsByResourceId: {
      [processId]: {
        fields,
        itemCount: REFEX_ITSM_SNAPSHOT.itemCount,
        syncedAt: now,
        adminProcessId: REFEX_ITSM_SNAPSHOT.adminProcessId,
      },
    },
    icon: 'ri-customer-service-2-line',
    owner: 'Refex seed',
    created: existing?.created || now,
    lastSync: now,
    connected: Boolean(accessKeyId && accessKeySecret),
    dataformsCount: 0,
    processesCount: 1,
    boardsCount: 0,
    templatesCount: 1,
    schedulersCount: 1,
  };
}

/**
 * Idempotent: upserts ITSM app + engagement template + daily 09:00 schedule.
 * Preserves any keys the user already saved on this app id.
 */
export function seedRefexItsmApp(): KissflowApplication {
  const existing = getApplications().find((a) => a.id === REFEX_ITSM_APP_ID);
  const app = saveApplication(buildApp(existing));

  const now = new Date().toISOString();
  const subject = 'Kissflow - User Signin Report';
  const html = REFEX_ENGAGEMENT_HTML;
  const existingTpl = getTemplatesByAppId(app.id).find((t) => t.id === TEMPLATE_ID);

  upsertTemplate({
    id: TEMPLATE_ID,
    applicationId: app.id,
    name: 'Kissflow User Engagement Report',
    description:
      'Refex-style engagement HTML from report-latest.html (Live IT Service Request).',
    subject,
    html,
    status: existingTpl?.status || 'published',
    variables: extractVariables(html, subject),
    createdAt: existingTpl?.createdAt || now,
    updatedAt: now,
    createdBy: 'Refex seed',
  });

  const cadence = { type: 'daily' as const, time: '09:00' };
  const existingSch = getSchedulersByAppId(app.id).find((s) => s.id === SCHEDULER_ID);

  upsertScheduler({
    id: SCHEDULER_ID,
    applicationId: app.id,
    name: 'Daily ITSM engagement report',
    description:
      'Daily 09:00 IST — matches Refex Adoption User Report scheduler. Add recipients before activating.',
    status: existingSch?.status || 'draft',
    templateId: TEMPLATE_ID,
    templateName: 'Kissflow User Engagement Report',
    cadence,
    recipients: existingSch?.recipients || [],
    cc: existingSch?.cc || [],
    lastRunAt: existingSch?.lastRunAt || null,
    nextRunAt: computeNextRun(cadence),
    createdAt: existingSch?.createdAt || now,
    updatedAt: now,
  });

  return app;
}
