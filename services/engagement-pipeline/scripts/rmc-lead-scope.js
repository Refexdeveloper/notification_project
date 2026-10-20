'use strict';

/**
 * Lead Management RMC schedule identity:
 *   Form/Website = RMC
 *   Entity filter = RIL_RMC (routes this template; Lead Tracker has no Entity_Code field)
 *
 * Rows in the email are FY Website=RMC leads (same countable rule as Modepro).
 * Other Lead Tracker websites keep the existing sales-person email.
 */

const { isRilRmcRecord } = require('./entity-code');

const RMC_LEAD_REPORT_NAME = 'RMC - Lead Management - Report';
const RMC_LEAD_FROM_EMAIL = 'support@refex.co.in';

const WEBSITE_KEYS = ['Website_and_form', 'Website', 'Form', 'Form_Name'];
const RAISED_BY_KEYS = ['Requester', 'Raised_By', 'Raised_by', 'Created_By', '_created_by', 'Requested_By'];
const NEXT_ACTION_KEYS = ['_current_assigned_to', 'Assigned_To', 'Current_Step_Owner', 'Next_Action_By'];
const STEP_KEYS = ['_current_step', 'Current_Step', '_activity_name', 'Step_Name', 'Step'];
const AMOUNT_KEYS = [
  'Lead_Value',
  'Deal_Value',
  'Estimated_Value',
  'Expected_Value',
  'Opportunity_Value',
  'Order_Value',
  'Quoted_Value',
  'Contract_Value',
  'Budget',
  'Value',
  'Amount',
  'Total_Amount',
  'Grand_Total',
  'Final_amount',
];
const REQUEST_ID_KEYS = ['Name', 'Lead_ID', 'Lead_Id', 'Request_Number', 'Request_ID', '_request_number'];

function websiteToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
}

function nestedLabel(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) {
    return value.map(nestedLabel).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return (
      nestedLabel(value.Name) ||
      nestedLabel(value.DisplayName) ||
      nestedLabel(value.name) ||
      nestedLabel(value.Email) ||
      nestedLabel(value.email) ||
      nestedLabel(value.Value) ||
      nestedLabel(value.value) ||
      nestedLabel(value.v) ||
      nestedLabel(value.StepName)
    );
  }
  return '';
}

function firstLabel(raw, keys) {
  if (!raw || typeof raw !== 'object') return '';
  for (const key of keys) {
    const label = nestedLabel(raw[key]);
    if (label) return label;
  }
  return '';
}

function leadWebsite(raw) {
  return firstLabel(raw, WEBSITE_KEYS);
}

function isRmcWebsite(raw) {
  return websiteToken(leadWebsite(raw)) === 'rmc';
}

function isRmcRilLead(raw) {
  return isRmcWebsite(raw) && isRilRmcRecord(raw);
}

function isRmcLeadSchedule(websiteFilter, entityFilter) {
  return websiteToken(websiteFilter) === 'rmc' && websiteToken(entityFilter) === 'rilrmc';
}

function isCompletedLead(raw) {
  const status = firstLabel(raw, ['Lead_Status', 'LeadStatus', 'Status', 'status', '_status']).toLowerCase();
  if (!status) return false;
  if (status === 'open' || status === 'in progress' || status === 'inprogress' || status === 'pending') return false;
  if (['close', 'closed', 'completed', 'complete', 'done'].includes(status)) return true;
  return /(complete|closed)/.test(status) && !/incomplete/.test(status);
}

function coerceAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') {
    return coerceAmount(value.v ?? value.Value ?? value.value ?? value.amount ?? value.Amount);
  }
  const text = String(value).replace(/[,₹\s]/g, '');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function leadAmount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of AMOUNT_KEYS) {
    const amount = coerceAmount(raw[key]);
    if (amount != null) return amount;
  }
  return null;
}

function formatInr(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseWhen(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object') {
    return parseWhen(value.v || value.dv || value.Value || value.value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function slaDayCount(raw, completed, now = new Date()) {
  const start =
    parseWhen(raw && raw._created_at) ||
    parseWhen(raw && raw.Created_At) ||
    parseWhen(raw && raw.Requested_Date) ||
    parseWhen(raw && raw._submitted_at);
  if (!start) return null;
  const end = completed
    ? parseWhen(raw._completed_at) || parseWhen(raw.Completed_At) || now
    : now;
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  return days;
}

function leadRequestFromRecord(raw, now = new Date()) {
  const completed = isCompletedLead(raw);
  const days = slaDayCount(raw, completed, now);
  return {
    requestId: firstLabel(raw, REQUEST_ID_KEYS) || '—',
    raisedBy: firstLabel(raw, RAISED_BY_KEYS) || '—',
    pendingWith: completed ? '—' : firstLabel(raw, NEXT_ACTION_KEYS) || '—',
    pendingAt: completed ? 'Completed' : firstLabel(raw, STEP_KEYS) || 'Pending',
    slaDays: days == null ? '—' : String(days),
    completed,
  };
}

function summarizeRequests(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const completed = list.filter((row) => row.completed).length;
  return {
    total: list.length,
    completed,
    pending: list.length - completed,
  };
}

function renderRequestTableHtml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return '<tr><td colspan="6" style="padding:14px; color:#6b6b6b;">No requests in this period.</td></tr>';
  }
  const ordered = [...list].sort((a, b) => Number(a.completed) - Number(b.completed));
  return ordered
    .map((row, idx) => {
      const bg = row.completed ? '#f4fbf5' : idx % 2 ? '#ffffff' : '#fffaf2';
      const completed = row.completed ? '1' : '0';
      return `<tr style="background-color:${bg};" bgcolor="${bg}">
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a;">${escapeHtml(row.raisedBy)}<div style="font-size:11px; color:#6b6b6b; margin-top:2px;">Raised by ${escapeHtml(row.raisedBy)}</div></td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a;">—</td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a;">${escapeHtml(row.pendingAt)}</td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a;">${escapeHtml(row.pendingWith)}</td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#1a1a1a;" align="center">${escapeHtml(row.slaDays)}</td>
<td style="padding:12px 10px; border-bottom:1px solid #ececea; color:#3f8f63; font-weight:bold;" align="center">${completed}</td>
</tr>`;
    })
    .join('');
}

function rmcLeadDateLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('day')}-${pick('month')}-${pick('year')}`;
}

function rmcLeadSubject(date = new Date()) {
  return `${RMC_LEAD_REPORT_NAME} (${rmcLeadDateLabel(date)})`;
}

module.exports = {
  RMC_LEAD_REPORT_NAME,
  RMC_LEAD_FROM_EMAIL,
  isRmcWebsite,
  isRmcRilLead,
  isRmcLeadSchedule,
  isCompletedLead,
  leadRequestFromRecord,
  summarizeRequests,
  renderRequestTableHtml,
  rmcLeadDateLabel,
  rmcLeadSubject,
  formatInr,
};
