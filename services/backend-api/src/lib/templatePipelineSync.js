'use strict';

const fs = require('fs');
const path = require('path');
const { repoRoot, resolveTemplateHtml } = require('./templateContent');

const APPLICATION_SEED_FILES = {
  IT_Service_Management_A00: 'db/seeds/itsm-engagement-template.html',
  Project_Management_Tracker_A00: 'db/seeds/pm-engagement-template.html',
  Lead_Trcaker_A00: 'db/seeds/lead-tracker-report-template.html',
};

function normalizeReportTemplateHtml(html) {
  return String(html || '')
    .replace(/refex-logo\.png/gi, 'refexone-logo.png')
    .replace(/alt="Refex"/gi, 'alt="refexOne"');
}

function syncPublishedTemplateToPipeline({ applicationId, contentRef, status }) {
  if (status !== 'published') {
    return { synced: false, reason: 'not_published' };
  }

  const relPath = APPLICATION_SEED_FILES[applicationId];
  if (!relPath) {
    return { synced: false, reason: 'no_seed_mapping_for_application' };
  }

  let html;
  try {
    html = normalizeReportTemplateHtml(resolveTemplateHtml(contentRef));
  } catch (err) {
    return { synced: false, reason: err.message };
  }

  if (!html || !html.trim()) {
    return { synced: false, reason: 'empty_template_html' };
  }

  const absPath = path.join(repoRoot(), relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, html, 'utf8');

  return {
    synced: true,
    path: relPath,
    bytes: Buffer.byteLength(html, 'utf8'),
  };
}

module.exports = {
  syncPublishedTemplateToPipeline,
  normalizeReportTemplateHtml,
  APPLICATION_SEED_FILES,
};
