#!/usr/bin/env node
'use strict';

/**
 * Builds Travel report template placeholder JSON (avoids shell/jq --arg corruption on HTML).
 * Reads TRAVEL_USAGE_JSON, TRAVEL_HTML_PARTS, TRAVEL_TEMPLATE_META env vars.
 * Writes JSON object to TEMPLATE_VARS_OUT path.
 */

const fs = require('fs');

function readJsonFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} file missing: ${filePath || '(unset)'}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    throw new Error(`${label} file is empty: ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} invalid JSON (${filePath}): ${err.message}`);
  }
}

function readMeta() {
  return {
    reportTitle: process.env.TRAVEL_META_REPORT_TITLE || '',
    reportDate: process.env.TRAVEL_META_REPORT_DATE || '',
    entityScope: process.env.TRAVEL_META_ENTITY_SCOPE || '',
    entityName: process.env.TRAVEL_META_ENTITY_NAME || '',
    reportBody: process.env.TRAVEL_META_REPORT_BODY || '',
  };
}

function str(v) {
  if (v == null) return '';
  return String(v);
}

function main() {
  const outPath = process.env.TEMPLATE_VARS_OUT;
  if (!outPath) {
    console.error('TEMPLATE_VARS_OUT is required');
    process.exit(1);
  }

  const usage = readJsonFile(process.env.TRAVEL_USAGE_JSON_FILE, 'usage');
  const htmlParts = readJsonFile(process.env.TRAVEL_HTML_PARTS_FILE, 'html_parts');
  const meta = readMeta();

  const vars = {
    ReportTitle: str(meta.reportTitle),
    ReportDate: str(meta.reportDate),
    EntityScope: str(meta.entityScope),
    EntityName: str(meta.entityName),
    TotalRequests: str(usage.total ?? 0),
    PendingRequests: str(usage.pending ?? 0),
    CompletedRequests: str(usage.completed ?? 0),
    RejectedRequests: str(usage.rejected ?? 0),
    OpenedToday: str(usage.opened_today ?? 0),
    ClosedToday: str(usage.closed_today ?? 0),
    TotalUsers: str(usage.total_users ?? 0),
    SignedInToday: str(usage.signed_in_today ?? 0),
    UsersWithPending: str(usage.users_with_pending ?? 0),
    SlaBreachedTotal: str(usage.sla_breached_total ?? 0),
    SlaBreachedOpen: str(usage.sla_breached_open ?? 0),
    SlaBreachedClosed: str(usage.sla_breached_closed ?? 0),
    UserTableHtml: str(htmlParts.UserTableHtml),
    UserTableSectionHtml: str(htmlParts.UserTableSectionHtml),
    ProcessSectionsHtml: str(htmlParts.ProcessSectionsHtml),
    PendingDetailsHtml: str(htmlParts.PendingDetailsHtml),
    SlaAnalysisHtml: str(htmlParts.SlaAnalysisHtml),
    OverallSummaryHtml: '',
    EntitySectionsHtml: '',
    ReportBody: str(meta.reportBody),
  };

  fs.writeFileSync(outPath, JSON.stringify(vars), 'utf8');
}

main();
