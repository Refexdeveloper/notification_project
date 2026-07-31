#!/usr/bin/env node
'use strict';

const fs = require('fs');

function normalizeReportTemplateHtml(html) {
  return String(html || '')
    .replace(/refex-logo\.png/gi, 'refexone-logo.png')
    .replace(/alt="Refex"/gi, 'alt="refexOne"');
}

function applyTemplateVariables(templateBody, variables = {}) {
  let body = normalizeReportTemplateHtml(templateBody);
  for (const [key, value] of Object.entries(variables)) {
    const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), String(value ?? ''));
  }
  return body;
}

function main() {
  const htmlIn = process.env.TEMPLATE_HTML_IN;
  const varsIn = process.env.TEMPLATE_VARS_JSON;
  const htmlOut = process.env.TEMPLATE_HTML_OUT;

  if (!htmlIn || !varsIn) {
    console.error('TEMPLATE_HTML_IN and TEMPLATE_VARS_JSON are required');
    process.exit(1);
  }

  const html = fs.readFileSync(htmlIn, 'utf8');
  const vars = JSON.parse(fs.readFileSync(varsIn, 'utf8'));
  const rendered = applyTemplateVariables(html, vars);

  if (htmlOut) {
    fs.writeFileSync(htmlOut, rendered, 'utf8');
  } else {
    process.stdout.write(rendered);
  }
}

main();
