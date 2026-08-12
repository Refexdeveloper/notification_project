#!/usr/bin/env node
'use strict';

/**
 * Builds email-safe Ticket source panels for ITSM reports (Refex + Extrovis).
 * Mirrors apps/admin-ui/src/lib/templatePreview.ts sampleItsmSourceBreakdownHtml.
 * Reads counts from env (or argv JSON) so shell/jq never JSON-escape style attributes.
 */

function n(v, fallback = '0') {
  const s = String(v ?? fallback).trim();
  return s === '' || Number.isNaN(Number(s)) ? fallback : String(parseInt(s, 10));
}

function row(label, count, tone, bg) {
  return (
    `<tr style="background-color:${bg};" bgcolor="${bg}">` +
    `<td style="padding:9px 12px; border-bottom:1px solid #ececea; font-size:12px; color:#334155 !important;">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tone};margin-right:8px;"></span>` +
    `${label}</td>` +
    `<td style="padding:9px 12px; border-bottom:1px solid #ececea; font-size:13px; font-weight:bold; color:#1a1a1a !important;" align="right">${count}</td>` +
    `</tr>`
  );
}

function panel(title, subtitle, total, headerBg, headerColor, counts) {
  return (
    `<td width="48%" valign="top" style="border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; background:#ffffff !important;" bgcolor="#ffffff">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
    `<tr><td style="padding:12px 14px; background:${headerBg} !important;" bgcolor="${headerBg}">` +
    `<div style="font-size:11px; font-weight:bold; color:${headerColor} !important; text-transform:uppercase; letter-spacing:0.4px;">${title}</div>` +
    `<div style="font-size:11px; color:#64748b !important; margin-top:3px;">${subtitle} · <b style="color:#1a1a1a !important;">${total}</b></div>` +
    `</td></tr>` +
    row('Email', counts[0], '#3b82f6', '#ffffff') +
    row('WhatsApp', counts[1], '#22c55e', '#f8fafc') +
    row('Mobile', counts[2], '#f59e0b', '#ffffff') +
    row('Web', counts[3], '#8b5cf6', '#f8fafc') +
    `</table></td>`
  );
}

function build(counts) {
  const emailAll = n(counts.email_all);
  const whatsappAll = n(counts.whatsapp_all);
  const mobileAll = n(counts.mobile_all);
  const webAll = n(counts.web_all);
  const otherAll = n(counts.other_all);
  const emailToday = n(counts.email_today);
  const whatsappToday = n(counts.whatsapp_today);
  const mobileToday = n(counts.mobile_today);
  const webToday = n(counts.web_today);
  const otherToday = n(counts.other_today);
  const totalAll = n(counts.total_all);
  const totalToday = n(counts.total_today);

  let html =
    '<tr><td style="padding:14px 32px 4px 32px;" bgcolor="#ffffff">' +
    '<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Ticket source</div>' +
    '<div style="font-size:11px; color:#8a8a8a !important; margin-top:3px;">How tickets arrived — All tickets vs Today open tickets</div>' +
    '</td></tr>' +
    '<tr><td style="padding:10px 32px 2px 32px;" bgcolor="#ffffff">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    panel('All tickets', 'By source', totalAll, '#f1f5f9', '#475569', [
      emailAll,
      whatsappAll,
      mobileAll,
      webAll,
    ]) +
    '<td width="4%"></td>' +
    panel('Today open tickets', 'Opened today by source', totalToday, '#fff7ed', '#9a7a3a', [
      emailToday,
      whatsappToday,
      mobileToday,
      webToday,
    ]) +
    '</tr></table></td></tr>';

  if (Number(otherAll) > 0 || Number(otherToday) > 0) {
    html +=
      `<tr><td style="padding:6px 32px 0 32px; font-size:11px; color:#8a8a8a !important;" bgcolor="#ffffff">` +
      `Other / unmapped: <b>${otherAll}</b> all · <b>${otherToday}</b> today</td></tr>`;
  }
  return html;
}

function main() {
  const fromEnv = {
    email_all: process.env.SOURCE_EMAIL_ALL,
    whatsapp_all: process.env.SOURCE_WHATSAPP_ALL,
    mobile_all: process.env.SOURCE_MOBILE_ALL,
    web_all: process.env.SOURCE_WEB_ALL,
    other_all: process.env.SOURCE_OTHER_ALL,
    email_today: process.env.SOURCE_EMAIL_TODAY,
    whatsapp_today: process.env.SOURCE_WHATSAPP_TODAY,
    mobile_today: process.env.SOURCE_MOBILE_TODAY,
    web_today: process.env.SOURCE_WEB_TODAY,
    other_today: process.env.SOURCE_OTHER_TODAY,
    total_all: process.env.TOTAL_TICKETS || process.env.SOURCE_TOTAL_ALL,
    total_today: process.env.SOURCE_TODAY_TOTAL,
  };
  process.stdout.write(build(fromEnv));
}

main();
