/** Template placeholder preview — mirrors pipeline apply-report-template.js behaviour. */

import { sampleLeadReportTableHtml } from '@/services/leadReport';
import { ensureItsmSourcePlaceholders } from '@/lib/itsmTemplateLayout';

export type PreviewContext = {
  templateName?: string;
  subject?: string;
  /** Kissflow application id, e.g. IT_Service_Management_A00 */
  kissflowAppId?: string;
  applicationId?: string;
};

export type TemplateAppKind = 'itsm' | 'pm' | 'solar' | 'lead' | 'expense' | 'travel' | 'generic';

function sampleEngagementUserTableHtml(): string {
  return `<tr style="background-color:#faf9f7;" bgcolor="#faf9f7"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">Bhukkay Naik</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-27 08:22</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>1</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">48</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#c8102e !important;" align="center"><b>2</b></td></tr><tr style="background-color:#ffffff;" bgcolor="#ffffff"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">fazulahemed</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-29 10:15</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>1</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">45</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#c8102e !important;" align="center"><b>0</b></td></tr>`;
}

function samplePmUserTableHtml(): string {
  return `<tr style="background-color:#faf9f7;" bgcolor="#faf9f7"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">Priya Sharma</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-29 09:40</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>3</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">12</td></tr><tr style="background-color:#ffffff;" bgcolor="#ffffff"><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">Arun Kumar</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">2026-07-28 16:05</td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>1</b></td><td style="padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">8</td></tr>`;
}

function sampleItsmSourceBreakdownHtml(): string {
  const row = (label: string, count: string, tone: string, bg: string) =>
    `<tr style="background-color:${bg};" bgcolor="${bg}"><td style="padding:9px 12px; border-bottom:1px solid #ececea; font-size:12px; color:#334155 !important;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tone};margin-right:8px;"></span>${label}</td><td style="padding:9px 12px; border-bottom:1px solid #ececea; font-size:13px; font-weight:bold; color:#1a1a1a !important;" align="right">${count}</td></tr>`;
  const panel = (
    title: string,
    subtitle: string,
    total: string,
    headerBg: string,
    headerColor: string,
    counts: string[],
  ) =>
    `<td width="48%" valign="top" style="border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; background:#ffffff !important;" bgcolor="#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 14px; background:${headerBg} !important;" bgcolor="${headerBg}"><div style="font-size:11px; font-weight:bold; color:${headerColor} !important; text-transform:uppercase; letter-spacing:0.4px;">${title}</div><div style="font-size:11px; color:#64748b !important; margin-top:3px;">${subtitle} · <b style="color:#1a1a1a !important;">${total}</b></div></td></tr>${row('Email', counts[0], '#3b82f6', '#ffffff')}${row('WhatsApp', counts[1], '#22c55e', '#f8fafc')}${row('Mobile', counts[2], '#f59e0b', '#ffffff')}${row('Web', counts[3], '#8b5cf6', '#f8fafc')}</table></td>`;
  return (
    '<tr><td style="padding:14px 32px 4px 32px;" bgcolor="#ffffff"><div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Ticket source</div><div style="font-size:11px; color:#8a8a8a !important; margin-top:3px;">How tickets arrived — All tickets vs Today open tickets</div></td></tr>' +
    '<tr><td style="padding:10px 32px 2px 32px;" bgcolor="#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    panel('All tickets', 'By source', '164', '#f1f5f9', '#475569', ['48', '32', '21', '63']) +
    '<td width="4%"></td>' +
    panel('Today open tickets', 'Opened today by source', '5', '#fff7ed', '#9a7a3a', ['2', '1', '1', '1']) +
    '</tr></table></td></tr>'
  );
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
  if (id.includes('solar') || id.includes('technician_reimbursement') || id.includes('reinvestment')) {
    return 'solar';
  }
  if (id.includes('lead')) return 'lead';
  if (id.includes('it_service') || id.includes('itsm')) return 'itsm';
  if (id.includes('ems_001') || (id.includes('expense') && !id.includes('travel') && !id.includes('solar'))) {
    return 'expense';
  }
  if (id.includes('expense_and_travel') || id.includes('venwind') || id.includes('travel')) return 'travel';
  return 'generic';
}

