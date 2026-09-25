#!/usr/bin/env node
'use strict';

/**
 * Builds email-safe Operation vs Finance KPI sections for Solar reports.
 * Reads JSON from stdin: { operation: {total,open,closed}, finance: {total,open,closed} }
 * Or flat keys: operation_total, operation_open, ...
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

function kpiCard(value, label, tone) {
  const tones = {
    blue: { bg: 'linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%)', border: '#dfe8f2', label: '#5b7ba3' },
    amber: { bg: 'linear-gradient(180deg,#fffaf2 0%,#fef3e2 100%)', border: '#f2e2c4', label: '#9a7a3a' },
    green: { bg: 'linear-gradient(180deg,#f4fbf5 0%,#e0f5e8 100%)', border: '#c7ead4', label: '#3f8f63' },
    sky: { bg: 'linear-gradient(180deg,#f0f9ff 0%,#e0f2fe 100%)', border: '#bae6fd', label: '#0284c7', value: '#075985' },
    gold: { bg: 'linear-gradient(180deg,#fffbeb 0%,#fef3c7 100%)', border: '#fde68a', label: '#b45309', value: '#92400e' },
  };
  const t = tones[tone] || tones.blue;
  const valueColor = t.value || '#1a1a1a';
  return (
    `<td width="32%" align="center" valign="top" style="background:${t.bg} !important; border:1px solid ${t.border}; border-radius:8px; padding:16px 6px; box-shadow:0 2px 6px rgba(0,0,0,0.05);">` +
    `<div style="font-size:22px; font-weight:bold; color:${valueColor} !important;">${esc(value)}</div>` +
    `<div style="font-size:10px; color:${t.label} !important; margin-top:5px; font-weight:bold; text-transform:uppercase; letter-spacing:0.3px;">${esc(label)}</div>` +
    '</td>'
  );
}

function section(title, subtitle, accent, counts) {
  const headerTone = accent === 'finance' ? '#92400e' : '#075985';
  return (
    `<tr><td style="padding:18px 32px 4px 32px;" bgcolor="#ffffff">` +
    `<div style="font-size:12px; font-weight:bold; color:${headerTone} !important; text-transform:uppercase; letter-spacing:0.5px;">${esc(title)}</div>` +
    `<div style="font-size:11px; color:#8a8a8a !important; margin-top:2px;">${esc(subtitle)}</div>` +
    `</td></tr>` +
    `<tr><td style="padding:8px 32px 4px 32px;" bgcolor="#ffffff">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    kpiCard(counts.total, 'Total', accent === 'finance' ? 'gold' : 'sky') +
    '<td width="2%"></td>' +
    kpiCard(counts.open, 'Open', 'amber') +
    '<td width="2%"></td>' +
    kpiCard(counts.closed, 'Closed', 'green') +
    `</tr></table></td></tr>`
  );
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    raw += c;
  });
  process.stdin.on('end', () => {
    let data = {};
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      data = {};
    }
    const operation = data.operation || {
      total: n(data.operation_total),
      open: n(data.operation_open),
      closed: n(data.operation_closed),
    };
    const finance = data.finance || {
      total: n(data.finance_total),
      open: n(data.finance_open),
      closed: n(data.finance_closed),
    };
    const html =
      '<tr><td style="padding:22px 32px 4px 32px;" bgcolor="#ffffff">' +
      '<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Operation vs Finance</div>' +
      '<div style="font-size:11px; color:#8a8a8a !important; margin-top:3px;">Same split as Solar Expense Hub dashboard — Finance = finance/account/treasury/audit/invoice; everything else = Operation</div>' +
      '</td></tr>' +
      section(
        'Operation',
        'Field / site / technician and all non-finance requests',
        'operation',
        { total: n(operation.total), open: n(operation.open), closed: n(operation.closed) },
      ) +
      section(
        'Finance',
        'Finance · accounts · treasury · audit · invoice related requests',
        'finance',
        { total: n(finance.total), open: n(finance.open), closed: n(finance.closed) },
      );
    process.stdout.write(html);
  });
}

main();
