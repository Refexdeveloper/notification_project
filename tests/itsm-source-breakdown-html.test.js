'use strict';

/**
 * Assert SourceBreakdownHtml embeds real channel counts (no forced zeros).
 * Run: node tests/itsm-source-breakdown-html.test.js
 */
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const build = path.join(
  __dirname,
  '..',
  'services/engagement-pipeline/scripts/build-itsm-source-breakdown.js',
);

const html = execFileSync(process.execPath, [build], {
  env: {
    ...process.env,
    SOURCE_EMAIL_ALL: '12',
    SOURCE_WHATSAPP_ALL: '4',
    SOURCE_MOBILE_ALL: '9',
    SOURCE_WEB_ALL: '21',
    SOURCE_OTHER_ALL: '0',
    SOURCE_EMAIL_TODAY: '3',
    SOURCE_WHATSAPP_TODAY: '1',
    SOURCE_MOBILE_TODAY: '2',
    SOURCE_WEB_TODAY: '1',
    SOURCE_OTHER_TODAY: '0',
    TOTAL_TICKETS: '46',
    SOURCE_TODAY_TOTAL: '7',
  },
  encoding: 'utf8',
});

assert.match(html, /Ticket source/);
assert.match(html, /Email<\/td><td[^>]*>12<\/td>/);
assert.match(html, /Mobile<\/td><td[^>]*>9<\/td>/);
assert.match(html, /Web<\/td><td[^>]*>21<\/td>/);
assert.match(html, /Email<\/td><td[^>]*>3<\/td>/);
assert.doesNotMatch(html, /Email<\/td><td[^>]*>0<\/td>[\s\S]*Mobile<\/td><td[^>]*>0<\/td>[\s\S]*Web<\/td><td[^>]*>0<\/td>/);

console.log('PASS: itsm source breakdown HTML counts');
