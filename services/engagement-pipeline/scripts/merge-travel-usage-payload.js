#!/usr/bin/env node
'use strict';

const fs = require('fs');

function readJsonFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} file missing: ${filePath || '(unset)'}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) throw new Error(`${label} file is empty: ${filePath}`);
  return JSON.parse(raw);
}

function isKissflowId(name) {
  return typeof name === 'string' && /^[Uu][Ss][A-Za-z0-9_-]{6,}$/.test(name);
}

function visibleRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const name = String(row?.user_name ?? '').trim();
    return name.length > 0 && !isKissflowId(name);
  });
}

function main() {
  const summary = readJsonFile(process.env.TRAVEL_SUMMARY_JSON_FILE, 'summary');
  const users = readJsonFile(process.env.TRAVEL_USERS_JSON_FILE, 'users');
  const pending = readJsonFile(process.env.TRAVEL_PENDING_JSON_FILE, 'pending');
  const sla = readJsonFile(process.env.TRAVEL_SLA_JSON_FILE, 'sla');
  const entity = String(process.env.TRAVEL_ENTITY_NAME || '').trim();
  const today = String(process.env.TRAVEL_TODAY_IST || '').trim();

  const rows = visibleRows(users);
  const pendingRows = visibleRows(pending);
  const slaRows = visibleRows(sla);

  const payload = {
    entity,
    total: Number(summary.total || 0),
    pending: Number(summary.pending || 0),
    completed: Number(summary.completed || 0),
    rejected: Number(summary.rejected || 0),
    opened_today: Number(summary.opened_today || 0),
    closed_today: Number(summary.closed_today || 0),
    has_sla_target: Boolean(summary.has_sla_target),
    sla_breached_open: Number(summary.sla_breached_open || 0),
    sla_breached_closed: Number(summary.sla_breached_closed || 0),
    sla_breached_total: Number(summary.sla_breached_open || 0) + Number(summary.sla_breached_closed || 0),
    by_process: Array.isArray(summary.by_process) ? summary.by_process : [],
    total_users: rows.length,
    users_with_pending: rows.filter((row) => Number(row.pending_count || 0) > 0).length,
    signed_in_today: rows.filter((row) => String(row.last_sign_in || '').startsWith(today)).length,
    users: rows,
    pending_items: pendingRows,
    sla_items: slaRows,
  };

  process.stdout.write(JSON.stringify(payload));
}

main();
