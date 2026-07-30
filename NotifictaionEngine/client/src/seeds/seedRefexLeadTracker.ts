/**
 * Seeds Lead Tracker sales-person report template + per-group daily schedulers.
 * Data: Kissflow Lead Tracker items → filter by Website_and_form → assignee Open/Closed counts.
 */

import { getApplications, type KissflowApplication } from '@/mocks/applications';
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
import {
  LEAD_TRACKER_SALES_GROUPS,
  LEAD_TRACKER_TEST_RECIPIENTS,
  sampleLeadReportTableHtml,
} from '@/services/leadReport';
import {
  appStorageId,
  type RefexEnvironment,
} from './refexAppCatalog';

export const REFEX_LEAD_TRACKER_PROD_APP_ID = appStorageId('lead-tracker', 'Production');
export const REFEX_LEAD_TRACKER_DEV_APP_ID = appStorageId('lead-tracker', 'Development');

const TEMPLATES_KEY = 'ne_report_templates';
const SCHEDULERS_KEY = 'ne_report_schedulers';

function templateIdForApp(appId: string) {
  return `tpl-refex-lead-tracker-${appId.includes('prod') ? 'prod' : 'dev'}`;
}

function schedulerIdForGroup(appId: string, slug: string) {
  return `sch-refex-lead-${appId.includes('prod') ? 'prod' : 'dev'}-${slug}`;
}

export const LEAD_TRACKER_REPORT_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{{ReportTitle}}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="720" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
<tr><td style="background:linear-gradient(135deg,#ea580c 0%,#f97316 50%,#fb923c 100%);padding:28px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td>
<div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.85);">{{CompanyName}}</div>
<div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:6px;line-height:1.25;">{{ReportTitle}}</div>
<div style="font-size:13px;color:rgba(255,255,255,0.92);margin-top:8px;">Team: <strong>{{GroupName}}</strong> &middot; {{ReportDate}}</div>
</td>
<td align="right" valign="middle" style="font-size:12px;color:rgba(255,255,255,0.88);">Lead Tracker</td>
</tr></table></td></tr>
<tr><td style="padding:24px 32px 8px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="23%" align="center" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 8px;">
<div style="font-size:24px;font-weight:800;color:#ea580c;">{{TotalLeads}}</div>
<div style="font-size:11px;color:#9a3412;margin-top:4px;font-weight:600;">Total Leads</div></td>
<td width="2%"></td>
<td width="23%" align="center" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 8px;">
<div style="font-size:24px;font-weight:800;color:#ea580c;">{{OpenLeads}}</div>
<div style="font-size:11px;color:#9a3412;margin-top:4px;font-weight:600;">Open Leads</div></td>
<td width="2%"></td>
<td width="23%" align="center" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px 8px;">
<div style="font-size:24px;font-weight:800;color:#059669;">{{ClosedLeads}}</div>
<div style="font-size:11px;color:#047857;margin-top:4px;font-weight:600;">Closed Leads</div></td>
<td width="2%"></td>
<td width="23%" align="center" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 8px;">
<div style="font-size:24px;font-weight:800;color:#2563eb;">{{SignedInToday}}</div>
<div style="font-size:11px;color:#1d4ed8;margin-top:4px;font-weight:600;">Signed In Today</div></td>
</tr></table></td></tr>
<tr><td style="padding:20px 32px 8px 32px;">
<div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px;">Sales team overview</div>
<div style="font-size:12px;color:#64748b;margin-bottom:16px;">Users from Kissflow group <strong>{{GroupName}}</strong> with leads assigned to them (Open / Closed status from Lead Tracker).</div>
{{LeadTableHtml}}
</td></tr>
<tr><td style="padding:8px 32px 24px 32px;font-size:12px;color:#64748b;line-height:1.55;">
{{ReportBody}}
</td></tr>
<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">
Lead Tracker Report &middot; Automated from Kissflow &middot; Do not reply
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

function upsertScheduler(sch: ReportScheduler, forceActive = false) {
  const raw = localStorage.getItem(SCHEDULERS_KEY);
  const list: ReportScheduler[] = raw ? (JSON.parse(raw) as ReportScheduler[]) : [];
  const idx = list.findIndex((s) => s.id === sch.id);
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...sch,
      recipients: prev.recipients.length ? prev.recipients : sch.recipients,
      status: forceActive ? 'active' : prev.status,
      lastRunAt: prev.lastRunAt,
    };
  } else {
    list.unshift(sch);
  }
  localStorage.setItem(SCHEDULERS_KEY, JSON.stringify(list));
}

