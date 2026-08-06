/** Template placeholder preview — mirrors pipeline apply-report-template.js behaviour. */

import { sampleLeadReportTableHtml } from '@/services/leadReport';

export type PreviewContext = {
  templateName?: string;
  subject?: string;
  /** Kissflow application id, e.g. IT_Service_Management_A00 */
  kissflowAppId?: string;
  applicationId?: string;
};

export type TemplateAppKind = 'itsm' | 'pm' | 'lead' | 'generic';

function sampleEngagementUserTableHtml(): string {
  return `<tr style="background-color:#faf9f7;" bgcolor="#faf9f7"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">Bhukkay Naik</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-27 08:22</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>1</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">48</td></tr><tr style="background-color:#ffffff;" bgcolor="#ffffff"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">fazulahemed</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-29 10:15</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>1</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">45</td></tr>`;
}

function samplePmUserTableHtml(): string {
  return `<tr style="background-color:#faf9f7;" bgcolor="#faf9f7"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">Priya Sharma</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-29 09:40</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>3</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">12</td></tr><tr style="background-color:#ffffff;" bgcolor="#ffffff"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">Arun Kumar</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-28 16:05</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>1</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">8</td></tr>`;
}

export function formatPreviewReportDate(now = new Date()): string {
  return (
    now.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' IST'
  );
}

export function detectTemplateAppKind(context: PreviewContext = {}): TemplateAppKind {
  const id = `${context.kissflowAppId || ''} ${context.applicationId || ''}`.toLowerCase();
  if (id.includes('project_management') || id.includes('project_sub_task')) return 'pm';
  if (id.includes('lead')) return 'lead';
  if (id.includes('it_service') || id.includes('itsm')) return 'itsm';
  return 'generic';
}

export function defaultReportTitleForApp(kind: TemplateAppKind): string {
  switch (kind) {
    case 'pm':
      return 'Project Management Task Report';
    case 'lead':
      return 'Lead Tracker Report';
    case 'itsm':
      return 'Kissflow User Engagement Report';
    default:
      return 'Scheduled Report';
  }
}

export function buildPreviewSampleData(context: PreviewContext = {}): Record<string, string> {
  const kind = detectTemplateAppKind(context);
  const templateName = context.templateName?.trim() || '';
  const reportTitle = templateName || defaultReportTitleForApp(kind);
  const reportDate = formatPreviewReportDate();

  const base: Record<string, string> = {
    ReportTitle: reportTitle,
    ReportDate: reportDate,
    RecipientName: 'Team',
    CompanyName: 'REFEX',
    WebsiteName: 'Modepro',
    GroupName: 'Sales Team Modepro',
    TotalUsers: '326',
    SignedInUsers: '153',
    SignInRate: '46%',
    SignInRateToday: '2%',
    SignedInToday: '7',
    OpenTickets: '5',
    ClosedTickets: '159',
    TotalTickets: '164',
    NeverSignedIn: '173',
    SlaBreachedTotal: '50',
    SlaBreachedOpen: '4',
    SlaBreachedClosed: '46',
    OpenedToday: '5',
    ClosedToday: '4',
    TotalTasks: '240',
    AssignedTasks: '180',
    PendingTasks: '42',
    CompletedTasks: '198',
    TotalLeads: '6',
    OpenLeads: '3',
    ClosedLeads: '4',
    SalesPersons: '3',
    UserTableHtml: sampleEngagementUserTableHtml(),
    LeadTableHtml: sampleLeadReportTableHtml(),
    ReportBody:
      "Scoped to Entity = Refex only. SLA Breached compares actual ticket duration against the configured SLA target from Kissflow's Approval Matrix.",
  };

  if (kind === 'pm') {
    base.UserTableHtml = samplePmUserTableHtml();
    base.ReportBody = 'Project Tracker covers all entities group-wide.';
  } else if (kind === 'lead') {
    base.ReportBody = 'Users from Kissflow group with leads assigned to them (Open / Closed status from Lead Tracker).';
  }

  return base;
}

export function normalizeTemplateHtmlForPreview(html: string): string {
  return String(html || '')
    .replace(/refex-logo\.png/gi, 'refexone-logo.png')
    .replace(/alt="Refex"/gi, 'alt="refexOne"');
}

export function applyTemplateVariables(templateBody: string, variables: Record<string, string>): string {
  let body = normalizeTemplateHtmlForPreview(templateBody);
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const k = key.trim();
    return Object.prototype.hasOwnProperty.call(variables, k) ? variables[k] : `{{${k}}}`;
  });
}

function isPreviewContextArg(arg: PreviewContext | Record<string, string>): arg is PreviewContext {
  if (!arg || typeof arg !== 'object') return false;
  return (
    'templateName' in arg ||
    'subject' in arg ||
    'kissflowAppId' in arg ||
    'applicationId' in arg
  );
}

/** Render HTML or subject with sample / override placeholder values. */
export function renderPreviewHtml(
  html: string,
  contextOrOverrides: PreviewContext | Record<string, string> = {},
): string {
  const base = isPreviewContextArg(contextOrOverrides)
    ? buildPreviewSampleData(contextOrOverrides)
    : buildPreviewSampleData({});

  const merged = isPreviewContextArg(contextOrOverrides)
    ? base
    : { ...base, ...contextOrOverrides };

  return applyTemplateVariables(html, merged);
}

export const PLACEHOLDER_HINTS_BY_APP: Record<TemplateAppKind, string[]> = {
  itsm: [
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
    'SlaBreachedOpen',
    'SlaBreachedClosed',
    'OpenedToday',
    'ClosedToday',
    'UserTableHtml',
    'ReportBody',
  ],
  pm: [
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
  lead: [
    'ReportTitle',
    'ReportDate',
    'CompanyName',
    'GroupName',
    'TotalLeads',
    'OpenLeads',
    'ClosedLeads',
    'SalesPersons',
    'LeadTableHtml',
    'ReportBody',
  ],
  generic: [
    'ReportTitle',
    'ReportDate',
    'TotalTickets',
    'OpenTickets',
    'ClosedTickets',
    'UserTableHtml',
    'ReportBody',
    'RecipientName',
    'CompanyName',
  ],
};

/** Placeholders the engagement-pipeline render runbooks actually fill at send time. */
export function pipelinePlaceholdersForApp(kind: TemplateAppKind): string[] {
  return PLACEHOLDER_HINTS_BY_APP[kind] || PLACEHOLDER_HINTS_BY_APP.generic;
}

export function unknownPlaceholders(
  usedKeys: string[],
  kind: TemplateAppKind,
): string[] {
  const known = new Set(pipelinePlaceholdersForApp(kind));
  return usedKeys.filter((key) => !known.has(key));
}
