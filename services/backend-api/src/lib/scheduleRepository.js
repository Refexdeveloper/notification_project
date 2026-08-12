'use strict';

const crypto = require('crypto');
const { resolveAccountId } = require('./templateRepository');

async function createSchedule(client, {
  environment,
  applicationId,
  name,
  templateId,
  templateName,
  processId,
  cronExpression,
  timezone,
  fromEmail,
  recipientsTo,
  recipientsCc,
  subject,
  websiteFilter,
  userGroupFilter,
  entityFilter,
  isActive,
  configExtras,
}) {
  const accountId = await resolveAccountId(client, environment, applicationId);
  const scheduleId = crypto.randomUUID();
  const definitionId = crypto.randomUUID();
  const definitionVersionId = crypto.randomUUID();
  const extras =
    configExtras && typeof configExtras === 'object' && !Array.isArray(configExtras)
      ? configExtras
      : {};

  await client.query(
    `INSERT INTO engagement_reporting.report_definition (report_definition_id, account_id, name, is_active)
     VALUES ($1::uuid, $2, $3, $4)`,
    [definitionId, accountId, name, Boolean(isActive)],
  );

  await client.query(
    `INSERT INTO engagement_reporting.report_definition_version (
       report_definition_version_id, report_definition_id, version_number, config, frozen_at
     ) VALUES ($1::uuid, $2::uuid, 1, $3::jsonb, now())`,
    [
      definitionVersionId,
      definitionId,
      JSON.stringify({
        application_id: applicationId,
        process_id: processId || null,
        template_id: templateId,
        template_name: templateName || name,
        subject: subject || name,
        from_email: fromEmail || null,
        website_filter: websiteFilter || null,
        user_group_filter: userGroupFilter || null,
        entity_filter: entityFilter || null,
        kind: 'schedule',
        ...extras,
      }),
    ],
  );

  await client.query(
    `INSERT INTO engagement_reporting.report_schedule (
       report_schedule_id, report_definition_version_id, cron_expression, timezone, is_active, idempotency_scope
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
    [
      scheduleId,
      definitionVersionId,
      cronExpression,
      timezone || 'Asia/Kolkata',
      Boolean(isActive),
      `manual:${applicationId}:${scheduleId}`,
    ],
  );

  for (const email of recipientsTo || []) {
    await client.query(
      `INSERT INTO engagement_reporting.report_recipient (report_schedule_id, recipient_email, recipient_type)
       VALUES ($1::uuid, $2, 'TO')`,
      [scheduleId, email],
    );
  }
  for (const email of recipientsCc || []) {
    await client.query(
      `INSERT INTO engagement_reporting.report_recipient (report_schedule_id, recipient_email, recipient_type)
       VALUES ($1::uuid, $2, 'CC')`,
      [scheduleId, email],
    );
  }

  return scheduleId;
}

async function deleteSchedule(client, { environment, applicationId, scheduleId }) {
  const { rows } = await client.query(
    `SELECT rs.report_schedule_id, rdv.report_definition_id, rdv.report_definition_version_id
     FROM engagement_reporting.report_schedule rs
     JOIN engagement_reporting.report_definition_version rdv
       ON rdv.report_definition_version_id = rs.report_definition_version_id
     JOIN engagement_reporting.report_definition rd ON rd.report_definition_id = rdv.report_definition_id
     JOIN engagement_reporting.account a ON a.account_id = rd.account_id
     WHERE rs.report_schedule_id = $1::uuid
       AND a.environment = $2
       AND (
         rdv.config->>'application_id' = $3
         OR (
           SELECT tb.config->>'application_id'
           FROM engagement_reporting.report_definition_version tb
           WHERE tb.config->>'template_id' = rdv.config->>'template_id'
             AND tb.config->>'application_id' IS NOT NULL
           ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
           LIMIT 1
         ) = $3
       )`,
    [scheduleId, environment, applicationId],
  );
  if (!rows.length) {
    const err = new Error('Schedule not found for this application');
    err.code = 'SCHEDULE_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  await client.query('DELETE FROM engagement_reporting.report_recipient WHERE report_schedule_id = $1::uuid', [
    scheduleId,
  ]);
  await client.query('DELETE FROM engagement_reporting.report_schedule WHERE report_schedule_id = $1::uuid', [
    scheduleId,
  ]);
  await client.query(
    'DELETE FROM engagement_reporting.report_definition_version WHERE report_definition_version_id = $1::uuid',
    [row.report_definition_version_id],
  );
  await client.query('DELETE FROM engagement_reporting.report_definition WHERE report_definition_id = $1::uuid', [
    row.report_definition_id,
  ]);
}

module.exports = { createSchedule, deleteSchedule };
