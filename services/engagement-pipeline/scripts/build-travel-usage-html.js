#!/usr/bin/env node
'use strict';

/**
 * Builds email-safe Travel Management usage sections for a single entity.
 * Combines Advance Payment + Expense Management + Travel Management items.
 * Omits empty tables / sections. Reads JSON from stdin.
 */

// Same order + labels as Travel dashboard (appDashboard TRAVEL_PROCESS_META).
const PROCESS_ORDER = [
  {
    id: 'Travel_Management_A02',
    label: 'Travel Request',
    subtitle: 'Travel Management Process',
  },
  {
    id: 'Advance_Payment_Request_Process_A01',
    label: 'Travel Advance',
    subtitle: 'Advance Payment Request Process',
  },
  {
    id: 'Expense_Management_A03',
    label: 'Travel Expense',
    subtitle: 'Expense Management Process',
  },
];

function n(v, fallback = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isKissflowId(name) {
  return typeof name === 'string' && /^[Uu][Ss][A-Za-z0-9_-]{6,}$/.test(name);
}

function visibleUsers(users) {
  return (Array.isArray(users) ? users : []).filter((user) => {
    const name = String(user.user_name || '').trim();
    return name.length > 0 && !isKissflowId(name);
  });
}

function formatDuration(userOrItem) {
  const days = n(userOrItem.pending_days != null ? userOrItem.pending_days : userOrItem.oldest_pending_days);
  const hours = n(userOrItem.pending_hours);
  let duration = '< 1 hour';
  if (days >= 1) duration = days === 1 ? '1 day' : `${days} days`;
  else if (hours >= 1) duration = hours === 1 ? '1 hour' : `${hours} hours`;
  // Oldest pending item: age + current assignee (or workflow step if no assignee name).
  const assignee = String(userOrItem.pending_owner || userOrItem.pending_step || '').trim();
  return assignee ? `${duration} · ${assignee}` : duration;
}

function dash(value) {
  const text = String(value ?? '').trim();
  return text && text !== 'Never' ? text : '-';
}

function tableWrap(headerCells, bodyRows) {
  if (!bodyRows) return '';
  return (
    '<tr><td style="padding:8px 32px 28px 32px;" bgcolor="#ffffff">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:11.5px; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">' +
    '<tr style="background:linear-gradient(90deg,#14503a 0%,#1a8c5c 100%) !important;" bgcolor="#14503a">' +
    headerCells +
    '</tr>' +
    bodyRows +
    '</table></td></tr>'
  );
}

function headerCell(label, opts = {}) {
  const align = opts.align ? ` align="${opts.align}"` : '';
  return `<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;"${align}>${esc(label)}</td>`;
}

function bodyCell(value, opts = {}) {
  const align = opts.align ? ` align="${opts.align}"` : '';
  const color = opts.color || '#1a1a1a';
  const inner = opts.bold ? `<b>${esc(value)}</b>` : esc(value);
  return `<td style="padding:10px 8px; border-bottom:1px solid #ececea; color:${color} !important;"${align}>${inner}</td>`;
}

function kpiCard(value, label, tone, width = '23%') {
  const tones = {
    blue: {
      bg: 'linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%)',
      border: '#dfe8f2',
      label: '#5b7ba3',
    },
    amber: {
      bg: 'linear-gradient(180deg,#fffaf2 0%,#fef3e2 100%)',
      border: '#f2e2c4',
      label: '#9a7a3a',
    },
    green: {
      bg: 'linear-gradient(180deg,#f4fbf5 0%,#e0f5e8 100%)',
      border: '#c7ead4',
      label: '#3f8f63',
    },
    red: {
      bg: 'linear-gradient(180deg,#fff5f5 0%,#ffe9e9 100%)',
      border: '#f3cccc',
      label: '#a35560',
      value: '#c8102e',
    },
  };
  const t = tones[tone] || tones.blue;
  const valueColor = t.value || '#1a1a1a';
  return (
    `<td width="${width}" align="center" valign="top" style="background:${t.bg} !important; border:1px solid ${t.border}; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(0,0,0,0.05);">` +
    `<div style="font-size:22px; font-weight:bold; color:${valueColor} !important;">${esc(value)}</div>` +
    `<div style="font-size:10px; color:${t.label} !important; margin-top:5px; font-weight:bold; text-transform:uppercase; letter-spacing:0.3px;">${esc(label)}</div>` +
    '</td>'
  );
}

function processSectionsHtml(byProcess) {
  const rows = Array.isArray(byProcess) ? byProcess : [];
  const byId = new Map(rows.map((row) => [String(row.process_id || ''), row]));

  return PROCESS_ORDER.map((meta, index) => {
    const row = byId.get(meta.id) || {};
    const total = n(row.total);
    const pending = n(row.pending);
    const completed = n(row.completed);
    const rejected = n(row.rejected);
    const rowLabel = `${index + 1}. ${meta.label}`;
    return (
      `<tr><td style="padding:18px 32px 4px 32px;" bgcolor="#ffffff">` +
      `<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">${esc(rowLabel)}</div>` +
      `<div style="font-size:11px; color:#8a8a8a !important; margin-top:2px;">${esc(meta.subtitle)} · this entity only</div>` +
      `</td></tr>` +
      `<tr><td style="padding:8px 32px 4px 32px;" bgcolor="#ffffff">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
      kpiCard(total, 'Total', 'blue') +
      '<td width="2%"></td>' +
      kpiCard(pending, 'In Progress', 'amber') +
      '<td width="2%"></td>' +
      kpiCard(completed, 'Completed', 'green') +
      '<td width="2%"></td>' +
      kpiCard(rejected, 'Rejected', 'red') +
      `</tr></table></td></tr>`
    );
  }).join('');
}

function userTableSection(users) {
  // MIS-style table: requesters with pending and/or completed counts for this entity.
  const rows = visibleUsers(users).filter(
    (user) => n(user.pending_count) > 0 || n(user.completed_count) > 0 || n(user.total_count) > 0,
  );
  if (!rows.length) return '';

  const body = rows
    .map((user, idx) => {
      const bg = idx % 2 === 0 ? '#faf9f7' : '#ffffff';
      const pending = n(user.pending_count);
      const completed = n(user.completed_count);
      const sla = n(user.sla_breached_count);
      return (
        `<tr style="background-color:${bg};" bgcolor="${bg}">` +
        bodyCell(user.user_name || 'Unknown') +
        bodyCell(dash(user.last_sign_in)) +
        bodyCell(pending, { align: 'center', bold: true, color: pending > 0 ? '#9a7a3a' : '#1a1a1a' }) +
        bodyCell(completed, { align: 'center', bold: true, color: '#3f8f63' }) +
        bodyCell(pending > 0 ? formatDuration(user) : '-', { color: '#9a7a3a' }) +
        bodyCell(sla, { align: 'center', color: '#c8102e', bold: true }) +
        '</tr>'
      );
    })
    .join('');

  return (
    '<tr><td style="padding:26px 32px 6px 32px; font-size:13.5px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">MIS · Users (Pending &amp; Completed)</td></tr>' +
    tableWrap(
      headerCell('User') +
        headerCell('Last Signed In') +
        headerCell('Pending', { align: 'center' }) +
        headerCell('Completed', { align: 'center' }) +
        headerCell('Pending Duration') +
        headerCell('SLA Breached', { align: 'center' }),
      body,
    )
  );
}

function userTableHtml(users) {
  const rows = visibleUsers(users).filter((user) => n(user.pending_count) > 0 || n(user.completed_count) > 0);
  if (!rows.length) return '';
  return rows
    .map((user, idx) => {
      const bg = idx % 2 === 0 ? '#faf9f7' : '#ffffff';
      return (
        `<tr style="background-color:${bg};" bgcolor="${bg}">` +
        bodyCell(user.user_name || 'Unknown') +
        bodyCell(dash(user.last_sign_in)) +
        bodyCell(n(user.pending_count), { align: 'center', bold: true }) +
        bodyCell(n(user.completed_count), { align: 'center', bold: true }) +
        bodyCell(n(user.pending_count) > 0 ? formatDuration(user) : '-', { color: '#9a7a3a' }) +
        bodyCell(n(user.sla_breached_count), { align: 'center', color: '#c8102e', bold: true }) +
        '</tr>'
      );
    })
    .join('');
}

function readInput() {
  const raw = process.env.TRAVEL_USAGE_JSON || '';
  if (raw.trim()) return JSON.parse(raw);
  const chunks = [];
  const stdin = process.stdin;
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    stdin.on('data', (chunk) => chunks.push(chunk));
    stdin.on('end', () => {
      const text = chunks.join('').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    stdin.on('error', reject);
  });
}

async function main() {
  const payload = await readInput();
  const section = payload.sections && payload.sections[0] ? payload.sections[0] : payload;
  process.stdout.write(
    JSON.stringify({
      UserTableHtml: userTableHtml(section.users),
      UserTableSectionHtml: userTableSection(section.users),
      ProcessSectionsHtml: processSectionsHtml(section.by_process),
      PendingDetailsHtml: '',
      SlaAnalysisHtml: '',
    }),
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
