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
<head><meta charset="UTF-8"><title>{{ReportTitle}}</title></head>
<body style="margin:0; padding:0; background-color:#f4f4f2; font-family:Arial, Helvetica, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f2; padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border:1px solid #e5e5e0; border-radius:6px; overflow:hidden;">
<tr><td style="background-color:#ffffff; padding:24px 32px; border-bottom:3px solid #c8102e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:20px; font-weight:bold; color:#1a1a1a;">{{CompanyName}}</td>
<td align="right" style="font-size:12px; color:#888888;">Live IT Service Request &middot; IT Service Management</td>
</tr></table></td></tr>
<tr><td style="padding:28px 32px 8px 32px;">
<div style="font-size:18px; font-weight:bold; color:#1a1a1a;">{{ReportTitle}}</div>
<div style="font-size:13px; color:#888888; margin-top:4px;">Generated {{ReportDate}} &middot; Refex tickets only</div>
</td></tr>
<tr><td style="padding:20px 32px 8px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="18%" align="center" style="background-color:#faf9f7; border:1px solid #ececea; border-radius:4px; padding:14px 4px;">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a;">{{TotalUsers}}</div>
<div style="font-size:11px; color:#888888; margin-top:2px;">Assigned Users</div></td>
<td width="1%"></td>
<td width="18%" align="center" style="background-color:#faf9f7; border:1px solid #ececea; border-radius:4px; padding:14px 4px;">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a;">{{SignedInUsers}}</div>
<div style="font-size:11px; color:#888888; margin-top:2px;">Signed In</div></td>
<td width="1%"></td>
<td width="18%" align="center" style="background-color:#faf9f7; border:1px solid #ececea; border-radius:4px; padding:14px 4px;">
<div style="font-size:20px; font-weight:bold; color:#c8102e;">{{SignInRate}}</div>
<div style="font-size:11px; color:#888888; margin-top:2px;">Sign-in Rate</div></td>
<td width="1%"></td>
<td width="18%" align="center" style="background-color:#faf9f7; border:1px solid #ececea; border-radius:4px; padding:14px 4px;">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a;">{{OpenTickets}}</div>
<div style="font-size:11px; color:#888888; margin-top:2px;">Open Tickets</div></td>
<td width="1%"></td>
<td width="18%" align="center" style="background-color:#faf9f7; border:1px solid #ececea; border-radius:4px; padding:14px 4px;">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a;">{{ClosedTickets}}</div>
<div style="font-size:11px; color:#888888; margin-top:2px;">Closed Tickets</div></td>
</tr></table></td></tr>
<tr><td style="padding:16px 32px 0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff7f0; border:1px solid #f3d9c4; border-radius:4px;">
<tr><td style="padding:10px 14px; font-size:12.5px; color:#7a4a1a;">
<b>{{NeverSignedIn}} of {{TotalUsers}} users</b> have never signed in to Kissflow.
</td></tr></table></td></tr>
<tr><td style="padding:20px 32px 24px 32px; font-size:13px; color:#5b5b5b; line-height:1.55;">
{{ReportBody}}
</td></tr>
<tr><td style="background-color:#faf9f7; padding:16px 32px; border-top:1px solid #ececea; font-size:11px; color:#a0a0a0;">
Refex User Engagement Report &middot; Automated &middot; Do not reply to this email
</td></tr>
</table></td></tr></table>
</body></html>`;

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