function seedTemplate(app: KissflowApplication) {
  const now = new Date().toISOString();
  const templateId = templateIdForApp(app.id);
  const subject = 'Lead Tracker — {{GroupName}} sales report';
  const html = LEAD_TRACKER_REPORT_HTML;
  const existingTpl = getTemplatesByAppId(app.id).find((t) => t.id === templateId);

  upsertTemplate({
    id: templateId,
    applicationId: app.id,
    name: 'Lead Tracker Sales Report',
    description:
      'Per sales team: leads filtered by Website_and_form, grouped by assigned sales person (Open/Closed).',
    subject,
    html,
    status: 'published',
    variables: extractVariables(html, subject),
    createdAt: existingTpl?.createdAt || now,
    updatedAt: now,
    createdBy: 'Refex seed',
  });

  return templateId;
}

function seedGroupSchedulers(app: KissflowApplication, env: RefexEnvironment, templateId: string) {
  const now = new Date().toISOString();
  const cadence = { type: 'daily' as const, time: '17:05' };
  const existing = getSchedulersByAppId(app.id);

  for (const group of LEAD_TRACKER_SALES_GROUPS) {
    const schId = schedulerIdForGroup(app.id, group.slug);
    const prev = existing.find((s) => s.id === schId);
    const defaultActive = env === 'Production';

    upsertScheduler(
      {
        id: schId,
        applicationId: app.id,
        name: `Lead Tracker — ${group.groupName}`,
        description: `Daily 17:05 IST (${env}). Leads for "${group.websiteFilter}" grouped by assignee.`,
        status: defaultActive ? 'active' : 'draft',
        templateId,
        templateName: 'Lead Tracker Sales Report',
        cadence,
        recipients: prev?.recipients?.length ? prev.recipients : [...LEAD_TRACKER_TEST_RECIPIENTS],
        cc: prev?.cc || [],
        userGroupFilter: group.groupName,
        websiteFilter: group.websiteFilter,
        lastRunAt: prev?.lastRunAt || null,
        nextRunAt: computeNextRun(cadence),
        createdAt: prev?.createdAt || now,
        updatedAt: now,
      },
      defaultActive,
    );
  }

  // Remove legacy single scheduler if present
  const legacyId = `sch-refex-lead-tracker-${app.id.includes('prod') ? 'prod' : 'dev'}`;
  const raw = localStorage.getItem(SCHEDULERS_KEY);
  if (raw) {
    const list = JSON.parse(raw) as ReportScheduler[];
    const filtered = list.filter((s) => s.id !== legacyId);
    if (filtered.length !== list.length) {
      localStorage.setItem(SCHEDULERS_KEY, JSON.stringify(filtered));
    }
  }
}

function seedForApp(app: KissflowApplication, env: RefexEnvironment) {
  const templateId = seedTemplate(app);
  seedGroupSchedulers(app, env, templateId);
}

/** Idempotent: upserts Lead Tracker template + one schedule per sales group. */
export function seedRefexLeadTracker(): void {
  const apps = getApplications();
  const prod = apps.find((a) => a.id === REFEX_LEAD_TRACKER_PROD_APP_ID);
  const dev = apps.find((a) => a.id === REFEX_LEAD_TRACKER_DEV_APP_ID);

  if (prod) seedForApp(prod, 'Production');
  if (dev) seedForApp(dev, 'Development');
}

export function leadTrackerPreviewOverrides(): Record<string, string> {
  return {
    ReportTitle: 'Sales Team Modepro — Lead Tracker',
    CompanyName: 'REFEX',
    GroupName: 'Sales Team Modepro',
    WebsiteName: 'Modepro',
    TotalLeads: '6',
    OpenLeads: '3',
    ClosedLeads: '4',
    SignedInToday: '0',
    SalesPersons: '3',
    LeadTableHtml: sampleLeadReportTableHtml(),
    ReportBody:
      'Live data from Kissflow: users in group "Sales Team Modepro" with open/closed lead counts.',
  };
}
