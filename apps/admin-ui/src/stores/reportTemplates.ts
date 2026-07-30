/** Per-app HTML email report templates (localStorage). */

import { sampleLeadReportTableHtml } from '@/services/leadReport';

export type TemplateStatus = 'draft' | 'published' | 'archived';

export interface ReportTemplate {
  id: string;
  /** Kissflow application id from ne_applications */
  applicationId: string;
  name: string;
  description: string;
  subject: string;
  /** Full HTML body for the email report */
  html: string;
  status: TemplateStatus;
  /** Placeholders used, e.g. {{SignInRate}} */
  variables: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

const STORAGE_KEY = 'ne_report_templates';

function readStore(): ReportTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReportTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(list: ReportTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getTemplates(): ReportTemplate[] {
  return readStore().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getTemplatesByAppId(applicationId: string): ReportTemplate[] {
  return getTemplates().filter((t) => t.applicationId === applicationId);
}

export function getTemplateById(id: string): ReportTemplate | undefined {
  return getTemplates().find((t) => t.id === id);
}

export function extractVariables(html: string, subject: string): string[] {
  const text = `${subject}\n${html}`;
  const found = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    found.add(m[1].trim());
  }
  return Array.from(found);
}

/** Starter HTML inspired by Refex-style engagement reports — customize per app. */
export function defaultReportHtml(appName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{ReportTitle}}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#12202a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2eaee;">
          <tr>
            <td style="background:#0f766e;padding:28px 32px;">
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);">Notification Engine</div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">{{ReportTitle}}</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:8px;">${appName} · {{ReportDate}}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#3d4f5c;">
                Hello {{RecipientName}}, here is your scheduled report for <strong>${appName}</strong>.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="33%" style="padding:8px;">
                    <div style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:12px;padding:16px;text-align:center;">
                      <div style="font-size:11px;color:#0f766e;font-weight:600;text-transform:uppercase;">Users</div>
                      <div style="font-size:24px;font-weight:700;color:#134e4a;margin-top:6px;">{{TotalUsers}}</div>
                    </div>
                  </td>
                  <td width="33%" style="padding:8px;">
                    <div style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:12px;padding:16px;text-align:center;">
                      <div style="font-size:11px;color:#0f766e;font-weight:600;text-transform:uppercase;">Signed in</div>
                      <div style="font-size:24px;font-weight:700;color:#134e4a;margin-top:6px;">{{SignInRate}}</div>
                    </div>
                  </td>
                  <td width="33%" style="padding:8px;">
                    <div style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:12px;padding:16px;text-align:center;">
                      <div style="font-size:11px;color:#0f766e;font-weight:600;text-transform:uppercase;">Open items</div>
                      <div style="font-size:24px;font-weight:700;color:#134e4a;margin-top:6px;">{{OpenTickets}}</div>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:24px;font-size:13px;color:#5b6b76;line-height:1.6;">
                {{ReportBody}}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid #eef2f4;font-size:11px;color:#8a9aa5;">
              Sent by Notification Engine · {{CompanyName}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface CreateTemplateInput {
  applicationId: string;
  name: string;
  description?: string;
  subject?: string;
  html?: string;
  status?: TemplateStatus;
  createdBy?: string;
}

export function createTemplate(input: CreateTemplateInput): ReportTemplate {
  const now = new Date().toISOString();
  const html = input.html || defaultReportHtml(input.name || 'Application');
  const subject = input.subject || `{{ReportTitle}} — ${input.name}`;
  const tpl: ReportTemplate = {
    id: `tpl-${Date.now()}`,
    applicationId: input.applicationId,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    subject,
    html,
    status: input.status || 'draft',
    variables: extractVariables(html, subject),
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy || 'You',
  };
  const list = getTemplates();
  list.unshift(tpl);
  writeStore(list);
  return tpl;
}

export function updateTemplate(
  id: string,
  patch: Partial<
    Pick<ReportTemplate, 'name' | 'description' | 'subject' | 'html' | 'status' | 'applicationId'>
  >,
): ReportTemplate | undefined {
  const list = getTemplates();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return undefined;
  const next = {
    ...list[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  next.variables = extractVariables(next.html, next.subject);
  list[idx] = next;
  writeStore(list);
  return next;
}

export function deleteTemplate(id: string) {
  writeStore(getTemplates().filter((t) => t.id !== id));
}

export function publishTemplate(id: string): ReportTemplate | undefined {
  return updateTemplate(id, { status: 'published' });
}

/** Preview with sample placeholder values */
export function renderPreviewHtml(html: string, overrides: Record<string, string> = {}): string {
  const samples: Record<string, string> = {
    ReportTitle: 'User engagement report',
    ReportDate: new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' }),
    RecipientName: 'Team',
    TotalUsers: '262',
    SignedInUsers: '149',
    SignInRate: '56%',
    OpenTickets: '4',
    ClosedTickets: '128',
    NeverSignedIn: '113',
    ReportBody: 'This is a live preview of your HTML report template.',
    CompanyName: 'REFEX',
    WebsiteName: 'Website',
    GroupName: 'Sales Team Modepro',
    TotalLeads: '6',
    OpenLeads: '3',
    ClosedLeads: '4',
    SignedInToday: '0',
    SalesPersons: '3',
    LeadTableHtml: sampleLeadReportTableHtml(),
    ...overrides,
  };
  return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const k = key.trim();
    return samples[k] ?? `{{${k}}}`;
  });
}
