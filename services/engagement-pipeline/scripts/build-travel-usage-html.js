#!/usr/bin/env node
'use strict';

/**
 * Builds email-safe Travel Management usage sections for a single entity.
 * Combines Advance Payment + Expense Management + Travel Management items.
 * Omits empty tables / sections. Reads JSON from stdin.
 */

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
  const step = String(userOrItem.pending_step || userOrItem.pending_owner || '').trim();
  return step ? `${duration} · ${step}` : duration;
}

function dash(value) {
  const text = String(value ?? '').trim();
  return text && text !== 'Never' ? text : '-';
}

function sectionHeading(title) {
  return (
    '<tr><td style="padding:22px 32px 6px 32px;" bgcolor="#ffffff">' +
    `<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">${esc(title)}</div>` +
    '</td></tr>'
  );
}

function tableWrap(headerCells, bodyRows, colCount) {
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

function userTableSection(users) {
  // Pending-user section: only requesters who still have open requests.
  const rows = visibleUsers(users).filter((user) => n(user.pending_count) > 0);
  if (!rows.length) return '';

  const body = rows
    .map((user, idx) => {
      const bg = idx % 2 === 0 ? '#faf9f7' : '#ffffff';
      const pending = n(user.pending_count);
      const sla = n(user.sla_breached_count);
      return (
        `<tr style="background-color:${bg};" bgcolor="${bg}">` +
        bodyCell(user.user_name || 'Unknown') +
        bodyCell(dash(user.last_sign_in)) +
        bodyCell(pending, { align: 'center', bold: true }) +
        bodyCell(formatDuration(user), { color: '#9a7a3a' }) +
        bodyCell(sla, { align: 'center', color: '#c8102e', bold: true }) +
        '</tr>'
      );
    })
    .join('');

  return (
    '<tr><td style="padding:26px 32px 6px 32px; font-size:13.5px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">Users with pending travel requests</td></tr>' +
    tableWrap(
      headerCell('User') +
        headerCell('Last Signed In') +
        headerCell('Pending', { align: 'center' }) +
        headerCell('Pending Duration') +
        headerCell('SLA Breached', { align: 'center' }),
      body,
    )
  );
}

function userTableHtml(users) {
  const rows = visibleUsers(users).filter((user) => n(user.pending_count) > 0);
  if (!rows.length) return '';
  return rows
    .map((user, idx) => {
      const bg = idx % 2 === 0 ? '#faf9f7' : '#ffffff';
      return (
        `<tr style="background-color:${bg};" bgcolor="${bg}">` +
        bodyCell(user.user_name || 'Unknown') +
        bodyCell(dash(user.last_sign_in)) +
        bodyCell(n(user.pending_count), { align: 'center', bold: true }) +
        bodyCell(formatDuration(user), { color: '#9a7a3a' }) +
        bodyCell(n(user.sla_breached_count), { align: 'center', color: '#c8102e', bold: true }) +
        '</tr>'
      );
    })
    .join('');
}

function parseJsonPayload(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch (firstErr) {
    // Shell logs can leak onto stdout before the JSON object; extract the first {...}.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw firstErr;
  }
}

function readInput() {
  const raw = process.env.TRAVEL_USAGE_JSON || '';
  if (raw.trim()) return parseJsonPayload(raw);
  const chunks = [];
  const stdin = process.stdin;
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    stdin.on('data', (chunk) => chunks.push(chunk));
    stdin.on('end', () => {
      try {
        resolve(parseJsonPayload(chunks.join('')));
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
      PendingDetailsHtml: '',
      SlaAnalysisHtml: '',
    }),
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
