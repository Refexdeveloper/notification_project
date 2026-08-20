#!/usr/bin/env node
'use strict';

/**
 * Builds email-safe Travel Management usage sections (overall KPIs + per-entity
 * requester-wise pending/usage tables). Reads JSON from stdin.
 *
 * Input:
 * {
 *   overall?: { total, pending, completed, rejected, total_users, opened_today, closed_today },
 *   sections: [{
 *     entity, total, pending, completed, rejected, total_users, signed_in_today,
 *     opened_today, closed_today,
 *     users: [{ user_name, last_sign_in, total_count, pending_count, completed_count,
 *               rejected_count, oldest_pending_days, pending_step }]
 *   }]
 * }
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

function kpiCard(width, value, label, sub, tones) {
  return (
    `<td width="${width}" align="center" valign="top" style="background:${tones.bg} !important; border:1px solid ${tones.border}; border-radius:8px; padding:14px 4px; box-shadow:0 2px 6px ${tones.shadow};" bgcolor="${tones.bgcolor}">` +
    `<div style="font-size:18px; font-weight:bold; color:${tones.value} !important;">${esc(value)}</div>` +
    `<div style="font-size:10px; color:${tones.label} !important; margin-top:4px;">${esc(label)}</div>` +
    `<div style="font-size:9px; color:${tones.label} !important; margin-top:2px; line-height:1.25;">${sub || '&nbsp;'}</div></td>`
  );
}

function kpiGap() {
  return '<td width="1.5%"></td>';
}

function kpiRow(summary, usersSub) {
  const total = n(summary.total);
  const pending = n(summary.pending);
  const completed = n(summary.completed);
  const rejected = n(summary.rejected);
  const users = n(summary.total_users);
  return (
    '<tr><td style="padding:10px 32px 4px 32px;" bgcolor="#ffffff">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    kpiCard('18%', total, 'All Requests', '&nbsp;', {
      bg: 'linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%)',
      bgcolor: '#ffffff',
      border: '#dfe8f2',
      shadow: 'rgba(30,80,160,0.06)',
      value: '#1a1a1a',
      label: '#5b7ba3',
    }) +
    kpiGap() +
    kpiCard('18%', pending, 'Pending', '&nbsp;', {
      bg: 'linear-gradient(180deg,#fffaf2 0%,#fef3e2 100%)',
      bgcolor: '#fef3e2',
      border: '#f2e2c4',
      shadow: 'rgba(180,120,20,0.07)',
      value: '#1a1a1a',
      label: '#9a7a3a',
    }) +
    kpiGap() +
    kpiCard('18%', completed, 'Completed', '&nbsp;', {
      bg: 'linear-gradient(180deg,#f4fbf5 0%,#e0f5e8 100%)',
      bgcolor: '#e0f5e8',
      border: '#c7ead4',
      shadow: 'rgba(26,140,92,0.08)',
      value: '#1a1a1a',
      label: '#3f8f63',
    }) +
    kpiGap() +
    kpiCard('18%', rejected, 'Rejected / Cancelled', '&nbsp;', {
      bg: 'linear-gradient(180deg,#fff5f5 0%,#ffe9e9 100%)',
      bgcolor: '#ffe9e9',
      border: '#f3cccc',
      shadow: 'rgba(200,16,46,0.08)',
      value: '#c8102e',
      label: '#a35560',
    }) +
    kpiGap() +
    kpiCard('20%', users, 'Requesters', usersSub || '&nbsp;', {
      bg: 'linear-gradient(180deg,#e0f2fe 0%,#bae6fd 100%)',
      bgcolor: '#e0f2fe',
      border: '#7dd3fc',
      shadow: 'rgba(2,132,199,0.08)',
      value: '#0369a1',
      label: '#0284c7',
    }) +
    '</tr></table></td></tr>'
  );
}

function todayRow(summary) {
  return (
    '<tr><td style="padding:10px 32px 4px 32px;" bgcolor="#ffffff">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    `<td width="48%" align="center" style="background:linear-gradient(180deg,#fffaf2 0%,#fdecd0 100%) !important; border:1px solid #f0d9a8; border-radius:10px; padding:26px 10px; box-shadow:0 3px 10px rgba(180,120,20,0.10);">` +
    `<div style="font-size:30px; font-weight:bold; color:#9a7a3a !important;">${n(summary.opened_today)}</div>` +
    `<div style="font-size:12px; color:#9a7a3a !important; margin-top:6px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Opened Today</div></td>` +
    '<td width="4%"></td>' +
    `<td width="48%" align="center" style="background:linear-gradient(180deg,#f2f6fb 0%,#dfeafa 100%) !important; border:1px solid #bcd6f0; border-radius:10px; padding:26px 10px; box-shadow:0 3px 10px rgba(30,80,160,0.10);">` +
    `<div style="font-size:30px; font-weight:bold; color:#3468a8 !important;">${n(summary.closed_today)}</div>` +
    `<div style="font-size:12px; color:#3468a8 !important; margin-top:6px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Closed Today</div></td>` +
    '</tr></table></td></tr>'
  );
}

function ageingCell(user) {
  const days = n(user.oldest_pending_days);
  const step = String(user.pending_step || '').trim();
  if (n(user.pending_count) <= 0) return '-';
  const age = days === 1 ? '1 day' : `${days} days`;
  return step ? `${age} · ${step}` : age;
}

function userTable(users) {
  const rows = Array.isArray(users) ? users : [];
  const header =
    '<tr><td style="padding:8px 32px 28px 32px;" bgcolor="#ffffff">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:11.5px; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">' +
    '<tr style="background:linear-gradient(90deg,#0369a1 0%,#0ea5e9 100%) !important;" bgcolor="#0369a1">' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;">Requester</td>' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;">Last Signed In</td>' +
    '<td style="padding:10px 6px; color:#ffffff !important; font-weight:bold;" align="center">Total</td>' +
    '<td style="padding:10px 6px; color:#ffffff !important; font-weight:bold;" align="center">Pending</td>' +
    '<td style="padding:10px 6px; color:#ffffff !important; font-weight:bold;" align="center">Completed</td>' +
    '<td style="padding:10px 6px; color:#ffffff !important; font-weight:bold;" align="center">Rejected</td>' +
    '<td style="padding:10px 8px; color:#ffffff !important; font-weight:bold;">Pending ageing</td>' +
    '</tr>';

  if (!rows.length) {
    return (
      header +
      '<tr style="background-color:#ffffff;" bgcolor="#ffffff"><td colspan="7" style="padding:16px 14px; border-bottom:1px solid #ececea; color:#64748b !important; text-align:center;">No requesters with travel requests in this entity snapshot.</td></tr>' +
      '</table></td></tr>'
    );
  }

  const body = rows
    .map((user, idx) => {
      const bg = idx % 2 === 0 ? '#faf9f7' : '#ffffff';
      const pending = n(user.pending_count);
      return (
        `<tr style="background-color:${bg};" bgcolor="${bg}">` +
        `<td style="padding:10px 8px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">${esc(user.user_name || 'Unknown')}</td>` +
        `<td style="padding:10px 8px; border-bottom:1px solid #ececea; color:#1a1a1a !important;">${esc(!user.last_sign_in || user.last_sign_in === 'Never' ? '-' : user.last_sign_in)}</td>` +
        `<td style="padding:10px 6px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">${n(user.total_count)}</td>` +
        `<td style="padding:10px 6px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center"><b>${pending}</b></td>` +
        `<td style="padding:10px 6px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" align="center">${n(user.completed_count)}</td>` +
        `<td style="padding:10px 6px; border-bottom:1px solid #ececea; color:#c8102e !important;" align="center">${n(user.rejected_count)}</td>` +
        `<td style="padding:10px 8px; border-bottom:1px solid #ececea; color:#9a7a3a !important;">${esc(ageingCell(user))}</td>` +
        '</tr>'
      );
    })
    .join('');

  return header + body + '</table></td></tr>';
}

function sectionHeading(title) {
  return (
    '<tr><td style="padding:22px 32px 6px 32px;" bgcolor="#ffffff">' +
    `<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">${esc(title)}</div>` +
    '</td></tr>'
  );
}

function entityBanner(entity) {
  return (
    '<tr><td style="padding:18px 32px 0 32px;" bgcolor="#ffffff">' +
    '<div style="font-size:13.5px; font-weight:bold; color:#0369a1 !important; border-left:4px solid #0ea5e9; padding-left:10px;">' +
    `${esc(entity)} travel usage` +
    '</div>' +
    '<div style="font-size:11px; color:#64748b !important; margin-top:4px; padding-left:14px;">Requester-wise pending, completed, rejected, and pending ageing for this entity only.</div>' +
    '</td></tr>'
  );
}

function buildOverall(overall) {
  if (!overall) return '';
  const usersSub = `${n(overall.signed_in_today)} of ${n(overall.total_users)} today`;
  return (
    sectionHeading('Overall Travel Management Summary') +
    kpiRow(overall, usersSub) +
    sectionHeading("Today's Travel Activity") +
    todayRow(overall)
  );
}

function buildEntitySection(section, { includeToday } = { includeToday: true }) {
  const entity = section.entity || 'Entity';
  const usersSub = `<span style="font-size:11px; font-weight:bold; color:#0369a1 !important;">${n(section.signed_in_today)} of ${n(section.total_users)} today</span>`;
  return (
    entityBanner(entity) +
    sectionHeading(`${entity} request summary`) +
    kpiRow(section, usersSub) +
    (includeToday ? sectionHeading(`${entity} today's activity`) + todayRow(section) : '') +
    `<tr><td style="padding:22px 32px 6px 32px; font-size:13.5px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">${esc(entity)} requesters with pending or recent travel requests</td></tr>` +
    userTable(section.users)
  );
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
        resolve({ sections: [] });
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
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const includeOverall = Boolean(payload.overall) && sections.length > 1;
  const overallHtml = includeOverall ? buildOverall(payload.overall) : '';
  const sectionsHtml = sections
    .map((section) => buildEntitySection(section, { includeToday: !includeOverall }))
    .join('');
  process.stdout.write(
    JSON.stringify({
      OverallSummaryHtml: overallHtml,
      EntitySectionsHtml: sectionsHtml,
    }),
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
