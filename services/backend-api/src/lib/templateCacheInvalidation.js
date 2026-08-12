'use strict';

const CACHE_KEY_PATTERNS = {
  IT_Service_Management_A00: ['itsm:%'],
  Project_Management_Tracker_A00: ['pm:%'],
  Solar_Site_Expense_Governance_Syst_A00: ['solar:%'],
  Lead_Trcaker_A00: ['lead-tracker:%'],
};

/**
 * Clear cached rendered HTML so the next send/test re-renders with the published template.
 * Must also clear schedule:* keys — test send used to prefer those and they survived publish.
 */
async function invalidateReportHtmlCache(client, applicationId, { templateId = null } = {}) {
  const patterns = [...(CACHE_KEY_PATTERNS[applicationId] || [])];
  if (applicationId) {
    patterns.push(`${applicationId}:%`);
  }

  let deleted = 0;
  const deletedKeys = [];
  const seen = new Set();

  const track = (rows) => {
    for (const row of rows || []) {
      if (!row.cache_key || seen.has(row.cache_key)) continue;
      seen.add(row.cache_key);
      deletedKeys.push(row.cache_key);
      deleted += 1;
    }
  };

  for (const pattern of patterns) {
    const result = await client.query(
      `DELETE FROM engagement_reporting.report_html_cache
       WHERE cache_key LIKE $1
       RETURNING cache_key`,
      [pattern],
    );
    track(result.rows);
  }

  // Always wipe every cache row tagged to this application (covers schedule:* stored with app id).
  if (applicationId) {
    const appResult = await client.query(
      `DELETE FROM engagement_reporting.report_html_cache
       WHERE application_id = $1
       RETURNING cache_key`,
      [applicationId],
    );
    track(appResult.rows);
  }

  // Clear schedule-scoped caches for schedules that use this template / application.
  if (templateId) {
    const scheduleResult = await client.query(
      `DELETE FROM engagement_reporting.report_html_cache c
       WHERE c.cache_key LIKE 'schedule:%'
         AND EXISTS (
           SELECT 1
           FROM engagement_reporting.report_schedule rs
           JOIN engagement_reporting.report_definition_version rdv
             ON rdv.report_definition_version_id = rs.report_definition_version_id
           WHERE rdv.config->>'template_id' = $1::text
             AND c.cache_key = 'schedule:' || rs.report_schedule_id::text
         )
       RETURNING c.cache_key`,
      [templateId],
    );
    track(scheduleResult.rows);
  } else if (applicationId) {
    const scheduleResult = await client.query(
      `DELETE FROM engagement_reporting.report_html_cache c
       WHERE c.cache_key LIKE 'schedule:%'
         AND EXISTS (
           SELECT 1
           FROM engagement_reporting.report_schedule rs
           JOIN engagement_reporting.report_definition_version rdv
             ON rdv.report_definition_version_id = rs.report_definition_version_id
           WHERE rdv.config->>'application_id' = $1
             AND c.cache_key = 'schedule:' || rs.report_schedule_id::text
         )
       RETURNING c.cache_key`,
      [applicationId],
    );
    track(scheduleResult.rows);
  }

  return { deleted, patterns, deleted_keys: deletedKeys };
}

/**
 * Push published template subject/name onto every schedule that uses this template
 * so email Subject headers match what the user published.
 */
async function syncTemplateSubjectToSchedules(client, templateId, { subject, templateName } = {}) {
  if (!templateId) return { updated: 0 };
  const patch = {};
  if (subject != null && String(subject).trim()) patch.subject = String(subject).trim();
  if (templateName != null && String(templateName).trim()) {
    patch.template_name = String(templateName).trim();
  }
  if (!Object.keys(patch).length) return { updated: 0 };

  const result = await client.query(
    `UPDATE engagement_reporting.report_definition_version rdv
     SET config = COALESCE(rdv.config, '{}'::jsonb) || $2::jsonb
     WHERE rdv.config->>'template_id' = $1::text
       AND COALESCE(rdv.config->>'kind', '') IS DISTINCT FROM 'template_only'
     RETURNING rdv.report_definition_version_id`,
    [templateId, JSON.stringify(patch)],
  );

  return { updated: result.rowCount || 0 };
}

module.exports = {
  invalidateReportHtmlCache,
  syncTemplateSubjectToSchedules,
  CACHE_KEY_PATTERNS,
};
