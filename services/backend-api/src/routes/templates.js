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
  getTemplateScheduleUsage,
  formatTemplateInUseMessage,
  listTemplateVersions,
  getTemplateVersion,
} = require('../lib/templateRepository');
const { defaultReportHtml } = require('../lib/defaultReportHtml');
const { syncPublishedTemplateToPipeline, normalizeReportTemplateHtml } = require('../lib/templatePipelineSync');
const { invalidateReportHtmlCache, syncTemplateSubjectToSchedules } = require('../lib/templateCacheInvalidation');
const { listStarters, getStarterHtml } = require('../lib/reportStarters');
const { generateReportHtmlFromPrompt, isAiConfigured } = require('../lib/reportHtmlAi');

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

/** Ready-made HTML layouts (ITSM / PM / Lead / simple) — must be registered before /:templateId */
router.get('/starters', async (req, res) => {
  const applicationId = req.params.applicationId || '';
  const items = listStarters(applicationId);
  return ok(res, req.correlationId, {
    items,
    count: items.length,
    application_id: applicationId || null,
  });
});

router.get('/starters/:starterId', async (req, res) => {
  const applicationId = req.params.applicationId || '';
  const appName = String(req.query.app_name || applicationId || 'Application').trim();
  try {
    const html = getStarterHtml(req.params.starterId, appName);
    const items = listStarters(applicationId);
    const meta = items.find((row) => row.id === req.params.starterId) || null;
    return ok(res, req.correlationId, {
      item: {
        id: req.params.starterId,
        name: meta?.name || req.params.starterId,
        description: meta?.description || '',
        placeholders: meta?.placeholders || [],
        recommended: Boolean(meta?.recommended),
        html,
      },
    });
  } catch (err) {
    if (err.code === 'STARTER_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, 404);
    }
    return fail(res, req.correlationId, 'STARTER_LOAD_FAILED', err.message, 500, true);
  }
});

/** AI: generate / revise email HTML from natural-language comments (draft only — does not save). */
router.post('/generate-html', async (req, res) => {
  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  const applicationId = req.params.applicationId || '';
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }
  if (!applicationId) {
    return fail(res, req.correlationId, 'APPLICATION_ID_REQUIRED', 'applicationId is required', 400);
  }
  if (!isAiConfigured()) {
    return fail(
      res,
      req.correlationId,
      'AI_NOT_CONFIGURED',
      'AI is not configured. Set GEMINI_API_KEY or deploy with GCP_PROJECT + Vertex AI.',
      503,
    );
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const result = await generateReportHtmlFromPrompt({
      environment,
      applicationId,
      prompt: body.prompt,
      currentHtml: body.current_html || body.currentHtml || '',
      includeCurrentHtml: Boolean(body.include_current_html ?? body.includeCurrentHtml),
      templateName: String(body.template_name || body.templateName || '').trim(),
    });
    return ok(res, req.correlationId, {
      html: result.html,
      starter_id: result.starter_id,
      placeholders: result.placeholders,
      provider: result.provider,
      model: result.model,
      location: result.location,
      application_name: result.application_name,
      field_count: result.field_count,
      saved: false,
      note: 'HTML generated in memory only — Save draft in the editor to persist.',
    });
  } catch (err) {
    const status = err.status || (err.code === 'PROMPT_REQUIRED' || err.code === 'PROMPT_TOO_LONG' ? 400 : 502);
    return fail(
      res,
      req.correlationId,
      err.code || 'AI_GENERATE_FAILED',
      err.message,
      status,
      status >= 500,
    );
  }
});

