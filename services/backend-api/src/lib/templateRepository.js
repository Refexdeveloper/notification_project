'use strict';

const crypto = require('crypto');

const TEMPLATE_ROW_QUERY = `
SELECT DISTINCT ON (rt.report_template_id)
  rt.report_template_id::text AS id,
  rt.name,
  rt.created_at,
  rtv.version_number,
  rtv.content_ref,
  rtv.checksum,
  COALESCE(rtv.created_at, rt.created_at) AS updated_at,
  rdv.config->>'application_id' AS application_id,
  rdv.config->>'subject' AS subject,
  rdv.config->>'description' AS description,
  COALESCE(rdv.config->>'status', CASE WHEN rtv.version_number IS NOT NULL THEN 'published' ELSE 'draft' END) AS status,
  rdv.report_definition_version_id::text AS binding_version_id
FROM engagement_reporting.report_template rt
LEFT JOIN LATERAL (
  SELECT version_number, content_ref, checksum, created_at
  FROM engagement_reporting.report_template_version rtv
  WHERE rtv.report_template_id = rt.report_template_id
  ORDER BY version_number DESC
  LIMIT 1
) rtv ON true
LEFT JOIN LATERAL (
  SELECT rdv.report_definition_version_id, rdv.config
  FROM engagement_reporting.report_definition_version rdv
  WHERE rdv.config->>'template_id' = rt.report_template_id::text
    AND ($3::text IS NULL OR rdv.config->>'application_id' = $3)
  ORDER BY
    CASE WHEN rdv.config->>'kind' = 'template_only' THEN 0 ELSE 1 END,
    rdv.frozen_at DESC NULLS LAST
  LIMIT 1
) rdv ON true
LEFT JOIN engagement_reporting.report_definition rd
  ON rd.report_definition_id = (
    SELECT report_definition_id
    FROM engagement_reporting.report_definition_version
    WHERE report_definition_version_id = rdv.report_definition_version_id
  )
LEFT JOIN engagement_reporting.account a ON a.account_id = rd.account_id
WHERE ($1::text IS NULL OR rt.report_template_id::text = $1)
  AND ($2::text IS NULL OR a.environment = $2 OR rdv.config IS NULL)
  AND ($3::text IS NULL OR rdv.config->>'application_id' = $3)
ORDER BY rt.report_template_id, rt.created_at DESC
`;

async function resolveAccountId(client, environment, applicationId) {
  const appRes = await client.query(
    `SELECT source_payload->>'kissflow_account_id' AS kissflow_account_id
     FROM engagement_reporting.application
     WHERE environment = $1 AND application_id = $2 AND is_current = true
     LIMIT 1`,
    [environment, applicationId],
  );
  const kissflowAccountId = appRes.rows[0]?.kissflow_account_id || null;

  const accountRes = await client.query(
    `SELECT account_id
     FROM engagement_reporting.account
     WHERE environment = $1
       AND ($2::text IS NULL OR kissflow_account_id = $2)
     ORDER BY CASE WHEN kissflow_account_id = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [environment, kissflowAccountId],
  );

  if (!accountRes.rows.length) {
    const err = new Error(`No account row found for environment ${environment}`);
    err.code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }
  return accountRes.rows[0].account_id;
}

async function assertTemplateForApplication(pool, { environment, applicationId, templateId }) {
  const row = await getTemplateRow(pool, { environment, applicationId, templateId });
  if (!row) {
    const err = new Error(`Template ${templateId} is not registered for application ${applicationId}`);
    err.code = 'TEMPLATE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (row.application_id && row.application_id !== applicationId) {
    const err = new Error(
      `Template belongs to application ${row.application_id}, not ${applicationId}. Choose a template for this app only.`,
    );
    err.code = 'TEMPLATE_APPLICATION_MISMATCH';
    err.status = 400;
    throw err;
  }
  return row;
}

async function templateInUse(client, templateId) {
  const usage = await getTemplateScheduleUsage(client, templateId);
  return usage.count > 0;
}

async function getTemplateScheduleUsage(client, templateId) {
  const { rows } = await client.query(
    `SELECT
       rs.report_schedule_id::text AS id,
       rd.name AS name,
       rs.is_active AS is_active
     FROM engagement_reporting.report_schedule rs
     JOIN engagement_reporting.report_definition_version rdv
       ON rdv.report_definition_version_id = rs.report_definition_version_id
     JOIN engagement_reporting.report_definition rd
       ON rd.report_definition_id = rdv.report_definition_id
     WHERE rdv.config->>'template_id' = $1
     ORDER BY rd.name NULLS LAST, rs.created_at DESC`,
    [templateId],
  );
  return {
    count: rows.length,
    schedules: rows.map((row) => ({
      id: row.id,
      name: row.name || 'Unnamed schedule',
      is_active: Boolean(row.is_active),
    })),
  };
}

function formatTemplateInUseMessage(schedules) {
  if (!schedules?.length) {
    return 'This template is linked to a schedule and cannot be deleted.';
  }
  const names = schedules.map((s) => s.name).join(', ');
  const suffix = schedules.length === 1 ? 'schedule' : 'schedules';
  return `This template is already in use by ${schedules.length} ${suffix}: ${names}. Pause or delete those schedulers first, or assign a different template.`;
}

async function getTemplateRow(pool, { environment, applicationId, templateId }) {
  const { rows } = await pool.query(TEMPLATE_ROW_QUERY, [templateId || null, environment, applicationId || null]);
  if (templateId) return rows[0] || null;
  return rows;
}

async function createTemplate(client, {
  environment,
  applicationId,
  name,
  subject,
  description,
  html,
  status,
  contentRef,
  checksum,
}) {
  const templateId = crypto.randomUUID();
  const bindingDefId = crypto.randomUUID();
  const bindingVersionId = crypto.randomUUID();
  const accountId = await resolveAccountId(client, environment, applicationId);

  await client.query(
    `INSERT INTO engagement_reporting.report_template (report_template_id, name)
     VALUES ($1::uuid, $2)`,
    [templateId, name],
  );

  await client.query(
    `INSERT INTO engagement_reporting.report_template_version (
       report_template_id, version_number, content_ref, checksum
     ) VALUES ($1::uuid, 1, $2, $3)`,
    [templateId, contentRef, checksum],
  );

  await client.query(
    `INSERT INTO engagement_reporting.report_definition (report_definition_id, account_id, name, is_active)
     VALUES ($1::uuid, $2, $3, false)`,
    [bindingDefId, accountId, name],
  );

  await client.query(
    `INSERT INTO engagement_reporting.report_definition_version (
       report_definition_version_id, report_definition_id, version_number, config, frozen_at
     ) VALUES ($1::uuid, $2::uuid, 1, $3::jsonb, now())`,
    [
      bindingVersionId,
      bindingDefId,
      JSON.stringify({
        kind: 'template_only',
        application_id: applicationId,
        template_id: templateId,
        template_name: name,
        subject: subject || name,
        description: description || '',
        status: status || 'draft',
      }),
    ],
  );

  return templateId;
}

async function appendTemplateVersion(client, templateId, contentRef, checksum) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(version_number), 0) AS max_version
     FROM engagement_reporting.report_template_version
     WHERE report_template_id = $1::uuid`,
    [templateId],
  );
  const nextVersion = Number(rows[0].max_version) + 1;
  await client.query(
    `INSERT INTO engagement_reporting.report_template_version (
       report_template_id, version_number, content_ref, checksum
     ) VALUES ($1::uuid, $2, $3, $4)`,
    [templateId, nextVersion, contentRef, checksum],
  );
  return nextVersion;
}

