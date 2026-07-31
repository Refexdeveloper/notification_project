'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const {
  resolveTemplateHtml,
  checksumForContent,
  extractVariables,
  isFileRef,
} = require('../lib/templateContent');
const {
  getTemplateRow,
  createTemplate,
  appendTemplateVersion,
  updateTemplateBinding,
  templateInUse,
} = require('../lib/templateRepository');
const { defaultReportHtml } = require('../lib/defaultReportHtml');
const { syncPublishedTemplateToPipeline } = require('../lib/templatePipelineSync');

const router = express.Router({ mergeParams: true });

function dbNotConfigured(res, correlationId) {
  return ok(res, correlationId, {
    items: [],
    count: 0,
    warning: 'DATABASE_NOT_CONFIGURED',
  });
}

function normalizeEnvironment(value) {
  const lower = String(value || '').toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'development' || lower === 'dev') return 'development';
  return lower || null;
}

function mapTemplateRow(row, { includeHtml = false } = {}) {
  let html = '';
  if (includeHtml && row.content_ref) {
    try {
      html = resolveTemplateHtml(row.content_ref);
    } catch {
      html = '';
    }
  }

  const subject = row.subject || row.name;
  const description = row.description || (isFileRef(row.content_ref) ? row.content_ref : 'Inline HTML template');

  return {
    id: row.id,
    name: row.name,
    application_id: row.application_id || null,
    version_number: row.version_number || 0,
    content_ref: row.content_ref || null,
    subject,
    description,
    html: includeHtml ? html : undefined,
    variables: includeHtml ? extractVariables(html, subject) : undefined,
    status: row.status === 'draft' ? 'draft' : 'published',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }

  const environment = normalizeEnvironment(req.query.environment);
  const applicationId = req.params.applicationId || null;

  try {
    const rows = await getTemplateRow(getPool(), { environment, applicationId });
    const items = rows.map((row) => mapTemplateRow(row));
    return ok(res, req.correlationId, {
      items,
      count: items.length,
      environment,
      application_id: applicationId,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { items: [], count: 0, warning: 'SCHEMA_NOT_MIGRATED' });
    }
    if (err.code === 'DATABASE_NOT_CONFIGURED') {
      return dbNotConfigured(res, req.correlationId);
    }
    return fail(res, req.correlationId, 'TEMPLATES_LIST_FAILED', err.message, 500, true);
  }
});

router.get('/:templateId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const environment = normalizeEnvironment(req.query.environment);
  const applicationId = req.params.applicationId || null;
  const { templateId } = req.params;

  try {
    const row = await getTemplateRow(getPool(), { environment, applicationId, templateId });
    if (!row) {
      return fail(res, req.correlationId, 'TEMPLATE_NOT_FOUND', 'Template not found for this application', 404);
    }

    try {
      return ok(res, req.correlationId, {
        item: mapTemplateRow(row, { includeHtml: true }),
        environment,
        application_id: applicationId,
      });
    } catch (err) {
      if (err.code === 'TEMPLATE_CONTENT_NOT_FOUND') {
        return fail(res, req.correlationId, err.code, err.message, 404);
      }
      throw err;
    }
  } catch (err) {
    if (err.code === '42P01') {
      return fail(res, req.correlationId, 'SCHEMA_NOT_MIGRATED', 'Database schema not migrated', 503);
    }
    return fail(res, req.correlationId, 'TEMPLATE_GET_FAILED', err.message, 500, true);
  }
});

