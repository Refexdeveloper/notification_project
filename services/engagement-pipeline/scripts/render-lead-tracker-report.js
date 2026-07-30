#!/usr/bin/env node
'use strict';

/**
 * Render Lead Tracker HTML report (live Kissflow) for one sales group.
 *
 * Env:
 *   GROUP_NAME       — e.g. "Sales Team Modepro"
 *   WEBSITE_FILTER   — e.g. "Modepro"
 *   GROUP_SLUG       — e.g. "modepro" (output file suffix)
 *   REPO_ROOT        — repo root (default: cwd)
 */
const fs = require('fs');
const path = require('path');

const repoRoot = process.env.REPO_ROOT || path.resolve(__dirname, '../../../..');

function loadAdminUiEnv() {
  const envPath = path.join(repoRoot, 'apps/admin-ui/.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    value = value.replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadAdminUiEnv();
const groupName = process.env.GROUP_NAME || 'Sales Team Modepro';
const websiteFilter = process.env.WEBSITE_FILTER || 'Modepro';
const groupSlug = process.env.GROUP_SLUG || 'modepro';

const templatesDir = path.join(repoRoot, 'templates/generated');
const auditDir = path.join(repoRoot, 'data/audit/runbook-17');
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
const outputFile = path.join(templatesDir, `lead-tracker-${groupSlug}-${timestamp}.html`);
const latestFile = path.join(templatesDir, `lead-tracker-${groupSlug}-latest.html`);

const leadServicePath = path.join(repoRoot, 'archive/prototype-mysql-api/services/leadReportService.js');
const { buildLeadTrackerReport } = require(leadServicePath);

async function main() {
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(auditDir, { recursive: true });

  const built = await buildLeadTrackerReport({ groupName, websiteFilter });
  fs.writeFileSync(outputFile, built.html, 'utf8');
  fs.copyFileSync(outputFile, latestFile);

  const audit = {
    action: 'RENDER_LEAD_TRACKER_HTML_REPORT',
    generated_at: new Date().toISOString(),
    group_name: groupName,
    website_filter: websiteFilter,
    group_slug: groupSlug,
    output_file: outputFile,
    latest_file: latestFile,
    subject: built.subject,
    row_count: built.rowCount,
    total_leads: built.totalLeads,
  };
  fs.writeFileSync(path.join(auditDir, `runbook-17-${groupSlug}-${timestamp}.json`), JSON.stringify(audit, null, 2));

  console.log(JSON.stringify({ ok: true, ...audit }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