export function defaultReportTitleForApp(kind: TemplateAppKind): string {
  switch (kind) {
    case 'pm':
      return 'Project Management Task Report';
    case 'solar':
      return 'Solar Reinvestment Request Report';
    case 'lead':
      return 'Lead Tracker Report';
    case 'expense':
      return 'Expense Management Report';
    case 'travel':
      return 'Travel Management Report';
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
    TotalUsers: '2',
    SignedInUsers: '153',
    SignInRate: '46%',
    SignInRateToday: '50%',
    SignedInToday: '1',
    OpenTickets: '5',
    ClosedTickets: '159',
    TotalTickets: '164',
    NeverSignedIn: '173',
    SlaBreachedTotal: '50',
    SlaBreachedOpen: '4',
    SlaBreachedClosed: '46',
    OpenedToday: '5',
    ClosedToday: '4',
    SourceEmailAll: '48',
    SourceWhatsAppAll: '32',
    SourceMobileAll: '21',
    SourceWebAll: '63',
    SourceEmailOpen: '2',
    SourceWhatsAppOpen: '1',
    SourceMobileOpen: '1',
    SourceWebOpen: '1',
    SourceBreakdownHtml: sampleItsmSourceBreakdownHtml(),
    OpenedTodaySourceHtml: '',
    TotalTasks: '240',
    AssignedTasks: '180',
    PendingTasks: '42',
    CompletedTasks: '198',
    TotalRequests: '48',
    AssignedRequests: '36',
    OpenRequests: '12',
    ClosedRequests: '36',
    TotalLeads: '6',
    OpenLeads: '3',
    ClosedLeads: '4',
    TotalClaims: '86',
    PendingClaims: '14',
    ClosedClaims: '72',
    PendingRequests: '9',
    CompletedRequests: '39',
    SalesPersons: '3',
    UserTableHtml: sampleEngagementUserTableHtml(),
    LeadTableHtml: sampleLeadReportTableHtml(),
    ReportBody:
      "Scoped to Entity = Refex only. SLA Breached compares actual ticket duration against the configured SLA target from Kissflow's Approval Matrix.",
  };

  if (kind === 'pm') {
    base.UserTableHtml = samplePmUserTableHtml();
    base.SignedInToday = '1';
    base.TotalUsers = '2';
    base.ReportBody = 'Project Tracker covers all entities group-wide.';
  } else if (kind === 'solar') {
    base.UserTableHtml = samplePmUserTableHtml();
    base.SignedInToday = '1';
    base.TotalUsers = '2';
    base.ReportBody =
      'Solar Expense Hub · Reinvestment Request process. Open/Closed Requests from Kissflow status.';
  } else if (kind === 'lead') {
    base.UserTableHtml = samplePmUserTableHtml();
    base.SignedInToday = '1';
    base.TotalUsers = '2';
    base.ReportBody = 'Users from Kissflow group with leads assigned to them (Open / Closed status from Lead Tracker).';
  } else if (kind === 'expense') {
    base.UserTableHtml = samplePmUserTableHtml();
    base.SignedInToday = '1';
    base.TotalUsers = '2';
    base.ReportBody = 'Expense Management covers pending and closed claims from Kissflow.';
  } else if (kind === 'travel') {
    base.UserTableHtml = samplePmUserTableHtml();
    base.SignedInToday = '1';
    base.TotalUsers = '2';
    base.ReportBody = 'Travel Management covers pending and completed travel requests from Kissflow.';
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

  const kind = isPreviewContextArg(contextOrOverrides)
    ? detectTemplateAppKind(contextOrOverrides)
    : 'generic';
  const prepared =
    kind === 'itsm' ? ensureItsmSourcePlaceholders(html).html : html;

  return applyTemplateVariables(prepared, merged);
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
    'SourceBreakdownHtml',
    'OpenedTodaySourceHtml',
    'SourceEmailAll',
    'SourceWhatsAppAll',
    'SourceMobileAll',
    'SourceWebAll',
    'SourceEmailOpen',
    'SourceWhatsAppOpen',
    'SourceMobileOpen',
    'SourceWebOpen',
    'UserTableHtml',
    'ReportBody',
  ],
  pm: [
    'ReportTitle',
    'ReportDate',
    'TotalTasks',
    'PendingTasks',
    'CompletedTasks',
    'TotalUsers',
    'SignedInToday',
    'OpenedToday',
    'ClosedToday',
    'UserTableHtml',
    'ReportBody',
  ],
  solar: [
    'ReportTitle',
    'ReportDate',
    'TotalRequests',
    'OpenRequests',
    'ClosedRequests',
    'TotalUsers',
    'SignedInToday',
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
    'TotalUsers',
    'SignedInToday',
    'OpenedToday',
    'ClosedToday',
    'UserTableHtml',
    'LeadTableHtml',
    'ReportBody',
  ],
  expense: [
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
  travel: [
    'ReportTitle',
    'ReportDate',
    'TotalRequests',
    'PendingRequests',
    'CompletedRequests',
    'TotalUsers',
    'SignedInToday',
    'OpenedToday',
    'ClosedToday',
    'UserTableHtml',
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
