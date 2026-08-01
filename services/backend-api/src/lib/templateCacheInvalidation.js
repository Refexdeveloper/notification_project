'use strict';

const CACHE_KEY_PATTERNS = {
  IT_Service_Management_A00: ['itsm:%'],
  Project_Management_Tracker_A00: ['pm:%'],
  Lead_Trcaker_A00: ['lead-tracker:%'],
};

async function invalidateReportHtmlCache(client, applicationId) {
  const patterns = CACHE_KEY_PATTERNS[applicationId] || [];
  let deleted = 0;

  for (const pattern of patterns) {
    const result = await client.query(
      `DELETE FROM engagement_reporting.report_html_cache WHERE cache_key LIKE $1`,
      [pattern],
    );
    deleted += result.rowCount || 0;
  }

  return { deleted, patterns };
}

module.exports = {
  invalidateReportHtmlCache,
  CACHE_KEY_PATTERNS,
};
