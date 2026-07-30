/** Sync browser report schedules → server cron so emails actually send. */

import { apiFetch } from '@/services/api';
import type { ReportScheduler } from '@/stores/reportSchedulers';
import { getTemplateById, renderPreviewHtml } from '@/stores/reportTemplates';
import { loadCachedEngagement } from '@/services/userAnalytics';
import {
  buildLeadReport,
  leadReportToOverrides,
  loadCachedLeadReport,
  sampleLeadReportTableHtml,
} from '@/services/leadReport';
import { getApplicationById } from '@/mocks/applications';

export function cadenceToCron(cadence: ReportScheduler['cadence']): string {
  if (cadence.type === 'cron' && cadence.cronExpression?.trim()) {
    return cadence.cronExpression.trim();
  }
  const [hhRaw, mmRaw] = String(cadence.time || '09:00').split(':');
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  const h = Number.isFinite(hh) ? hh : 9;
  const m = Number.isFinite(mm) ? mm : 0;

  if (cadence.type === 'weekly') {
    const dow = cadence.weekday ?? 1; // 0=Sun … matches cron
    return `${m} ${h} * * ${dow}`;
  }
  if (cadence.type === 'monthly') {
    const day = Math.min(Math.max(cadence.monthDay || 1, 1), 28);
    return `${m} ${h} ${day} * *`;
  }
  // daily
  return `${m} ${h} * * *`;
}

function fillSubject(subject: string, overrides: Record<string, string>): string {
  return renderPreviewHtml(subject, overrides);
}

async function buildOverrides(sch: ReportScheduler): Promise<Record<string, string>> {
  const app = getApplicationById(sch.applicationId);
  const tpl = getTemplateById(sch.templateId);
  const engagement = loadCachedEngagement(sch.applicationId);
  const totals = engagement?.totals;

  const overrides: Record<string, string> = {
    ReportTitle: sch.name || 'Scheduled report',
    ReportDate: new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' }),
    RecipientName: 'Team',
    CompanyName: 'REFEX',
    TotalUsers: totals ? String(totals.totalUsers) : '0',
    SignedInUsers: totals ? String(totals.activeToday) : '0',
    SignInRate:
      totals && totals.totalUsers
        ? `${Math.round((totals.activeToday / totals.totalUsers) * 100)}%`
        : '0%',
    OpenTickets: '—',
    ClosedTickets: '—',
    NeverSignedIn: totals ? String(totals.neverLoggedIn) : '0',
    ReportBody: `Scheduled delivery for ${app?.displayName || app?.name || 'application'}.`,
  };

  const needsLead =
    tpl &&
    (tpl.variables.includes('LeadTableHtml') ||
      tpl.html.includes('{{LeadTableHtml}}') ||
      tpl.variables.includes('WebsiteName') ||
      tpl.variables.includes('GroupName') ||
      sch.userGroupFilter);

  if (needsLead && app) {
    const websiteFilter = sch.websiteFilter?.trim() || '';
    const userGroupFilter = sch.userGroupFilter?.trim() || '';
    let report = loadCachedLeadReport(app.id, websiteFilter, userGroupFilter);

    if (app.connected) {
      try {
        report = await buildLeadReport(app, { websiteFilter, userGroupFilter });
      } catch {
        /* use cache if live fetch fails */
      }
    }

    if (report) {
      Object.assign(overrides, leadReportToOverrides(report));
    } else {
      Object.assign(overrides, {
        GroupName: userGroupFilter || websiteFilter || 'All teams',
        WebsiteName: websiteFilter || userGroupFilter || 'All websites',
        TotalLeads: '—',
        OpenLeads: '—',
        ClosedLeads: '—',
        SignedInToday: '—',
        SalesPersons: '—',
        LeadTableHtml: sampleLeadReportTableHtml(),
      });
    }
  }

  return overrides;
}

export async function syncSchedulerToServer(
  sch: ReportScheduler,
): Promise<{ ok: boolean; error?: string; serverId?: number }> {
  const tpl = getTemplateById(sch.templateId);
  if (!tpl) {
    return { ok: false, error: 'Template not found — pick an HTML template before activating' };
  }
  if (!sch.recipients.length) {
    return { ok: false, error: 'Add at least one recipient before activating' };
  }

  const overrides = await buildOverrides(sch);
  const subject = fillSubject(tpl.subject || sch.name, overrides);
  const html = renderPreviewHtml(tpl.html, overrides);
  const cron_expression = cadenceToCron(sch.cadence);

  const res = await apiFetch<{ id: number }>('/api/schedulers/sync', {
    method: 'POST',
    body: JSON.stringify({
      external_id: sch.id,
      name: sch.name,
      cron_expression,
      job_type: 'report_send',
      to_emails: sch.recipients,
      cc_emails: sch.cc || [],
      subject,
      html_body: html,
      is_active: sch.status === 'active',
      meta: {
        applicationId: sch.applicationId,
        templateId: sch.templateId,
        cadence: sch.cadence,
        websiteFilter: sch.websiteFilter,
        userGroupFilter: sch.userGroupFilter,
        timezone: 'Asia/Kolkata',
      },
    }),
  });

  if (!res.ok) return { ok: false, error: res.error || 'Failed to sync schedule to server' };
  return { ok: true, serverId: res.data?.id };
}

export async function removeSchedulerFromServer(externalId: string): Promise<void> {
  await apiFetch(`/api/schedulers/by-external/${encodeURIComponent(externalId)}`, {
    method: 'DELETE',
  });
}

export async function runSchedulerNow(
  externalId: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  // Refresh snapshot (subject/html) before forcing a send
  const { getSchedulerById } = await import('@/stores/reportSchedulers');
  const sch = getSchedulerById(externalId);
  if (sch) {
    const synced = await syncSchedulerToServer({ ...sch, status: 'active' });
    if (!synced.ok) return { ok: false, error: synced.error };
  }

  const res = await apiFetch<{ message?: string }>('/api/schedulers/run-now', {
    method: 'POST',
    body: JSON.stringify({ external_id: externalId }),
  });
  if (!res.ok) {
    const detail =
      (res.data && typeof res.data === 'object' && 'message' in res.data
        ? String((res.data as { message?: string }).message)
        : null) ||
      res.error ||
      'Send failed';
    return { ok: false, error: detail };
  }
  return { ok: true, message: res.data?.message || 'Email queued/sent' };
}
