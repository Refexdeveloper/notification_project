'use strict';

const { createTemplate, getTemplateRow } = require('./templateRepository');
const { createSchedule } = require('./scheduleRepository');
const { getStarterHtml, suggestStarterId, STARTER_CATALOG } = require('./reportStarters');
const { checksumForContent } = require('./templateContent');
const { normalizeReportTemplateHtml } = require('./templatePipelineSync');

const DEFAULT_CRON = '0 9 * * 1-5';
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

async function loadApplicationContext(client, environment, applicationId) {
  const { rows } = await client.query(
    `SELECT
       a.application_id,
       a.application_name,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'process_id', p.process_id,
               'process_name', p.process_name,
               'field_names', COALESCE(
                 (
                   SELECT json_agg(DISTINCT fld->>'name')
                   FROM jsonb_array_elements(
                     COALESCE(p.source_payload->'field_discovery'->'fields', '[]'::jsonb)
                   ) AS fld
                   WHERE COALESCE(fld->>'name', '') <> ''
                 ),
                 '[]'::json
               )
             )
             ORDER BY p.process_name
           )
           FROM engagement_reporting.process p
           WHERE p.environment = a.environment
             AND p.application_id = a.application_id
             AND p.is_current = true
         ),
         '[]'::json
       ) AS processes
     FROM engagement_reporting.application a
     WHERE a.environment = $1
       AND a.application_id = $2
       AND a.is_current = true
     LIMIT 1`,
    [environment, applicationId],
  );
  return rows[0] || null;
}

async function countTemplates(client, environment, applicationId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM engagement_reporting.report_definition_version rdv
     JOIN engagement_reporting.report_definition rd
       ON rd.report_definition_id = rdv.report_definition_id
     JOIN engagement_reporting.account acc ON acc.account_id = rd.account_id
     WHERE acc.environment = $1
       AND rdv.config->>'kind' = 'template_only'
       AND rdv.config->>'application_id' = $2`,
    [environment, applicationId],
  );
  return Number(rows[0]?.count || 0);
}

async function countSchedules(client, environment, applicationId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM engagement_reporting.report_schedule rs
     JOIN engagement_reporting.report_definition_version rdv
       ON rdv.report_definition_version_id = rs.report_definition_version_id
     JOIN engagement_reporting.report_definition rd
       ON rd.report_definition_id = rdv.report_definition_id
     JOIN engagement_reporting.account acc ON acc.account_id = rd.account_id
     WHERE acc.environment = $1
       AND (
         rdv.config->>'application_id' = $2
         OR (
           SELECT tb.config->>'application_id'
           FROM engagement_reporting.report_definition_version tb
           WHERE tb.config->>'template_id' = rdv.config->>'template_id'
             AND tb.config->>'application_id' IS NOT NULL
           ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
           LIMIT 1
         ) = $2
       )`,
    [environment, applicationId],
  );
  return Number(rows[0]?.count || 0);
}

function starterDisplayName(starterId) {
  const item = STARTER_CATALOG.find((row) => row.id === starterId);
  return item?.name || 'Application report';
}

/**
 * After Connect bootstrap: ensure one draft HTML template + one paused schedule.
 * Idempotent — skips create when the app already has templates/schedules.
 */
async function ensureConnectReportArtifacts(client, { environment, applicationId }) {
  const app = await loadApplicationContext(client, environment, applicationId);
  if (!app) {
    return {
      created: false,
      skipped: true,
      reason: 'APPLICATION_NOT_FOUND',
    };
  }

  const processes = Array.isArray(app.processes) ? app.processes : [];
  const processIds = processes.map((p) => p.process_id).filter(Boolean);
  const processNames = processes.map((p) => p.process_name).filter(Boolean);
  const fieldNames = [
    ...new Set(
      processes.flatMap((p) => (Array.isArray(p.field_names) ? p.field_names : [])).filter(Boolean),
    ),
  ];
  const appName = String(app.application_name || applicationId).trim() || applicationId;

  const analysis = {
    application_id: applicationId,
    application_name: appName,
    process_ids: processIds,
    process_names: processNames,
    field_sample: fieldNames.slice(0, 40),
    field_count: fieldNames.length,
  };

  const starterId = suggestStarterId(applicationId, {
    applicationName: appName,
    processIds,
    processNames,
    fieldNames,
  });
  analysis.starter_id = starterId;

  const existingTemplates = await countTemplates(client, environment, applicationId);
  const existingSchedules = await countSchedules(client, environment, applicationId);

  let templateId = null;
  let templateCreated = false;
  let scheduleId = null;
  let scheduleCreated = false;

  if (existingTemplates === 0) {
    const templateName = `${appName} Report`;
    const subject = `{{ReportTitle}} — ${appName}`;
    const description = `Auto-created draft from Connect (${starterDisplayName(starterId)}). Edit and publish when ready.`;
    let rawHtml;
    try {
      rawHtml = getStarterHtml(starterId, appName);
    } catch {
      rawHtml = getStarterHtml('simple', appName);
      analysis.starter_id = 'simple';
      analysis.starter_fallback = true;
    }
    const html = normalizeReportTemplateHtml(rawHtml);
    templateId = await createTemplate(client, {
      environment,
      applicationId,
      name: templateName,
      subject,
      description,
      html,
      status: 'draft',
      contentRef: html,
      checksum: checksumForContent(html),
      configExtras: {
        starter_id: analysis.starter_id,
        auto_created_on_connect: true,
      },
    });
    templateCreated = true;
  } else {
    const rows = await getTemplateRow(client, { environment, applicationId, templateId: null });
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    templateId = list[0]?.id || list[0]?.template_id || null;
  }

  if (existingSchedules === 0 && templateId) {
    const scheduleName = `${appName} Schedule`;
    scheduleId = await createSchedule(client, {
      environment,
      applicationId,
      name: scheduleName,
      templateId,
      templateName: `${appName} Report`,
      processId: processIds[0] || null,
      cronExpression: DEFAULT_CRON,
      timezone: DEFAULT_TIMEZONE,
      fromEmail: null,
      recipientsTo: [],
      recipientsCc: [],
      subject: `{{ReportTitle}} — ${appName}`,
      isActive: false,
      configExtras: {
        auto_created_on_connect: true,
        starter_id: analysis.starter_id,
      },
    });
    scheduleCreated = true;
  }

  return {
    created: templateCreated || scheduleCreated,
    skipped: !templateCreated && !scheduleCreated,
    analysis,
    template: templateId
      ? {
          id: templateId,
          status: 'draft',
          created: templateCreated,
          existing_count: existingTemplates,
        }
      : null,
    schedule: scheduleId
      ? {
          id: scheduleId,
          status: 'paused',
          created: scheduleCreated,
          cron_expression: DEFAULT_CRON,
          timezone: DEFAULT_TIMEZONE,
          existing_count: existingSchedules,
        }
      : existingSchedules > 0
        ? { created: false, existing_count: existingSchedules, status: 'paused' }
        : null,
  };
}

module.exports = {
  ensureConnectReportArtifacts,
};