async function listTemplateVersions(pool, templateId) {
  const { rows } = await pool.query(
    `SELECT version_number, checksum, created_at, content_ref
     FROM engagement_reporting.report_template_version
     WHERE report_template_id = $1::uuid
     ORDER BY version_number DESC`,
    [templateId],
  );
  return rows;
}

async function getTemplateVersion(pool, templateId, versionNumber) {
  const { rows } = await pool.query(
    `SELECT version_number, checksum, created_at, content_ref
     FROM engagement_reporting.report_template_version
     WHERE report_template_id = $1::uuid AND version_number = $2`,
    [templateId, versionNumber],
  );
  return rows[0] || null;
}

async function updateTemplateBinding(client, { templateId, applicationId, patch }) {
  const configPatch = {};
  if (patch.subject !== undefined) configPatch.subject = patch.subject;
  if (patch.description !== undefined) configPatch.description = patch.description;
  if (patch.status !== undefined) configPatch.status = patch.status;
  if (patch.template_name !== undefined) configPatch.template_name = patch.template_name;
  if (!Object.keys(configPatch).length) return;

  const { rows } = await client.query(
    `SELECT rdv.report_definition_version_id
     FROM engagement_reporting.report_definition_version rdv
     WHERE rdv.config->>'template_id' = $1
       AND rdv.config->>'application_id' = $2
       AND rdv.config->>'kind' = 'template_only'
     LIMIT 1`,
    [templateId, applicationId],
  );

  let versionId = rows[0]?.report_definition_version_id;
  if (!versionId) {
    const seeded = await client.query(
      `SELECT report_definition_version_id
       FROM engagement_reporting.report_definition_version
       WHERE config->>'template_id' = $1 AND config->>'application_id' = $2
       ORDER BY frozen_at DESC NULLS LAST
       LIMIT 1`,
      [templateId, applicationId],
    );
    versionId = seeded.rows[0]?.report_definition_version_id;
  }
  if (!versionId) return;

  await client.query(
    `UPDATE engagement_reporting.report_definition_version
     SET config = COALESCE(config, '{}'::jsonb) || $2::jsonb
     WHERE report_definition_version_id = $1::uuid`,
    [versionId, JSON.stringify(configPatch)],
  );
}

module.exports = {
  TEMPLATE_ROW_QUERY,
  getTemplateRow,
  createTemplate,
  appendTemplateVersion,
  listTemplateVersions,
  getTemplateVersion,
  updateTemplateBinding,
  templateInUse,
  getTemplateScheduleUsage,
  formatTemplateInUseMessage,
  assertTemplateForApplication,
  resolveAccountId,
};
