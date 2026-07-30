'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function repoRoot() {
  return path.resolve(__dirname, '../../../..');
}

function isInlineHtml(contentRef) {
  if (!contentRef || typeof contentRef !== 'string') return false;
  const trimmed = contentRef.trimStart();
  return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<');
}

function isFileRef(contentRef) {
  if (!contentRef || typeof contentRef !== 'string') return false;
  return !isInlineHtml(contentRef);
}

function resolveTemplateHtml(contentRef) {
  if (!contentRef) return '';
  if (isInlineHtml(contentRef)) return contentRef;

  const root = repoRoot();
  const absolute = path.isAbsolute(contentRef) ? contentRef : path.join(root, contentRef);
  if (!fs.existsSync(absolute)) {
    const err = new Error(`Template content file not found: ${contentRef}`);
    err.code = 'TEMPLATE_CONTENT_NOT_FOUND';
    throw err;
  }
  return fs.readFileSync(absolute, 'utf8');
}

function checksumForContent(content) {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

function extractVariables(html, subject) {
  const text = `${subject || ''}\n${html || ''}`;
  const found = new Set();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let match = re.exec(text);
  while (match) {
    found.add(match[1].trim());
    match = re.exec(text);
  }
  return Array.from(found);
}

module.exports = {
  isInlineHtml,
  isFileRef,
  resolveTemplateHtml,
  checksumForContent,
  extractVariables,
  repoRoot,
};
