#!/usr/bin/env node
'use strict';

/**
 * Solar Operation vs Finance pack counts for scheduled HTML.
 * Same classifier as the Solar Expense Hub dashboard:
 *   services/backend-api/src/lib/dashboardDisplay.js → solarPackCountsFromRecords
 *
 * Reads snapshot items JSON from stdin:
 *   [{ process_status, current_step, source_payload }, ...]
 *   or { items: [...] }
 *
 * Prints { operation: {open,closed,rejected}, finance: {open,closed,rejected} }
 */
const path = require('path');
const { solarPackCountsFromRecords, stringifyKfValue, pickSolarStep } = require(
  path.join(__dirname, '../../backend-api/src/lib/dashboardDisplay.js'),
);

function isSolarDraftItem(item) {
  const payload = item && typeof item.source_payload === 'object' ? item.source_payload : {};
  const parts = [
    item?.process_status,
    item?.current_step,
    item?.status,
    item?.status_raw,
    payload?._status,
    payload?.Status,
    payload?._current_step,
    typeof payload?._current_step === 'object' ? payload._current_step?.Name : '',
  ];
  return parts.some((part) => String(part || '').toLowerCase().includes('draft'));
}

function statusFromItem(item, payload) {
  const statusRaw = stringifyKfValue(payload?._status)
    || stringifyKfValue(payload?.Status)
    || String(item?.process_status || item?.status_raw || '');
  const lower = statusRaw.toLowerCase();
  let status = 'open';
  if (lower.includes('reject') || lower.includes('cancel') || lower.includes('withdraw')) {
    status = 'rejected';
  } else if (
    lower === 'completed'
    || lower === 'closed'
    || lower === 'done'
    || lower === 'approved'
    || lower === 'paid'
    || lower === 'settled'
  ) {
    status = 'closed';
  }
  return { status, status_raw: statusRaw };
}

function recordsFromSnapshotItems(items) {
  const records = [];
  for (const item of items || []) {
    if (!item || isSolarDraftItem(item)) continue;
    const payload = item.source_payload && typeof item.source_payload === 'object'
      ? item.source_payload
      : {};
    const { status, status_raw } = statusFromItem(item, payload);
    records.push({
      current_step: pickSolarStep(payload, item.current_step),
      source_payload: payload,
      status,
      status_raw,
    });
  }
  return records;
}

function parseInput(raw) {
  let data = [];
  try {
    data = JSON.parse(raw || '[]');
  } catch {
    data = [];
  }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.records)) return data.records;
  return [];
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    const packs = solarPackCountsFromRecords(recordsFromSnapshotItems(parseInput(raw)));
    process.stdout.write(JSON.stringify(packs));
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  isSolarDraftItem,
  recordsFromSnapshotItems,
};