router.get('/:templateId/versions/:versionNumber', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL is required', 503);
  }

  const environment = normalizeEnvironment(req.query.environment);
  const applicationId = req.params.applicationId || null;
  const { templateId, versionNumber } = req.params;
  const versionNum = Number(versionNumber);
  if (!Number.isFinite(versionNum) || versionNum < 1) {
    return fail(res, req.correlationId, 'INVALID_VERSION', 'Version number must be a positive integer', 400);
  }

  try {
    const row = await getTemplateRow(getPool(), { environment, applicationId, templateId });
    if (!row) {
      return fail(res, req.correlationId, 'TEMPLATE_NOT_FOUND', 'Template not found for this application', 404);
    }

    const versionRow = await getTemplateVersion(getPool(), templateId, versionNum);
    if (!versionRow) {
      return fail(res, req.correlationId, 'VERSION_NOT_FOUND', 'Template version not found', 404);
    }

    let html = '';
    try {
      html = resolveTemplateHtml(versionRow.content_ref);
    } catch (err) {
      if (err.code === 'TEMPLATE_CONTENT_NOT_FOUND') {
        return fail(res, req.correlationId, err.code, err.message, 404);
      }
      throw err;
    }

    return ok(res, req.correlationId, {
      item: {
        version_number: versionRow.version_number,
        checksum: versionRow.checksum,
        created_at: versionRow.created_at,
        html,
        variables: extractVariables(html, row.subject || row.name),
      },
      environment,
      application_id: applicationId,
      template_id: templateId,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return fail(res, req.correlationId, 'SCHEMA_NOT_MIGRATED', 'Database schema not migrated', 503);
    }
    return fail(res, req.correlationId, 'TEMPLATE_VERSION_GET_FAILED', err.message, 500, true);
  }
});

router.get('/:templateId/versions', async (req, res) => {
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

    const versions = await listTemplateVersions(getPool(), templateId);
    const items = versions.map((v) => ({
      version_number: v.version_number,
      checksum: v.checksum,
      created_at: v.created_at,
      is_current: v.version_number === row.version_number,
    }));

    return ok(res, req.correlationId, {
      items,
      count: items.length,
      current_version: row.version_number || 0,
      environment,
      application_id: applicationId,
      template_id: templateId,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return fail(res, req.correlationId, 'SCHEMA_NOT_MIGRATED', 'Database schema not migrated', 503);
    }
    return fail(res, req.correlationId, 'TEMPLATE_VERSIONS_LIST_FAILED', err.message, 500, true);
  }
});

router.get('/:templateId/usage', async (req, res) => {
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

    const client = await getPool().connect();
    try {
      const usage = await getTemplateScheduleUsage(client, templateId);
      return ok(res, req.correlationId, {
        template_id: templateId,
        in_use: usage.count > 0,
        schedule_count: usage.count,
        schedules: usage.schedules,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '42P01') {
      return fail(res, req.correlationId, 'SCHEMA_NOT_MIGRATED', 'Database schema not migrated', 503);
    }
    return fail(res, req.correlationId, 'TEMPLATE_USAGE_FAILED', err.message, 500, true);
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
  const starterId = String(body.starter_id || body.starterId || '').trim();
  let rawHtml = String(body.html || '').trim();
  if (!rawHtml && starterId) {
    try {
      rawHtml = getStarterHtml(starterId, name);
    } catch (err) {
      if (err.code === 'STARTER_NOT_FOUND') {
        return fail(res, req.correlationId, err.code, err.message, 400);
      }
      return fail(res, req.correlationId, 'STARTER_LOAD_FAILED', err.message, 500, true);
    }
  }
  if (!rawHtml) {
    rawHtml = defaultReportHtml(name);
  }
  const html = normalizeReportTemplateHtml(rawHtml);
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
      try {
        const cacheClient = await getPool().connect();
        try {
          pipelineSync.cache_invalidation = await invalidateReportHtmlCache(cacheClient, applicationId, {
            templateId,
          });
          pipelineSync.schedule_subject_sync = await syncTemplateSubjectToSchedules(cacheClient, templateId, {
            subject: row.subject,
            templateName: row.name,
          });
        } finally {
          cacheClient.release();
        }
      } catch (cacheErr) {
        pipelineSync = { ...pipelineSync, cache_invalidation: { deleted: 0, error: cacheErr.message } };
      }
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
      const html = normalizeReportTemplateHtml(String(body.html || '').trim());
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
      try {
        const cacheClient = await getPool().connect();
        try {
          pipelineSync.cache_invalidation = await invalidateReportHtmlCache(cacheClient, applicationId, {
            templateId,
          });
          pipelineSync.schedule_subject_sync = await syncTemplateSubjectToSchedules(cacheClient, templateId, {
            subject: row.subject,
            templateName: row.name,
          });
        } finally {
          cacheClient.release();
        }
      } catch (cacheErr) {
        pipelineSync = { ...pipelineSync, cache_invalidation: { deleted: 0, error: cacheErr.message } };
      }
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

    const usage = await getTemplateScheduleUsage(client, templateId);
    if (usage.count > 0) {
      await client.query('ROLLBACK');
      return fail(
        res,
        req.correlationId,
        'TEMPLATE_IN_USE',
        formatTemplateInUseMessage(usage.schedules),
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