router.post('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  const applicationId = req.params.applicationId;
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = String(body.name || '').trim();
  if (!name) {
    return fail(res, req.correlationId, 'NAME_REQUIRED', 'Template name is required', 400);
  }

  const subject = String(body.subject || `{{ReportTitle}} — ${name}`).trim();
  const description = String(body.description || '').trim();
  const status = body.status === 'published' ? 'published' : 'draft';
  const html = String(body.html || defaultReportHtml(name)).trim();
  const contentRef = html;
  const checksum = checksumForContent(html);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const templateId = await createTemplate(client, {
      environment,
      applicationId,
      name,
      subject,
      description,
      html,
      status,
      contentRef,
      checksum,
    });
    await client.query('COMMIT');

    const row = await getTemplateRow(getPool(), { environment, applicationId, templateId });
    let pipelineSync = null;
    if (status === 'published') {
      pipelineSync = syncPublishedTemplateToPipeline({
        applicationId,
        contentRef: row.content_ref,
        status,
      });
    }
    return ok(
      res,
      req.correlationId,
      { item: mapTemplateRow(row, { includeHtml: true }), environment, application_id: applicationId, pipeline_sync: pipelineSync },
      201,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return fail(res, req.correlationId, 'TEMPLATE_NAME_CONFLICT', 'A template with this name already exists', 409);
    }
    if (err.code === 'ACCOUNT_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, 400);
    }
    return fail(res, req.correlationId, 'TEMPLATE_CREATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.patch('/:templateId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  const applicationId = req.params.applicationId;
  const { templateId } = req.params;
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasSubject = Object.prototype.hasOwnProperty.call(body, 'subject');
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
  const hasHtml = Object.prototype.hasOwnProperty.call(body, 'html');
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');

  if (!hasName && !hasSubject && !hasDescription && !hasHtml && !hasStatus) {
    return fail(
      res,
      req.correlationId,
      'UPDATE_FIELDS_REQUIRED',
      'Provide name, subject, description, html, and/or status',
      400,
    );
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const existing = await getTemplateRow(getPool(), { environment, applicationId, templateId });
    if (!existing) {
      await client.query('ROLLBACK');
      return fail(res, req.correlationId, 'TEMPLATE_NOT_FOUND', 'Template not found for this application', 404);
    }

    if (hasName) {
      const name = String(body.name || '').trim();
      if (!name) {
        await client.query('ROLLBACK');
        return fail(res, req.correlationId, 'NAME_REQUIRED', 'Template name cannot be empty', 400);
      }
      await client.query(
        `UPDATE engagement_reporting.report_template SET name = $2 WHERE report_template_id = $1::uuid`,
        [templateId, name],
      );
    }

    if (hasHtml) {
      const html = String(body.html || '').trim();
      if (!html) {
        await client.query('ROLLBACK');
        return fail(res, req.correlationId, 'HTML_REQUIRED', 'Template HTML cannot be empty', 400);
      }
      await appendTemplateVersion(client, templateId, html, checksumForContent(html));
    }

    const bindingPatch = {};
    if (hasSubject) bindingPatch.subject = String(body.subject || '').trim();
    if (hasDescription) bindingPatch.description = String(body.description || '').trim();
    if (hasStatus) bindingPatch.status = body.status === 'published' ? 'published' : 'draft';
    if (hasName) bindingPatch.template_name = String(body.name || '').trim();

    if (Object.keys(bindingPatch).length) {
      await updateTemplateBinding(client, { templateId, applicationId, patch: bindingPatch });
    }

    await client.query('COMMIT');

    const row = await getTemplateRow(getPool(), { environment, applicationId, templateId });
    let pipelineSync = null;
    const effectiveStatus = hasStatus ? (body.status === 'published' ? 'published' : 'draft') : row.status;
    if (effectiveStatus === 'published') {
      pipelineSync = syncPublishedTemplateToPipeline({
        applicationId,
        contentRef: row.content_ref,
        status: effectiveStatus,
      });
    }
    return ok(res, req.correlationId, {
      item: mapTemplateRow(row, { includeHtml: true }),
      environment,
      application_id: applicationId,
      pipeline_sync: pipelineSync,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return fail(res, req.correlationId, 'TEMPLATE_NAME_CONFLICT', 'A template with this name already exists', 409);
    }
    return fail(res, req.correlationId, 'TEMPLATE_UPDATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.delete('/:templateId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const environment = normalizeEnvironment(req.query.environment);
  const applicationId = req.params.applicationId;
  const { templateId } = req.params;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const existing = await getTemplateRow(getPool(), { environment, applicationId, templateId });
    if (!existing) {
      await client.query('ROLLBACK');
      return fail(res, req.correlationId, 'TEMPLATE_NOT_FOUND', 'Template not found for this application', 404);
    }

    if (await templateInUse(client, templateId)) {
      await client.query('ROLLBACK');
      return fail(
        res,
        req.correlationId,
        'TEMPLATE_IN_USE',
        'Cannot delete a template linked to an active schedule. Pause schedules first.',
        409,
      );
    }

    const binding = await client.query(
      `SELECT DISTINCT rd.report_definition_id
       FROM engagement_reporting.report_definition rd
       JOIN engagement_reporting.report_definition_version rdv
         ON rdv.report_definition_id = rd.report_definition_id
       WHERE rdv.config->>'template_id' = $1
         AND rdv.config->>'kind' = 'template_only'
         AND rdv.config->>'application_id' = $2`,
      [templateId, applicationId],
    );

    for (const row of binding.rows) {
      await client.query(
        `DELETE FROM engagement_reporting.report_definition_version
         WHERE report_definition_id = $1::uuid`,
        [row.report_definition_id],
      );
      await client.query(
        `DELETE FROM engagement_reporting.report_definition
         WHERE report_definition_id = $1::uuid`,
        [row.report_definition_id],
      );
    }

    await client.query(
      `DELETE FROM engagement_reporting.report_template_version
       WHERE report_template_id = $1::uuid`,
      [templateId],
    );

    await client.query(
      `DELETE FROM engagement_reporting.report_template
       WHERE report_template_id = $1::uuid`,
      [templateId],
    );

    await client.query('COMMIT');
    return ok(res, req.correlationId, { deleted: true, template_id: templateId });
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(res, req.correlationId, 'TEMPLATE_DELETE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

module.exports = router;
