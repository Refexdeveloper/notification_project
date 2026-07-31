'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');
const { resolveSession } = require('../lib/session');
const { createSchedule, deleteSchedule } = require('../lib/scheduleRepository');
const { assertTemplateForApplication } = require('../lib/templateRepository');
const { dispatchScheduleRunnerAsync } = require('../lib/scheduleRunnerClient');
const { syncScheduleCloudJob } = require('../lib/cloudSchedulerSync');
const { validateScheduleFromEmail } = require('../lib/smtpFromValidation');

const router = express.Router({ mergeParams: true });

function isValidCronExpression(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  return parts.length >= 5;
}

function normalizeTimezone(tz) {
  const value = String(tz || 'Asia/Kolkata').trim();
  return value || 'Asia/Kolkata';
}

const SCHEDULES_QUERY = `
SELECT
  rs.report_schedule_id::text AS id,
  rs.cron_expression,
  rs.timezone,
  rs.is_active,
  rs.created_at,
  rd.name AS definition_name,
  rdv.config->>'application_id' AS application_id,
  rdv.config->>'process_id' AS process_id,
  rdv.config->>'template_id' AS template_id,
  rdv.config->>'template_name' AS template_name,
  rdv.config->>'subject' AS subject,
  rdv.config->>'from_email' AS from_email,
  rdv.config->>'legacy_scheduler_id' AS legacy_scheduler_id,
  rdv.config->>'website_filter' AS website_filter,
  rdv.config->>'user_group_filter' AS user_group_filter,
  rdv.report_definition_version_id::text AS report_definition_version_id,
  COALESCE(
    json_agg(
      DISTINCT jsonb_build_object(
        'email', rr.recipient_email,
        'type', rr.recipient_type
      )
    ) FILTER (WHERE rr.recipient_email IS NOT NULL),
    '[]'::json
  ) AS recipients
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition_version rdv
  ON rdv.report_definition_version_id = rs.report_definition_version_id
JOIN engagement_reporting.report_definition rd
  ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a
  ON a.account_id = rd.account_id
LEFT JOIN engagement_reporting.report_recipient rr
  ON rr.report_schedule_id = rs.report_schedule_id
WHERE a.environment = $1
  AND (
    $2::text IS NULL
    OR rdv.config->>'application_id' = $2
    OR (
      SELECT tb.config->>'application_id'
      FROM engagement_reporting.report_definition_version tb
      WHERE tb.config->>'template_id' = rdv.config->>'template_id'
        AND tb.config->>'application_id' IS NOT NULL
      ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
      LIMIT 1
    ) = $2
  )
GROUP BY
  rs.report_schedule_id,
  rs.cron_expression,
  rs.timezone,
  rs.is_active,
  rs.created_at,
  rd.name,
  rdv.config,
  rdv.report_definition_version_id
ORDER BY rs.created_at DESC
`;

const SCHEDULE_BY_ID_QUERY = `
SELECT
  rs.report_schedule_id::text AS id,
  rs.cron_expression,
  rs.timezone,
  rs.is_active,
  rs.created_at,
  rd.name AS definition_name,
  rdv.config->>'application_id' AS application_id,
  rdv.config->>'process_id' AS process_id,
  rdv.config->>'template_id' AS template_id,
  rdv.config->>'template_name' AS template_name,
  rdv.config->>'subject' AS subject,
  rdv.config->>'from_email' AS from_email,
  rdv.config->>'legacy_scheduler_id' AS legacy_scheduler_id,
  rdv.config->>'website_filter' AS website_filter,
  rdv.config->>'user_group_filter' AS user_group_filter,
  rdv.report_definition_version_id::text AS report_definition_version_id,
  COALESCE(
    json_agg(
      DISTINCT jsonb_build_object(
        'email', rr.recipient_email,
        'type', rr.recipient_type
      )
    ) FILTER (WHERE rr.recipient_email IS NOT NULL),
    '[]'::json
  ) AS recipients
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition_version rdv
  ON rdv.report_definition_version_id = rs.report_definition_version_id
JOIN engagement_reporting.report_definition rd
  ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a
  ON a.account_id = rd.account_id
LEFT JOIN engagement_reporting.report_recipient rr
  ON rr.report_schedule_id = rs.report_schedule_id
WHERE a.environment = $1
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
  )
  AND rs.report_schedule_id = $3::uuid
GROUP BY
  rs.report_schedule_id,
  rs.cron_expression,
  rs.timezone,
  rs.is_active,
  rs.created_at,
  rd.name,
  rdv.config,
  rdv.report_definition_version_id
`;

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
  return lower;
}

function normalizeEmailList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const email = String(raw || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function normalizeSingleEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (!email || !email.includes('@')) return '';
  return email;
}

function mapScheduleRow(row) {
  const recipients = Array.isArray(row.recipients) ? row.recipients : [];
  const toEmails = recipients.filter((r) => r.type === 'TO').map((r) => String(r.email));
  const ccEmails = recipients.filter((r) => r.type === 'CC').map((r) => String(r.email));
  return {
    id: row.id,
    name: row.definition_name,
    application_id: row.application_id || null,
    process_id: row.process_id || null,
    template_id: row.template_id || null,
    template_name: row.template_name || null,
    subject: row.subject || null,
    from_email: row.from_email || null,
    website_filter: row.website_filter || null,
    user_group_filter: row.user_group_filter || null,
    cron_expression: row.cron_expression,
    timezone: row.timezone,
    is_active: row.is_active,
    status: row.is_active ? 'active' : 'paused',
    recipients: toEmails,
    cc: ccEmails,
    created_at: row.created_at,
  };
}

router.get('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }

  const environment = normalizeEnvironment(req.query.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const applicationId = req.params.applicationId;

  try {
    const { rows } = await getPool().query(SCHEDULES_QUERY, [environment, applicationId]);
    const items = rows.map(mapScheduleRow);

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
    return fail(res, req.correlationId, 'SCHEDULES_LIST_FAILED', err.message, 500, true);
  }
});

router.post('/', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const applicationId = req.params.applicationId;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = String(body.name || '').trim();
  const templateId = String(body.template_id || '').trim();
  const cronExpression = String(body.cron_expression || '0 9 * * *').trim();
  const timezone = String(body.timezone || 'Asia/Kolkata').trim();
  const fromEmail = normalizeSingleEmail(body.from_email);
  const recipientsTo = normalizeEmailList(body.recipients_to || body.recipients);
  const recipientsCc = normalizeEmailList(body.recipients_cc || body.cc);
  const isActive = Boolean(body.is_active);

  if (!name) {
    return fail(res, req.correlationId, 'NAME_REQUIRED', 'Schedule name is required', 400);
  }
  if (!templateId) {
    return fail(res, req.correlationId, 'TEMPLATE_ID_REQUIRED', 'template_id is required', 400);
  }
  if (isActive && recipientsTo.length === 0) {
    return fail(res, req.correlationId, 'RECIPIENTS_REQUIRED', 'Add at least one To recipient before activating', 400);
  }
  if (isActive && !fromEmail) {
    return fail(res, req.correlationId, 'FROM_EMAIL_REQUIRED', 'from_email is required when schedule is active', 400);
  }
  if (isActive) {
    const fromAuth = validateScheduleFromEmail(fromEmail);
    if (fromAuth.authorized === false) {
      return fail(res, req.correlationId, 'FROM_EMAIL_NOT_AUTHORIZED', fromAuth.message, 400);
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await assertTemplateForApplication(getPool(), { environment, applicationId, templateId });
    const scheduleId = await createSchedule(client, {
      environment,
      applicationId,
      name,
      templateId,
      templateName: String(body.template_name || name).trim(),
      processId: body.process_id || null,
      cronExpression,
      timezone,
      fromEmail,
      recipientsTo,
      recipientsCc,
      subject: body.subject || name,
      websiteFilter: body.website_filter || null,
      userGroupFilter: body.user_group_filter || null,
      isActive,
    });
    await client.query('COMMIT');

    const { rows } = await getPool().query(SCHEDULE_BY_ID_QUERY, [environment, applicationId, scheduleId]);
    let cloudScheduler = null;
    if (isActive) {
      try {
        cloudScheduler = await syncScheduleCloudJob(rows[0]);
      } catch (syncErr) {
        cloudScheduler = { ok: false, error: syncErr.message };
      }
    }
    return ok(
      res,
      req.correlationId,
      {
        item: mapScheduleRow(rows[0]),
        cloud_scheduler: cloudScheduler,
        from_email_auth: validateScheduleFromEmail(fromEmail),
      },
      201,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'TEMPLATE_NOT_FOUND' || err.code === 'TEMPLATE_APPLICATION_MISMATCH') {
      return fail(res, req.correlationId, err.code, err.message, err.status || 400);
    }
    if (err.code === 'SCHEDULE_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, err.status || 404);
    }
    return fail(res, req.correlationId, 'SCHEDULE_CREATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.post('/:scheduleId/test-send', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const applicationId = req.params.applicationId;
  const scheduleId = req.params.scheduleId;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const testRecipient = normalizeSingleEmail(body.test_recipient || body.testRecipient);

  if (!testRecipient) {
    return fail(
      res,
      req.correlationId,
      'TEST_RECIPIENT_REQUIRED',
      'Provide test_recipient (email) in the request body',
      400,
    );
  }

  try {
    const { rows } = await getPool().query(SCHEDULE_BY_ID_QUERY, [environment, applicationId, scheduleId]);
    if (!rows.length) {
      return fail(res, req.correlationId, 'SCHEDULE_NOT_FOUND', 'Schedule not found for this application', 404);
    }

    const row = rows[0];
    if (row.template_id) {
      await assertTemplateForApplication(getPool(), {
        environment,
        applicationId,
        templateId: row.template_id,
      });
    }
    if (row.application_id && row.application_id !== applicationId) {
      await getPool().query(
        `UPDATE engagement_reporting.report_definition_version
         SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('application_id', $2::text)
         WHERE report_definition_version_id = $1::uuid`,
        [row.report_definition_version_id, applicationId],
      );
    }

    const effectiveFrom = row.from_email || '';
    if (!effectiveFrom) {
      return fail(
        res,
        req.correlationId,
        'FROM_EMAIL_REQUIRED',
        'Save a From email on this schedule before sending a test (Save schedule first).',
        400,
      );
    }

    dispatchScheduleRunnerAsync(scheduleId, { testRecipient });

    return ok(res, req.correlationId, {
      schedule_id: scheduleId,
      application_id: applicationId,
      template_name: row.template_name,
      test_recipient: testRecipient,
      dispatched: true,
      status: 'started',
      message:
        'Test send started (last cached report → email only, no Kissflow refresh). Usually arrives within 1–2 minutes — check inbox and spam.',
    });
  } catch (err) {
    if (err.code === 'SCHEDULE_RUNNER_NOT_CONFIGURED') {
      return fail(res, req.correlationId, err.code, err.message, err.status || 503);
    }
    if (err.code === 'SCHEDULE_RUNNER_AUTH_FAILED') {
      return fail(res, req.correlationId, err.code, err.message, 502);
    }
    return fail(res, req.correlationId, 'SCHEDULE_TEST_SEND_FAILED', err.message, err.status || 500, true);
  }
});

router.delete('/:scheduleId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return fail(res, req.correlationId, 'DATABASE_NOT_CONFIGURED', 'PostgreSQL required', 503);
  }

  const session = resolveSession(req);
  if (!session) {
    return fail(res, req.correlationId, 'UNAUTHENTICATED', 'No session context', 401);
  }

  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const applicationId = req.params.applicationId;
  const scheduleId = req.params.scheduleId;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await deleteSchedule(client, { environment, applicationId, scheduleId });
    await client.query('COMMIT');
    return ok(res, req.correlationId, { deleted: true, id: scheduleId });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'SCHEDULE_NOT_FOUND') {
      return fail(res, req.correlationId, err.code, err.message, err.status || 404);
    }
    return fail(res, req.correlationId, 'SCHEDULE_DELETE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

router.patch('/:scheduleId', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return dbNotConfigured(res, req.correlationId);
  }

  const environment = normalizeEnvironment(req.query.environment || req.body?.environment);
  if (!environment) {
    return fail(res, req.correlationId, 'ENVIRONMENT_REQUIRED', 'Query parameter environment is required', 400);
  }

  const applicationId = req.params.applicationId;
  const scheduleId = req.params.scheduleId;
  if (!scheduleId) {
    return fail(res, req.correlationId, 'SCHEDULE_ID_REQUIRED', 'Schedule id is required', 400);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const hasRecipientsTo = Object.prototype.hasOwnProperty.call(body, 'recipients_to');
  const hasRecipientsCc = Object.prototype.hasOwnProperty.call(body, 'recipients_cc');
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, 'is_active');
  const hasFromEmail = Object.prototype.hasOwnProperty.call(body, 'from_email');
  const hasCronExpression = Object.prototype.hasOwnProperty.call(body, 'cron_expression');
  const hasTimezone = Object.prototype.hasOwnProperty.call(body, 'timezone');
  const hasTemplateId = Object.prototype.hasOwnProperty.call(body, 'template_id');
  const hasTemplateName = Object.prototype.hasOwnProperty.call(body, 'template_name');
  const hasProcessId = Object.prototype.hasOwnProperty.call(body, 'process_id');
  const hasWebsiteFilter = Object.prototype.hasOwnProperty.call(body, 'website_filter');
  const hasUserGroupFilter = Object.prototype.hasOwnProperty.call(body, 'user_group_filter');
  const hasSubject = Object.prototype.hasOwnProperty.call(body, 'subject');

  if (
    !hasRecipientsTo &&
    !hasRecipientsCc &&
    !hasIsActive &&
    !hasFromEmail &&
    !hasCronExpression &&
    !hasTimezone &&
    !hasTemplateId &&
    !hasTemplateName &&
    !hasProcessId &&
    !hasWebsiteFilter &&
    !hasUserGroupFilter &&
    !hasSubject
  ) {
    return fail(
      res,
      req.correlationId,
      'UPDATE_FIELDS_REQUIRED',
      'Provide from_email, recipients, cron/timezone, template_id, process_id, filters, subject, and/or is_active',
      400,
    );
  }

  const recipientsTo = hasRecipientsTo ? normalizeEmailList(body.recipients_to) : null;
  const recipientsCc = hasRecipientsCc ? normalizeEmailList(body.recipients_cc) : null;
  const isActive = hasIsActive ? Boolean(body.is_active) : null;
  const fromEmail = hasFromEmail ? normalizeSingleEmail(body.from_email) : null;
  const cronExpression = hasCronExpression ? String(body.cron_expression || '').trim() : null;
  const timezone = hasTimezone ? normalizeTimezone(body.timezone) : null;

  if (hasCronExpression && !isValidCronExpression(cronExpression)) {
    return fail(
      res,
      req.correlationId,
      'CRON_INVALID',
      'cron_expression must include minute, hour, day-of-month, month, and day-of-week',
      400,
    );
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const owned = await client.query(SCHEDULE_BY_ID_QUERY, [environment, applicationId, scheduleId]);
    if (!owned.rows.length) {
      await client.query('ROLLBACK');
      return fail(res, req.correlationId, 'SCHEDULE_NOT_FOUND', 'Schedule not found for this application', 404);
    }

    const ownedRow = owned.rows[0];
    const definitionVersionId = ownedRow.report_definition_version_id;
    let effectiveFromEmail = ownedRow.from_email || '';

    if (hasFromEmail) {
      if (hasFromEmail && body.from_email && !fromEmail) {
        await client.query('ROLLBACK');
        return fail(res, req.correlationId, 'FROM_EMAIL_INVALID', 'from_email must be a valid email address', 400);
      }
      effectiveFromEmail = fromEmail;
      if (fromEmail) {
        await client.query(
          `UPDATE engagement_reporting.report_definition_version
           SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('from_email', $2::text)
           WHERE report_definition_version_id = $1::uuid`,
          [definitionVersionId, fromEmail],
        );
      } else {
        await client.query(
          `UPDATE engagement_reporting.report_definition_version
           SET config = COALESCE(config, '{}'::jsonb) - 'from_email'
           WHERE report_definition_version_id = $1::uuid`,
          [definitionVersionId],
        );
      }
    }

    if (hasRecipientsTo || hasRecipientsCc) {
      const currentRecipients = Array.isArray(ownedRow.recipients) ? ownedRow.recipients : [];
      const nextTo = hasRecipientsTo
        ? recipientsTo
        : currentRecipients.filter((r) => r.type === 'TO').map((r) => String(r.email));
      const nextCc = hasRecipientsCc
        ? recipientsCc
        : currentRecipients.filter((r) => r.type === 'CC').map((r) => String(r.email));

      const activating = hasIsActive ? isActive : ownedRow.is_active;
      if (activating && nextTo.length === 0) {
        await client.query('ROLLBACK');
        return fail(
          res,
          req.correlationId,
          'RECIPIENTS_REQUIRED',
          'Add at least one To recipient before activating the schedule',
          400,
        );
      }

      await client.query(
        'DELETE FROM engagement_reporting.report_recipient WHERE report_schedule_id = $1::uuid',
        [scheduleId],
      );

      for (const email of nextTo) {
        await client.query(
          `INSERT INTO engagement_reporting.report_recipient
             (report_schedule_id, recipient_email, recipient_type)
           VALUES ($1::uuid, $2, 'TO')`,
          [scheduleId, email],
        );
      }
      for (const email of nextCc) {
        await client.query(
          `INSERT INTO engagement_reporting.report_recipient
             (report_schedule_id, recipient_email, recipient_type)
           VALUES ($1::uuid, $2, 'CC')`,
          [scheduleId, email],
        );
      }
    } else if (isActive === true) {
      const currentRecipients = Array.isArray(ownedRow.recipients) ? ownedRow.recipients : [];
      const toCount = currentRecipients.filter((r) => r.type === 'TO').length;
      if (toCount === 0) {
        await client.query('ROLLBACK');
        return fail(
          res,
          req.correlationId,
          'RECIPIENTS_REQUIRED',
          'Add at least one To recipient before activating the schedule',
          400,
        );
      }
    }

    const activatingFinal = hasIsActive ? isActive : ownedRow.is_active;
    if (activatingFinal) {
      if (!effectiveFromEmail) {
        await client.query('ROLLBACK');
        return fail(
          res,
          req.correlationId,
          'FROM_EMAIL_REQUIRED',
          'Set from_email before activating the schedule',
          400,
        );
      }
      const fromAuth = validateScheduleFromEmail(effectiveFromEmail);
      if (fromAuth.authorized === false) {
        await client.query('ROLLBACK');
        return fail(res, req.correlationId, 'FROM_EMAIL_NOT_AUTHORIZED', fromAuth.message, 400);
      }
    }

    if (hasIsActive) {
      await client.query(
        'UPDATE engagement_reporting.report_schedule SET is_active = $2 WHERE report_schedule_id = $1::uuid',
        [scheduleId, isActive],
      );
    }

    if (hasCronExpression || hasTimezone) {
      const sets = [];
      const params = [scheduleId];
      let paramIndex = 2;
      if (hasCronExpression) {
        sets.push(`cron_expression = $${paramIndex}::text`);
        params.push(cronExpression);
        paramIndex += 1;
      }
      if (hasTimezone) {
        sets.push(`timezone = $${paramIndex}::text`);
        params.push(timezone);
      }
      await client.query(
        `UPDATE engagement_reporting.report_schedule SET ${sets.join(', ')} WHERE report_schedule_id = $1::uuid`,
        params,
      );
    }

    if (
      hasTemplateId ||
      hasTemplateName ||
      hasProcessId ||
      hasWebsiteFilter ||
      hasUserGroupFilter ||
      hasSubject
    ) {
      if (hasTemplateId) {
        const nextTemplateId = String(body.template_id || '').trim();
        if (!nextTemplateId) {
          await client.query('ROLLBACK');
          return fail(res, req.correlationId, 'TEMPLATE_ID_REQUIRED', 'template_id cannot be empty', 400);
        }
        await assertTemplateForApplication(getPool(), {
          environment,
          applicationId,
          templateId: nextTemplateId,
        });
      }
      const configPatch = { application_id: applicationId };
      if (hasTemplateId) {
        const nextTemplateId = String(body.template_id || '').trim();
        configPatch.template_id = nextTemplateId;
      }
      if (hasTemplateName) {
        configPatch.template_name = String(body.template_name || '').trim();
      }
      if (hasProcessId) {
        const processId = String(body.process_id || '').trim();
        if (processId) configPatch.process_id = processId;
        else configPatch.process_id = null;
      }
      if (hasWebsiteFilter) {
        const filter = String(body.website_filter || '').trim();
        if (filter) configPatch.website_filter = filter;
        else configPatch.website_filter = null;
      }
      if (hasUserGroupFilter) {
        const filter = String(body.user_group_filter || '').trim();
        if (filter) configPatch.user_group_filter = filter;
        else configPatch.user_group_filter = null;
      }
      if (hasSubject) {
        const subject = String(body.subject || '').trim();
        if (subject) configPatch.subject = subject;
        else configPatch.subject = null;
      }
      await client.query(
        `UPDATE engagement_reporting.report_definition_version
         SET config = COALESCE(config, '{}'::jsonb) || $2::jsonb
         WHERE report_definition_version_id = $1::uuid`,
        [definitionVersionId, JSON.stringify(configPatch)],
      );
    }

    await client.query('COMMIT');

    const { rows } = await getPool().query(SCHEDULE_BY_ID_QUERY, [environment, applicationId, scheduleId]);
    if (!rows.length) {
      return fail(res, req.correlationId, 'SCHEDULE_NOT_FOUND', 'Schedule not found after update', 404);
    }

    const updatedRow = rows[0];
    let cloudScheduler = null;
    if (hasIsActive || hasCronExpression || hasTimezone) {
      try {
        cloudScheduler = await syncScheduleCloudJob(updatedRow);
      } catch (syncErr) {
        cloudScheduler = { ok: false, error: syncErr.message };
      }
    }

    const fromEmailAuth = validateScheduleFromEmail(updatedRow.from_email || effectiveFromEmail);

    return ok(res, req.correlationId, {
      item: mapScheduleRow(updatedRow),
      environment,
      application_id: applicationId,
      cloud_scheduler: cloudScheduler,
      from_email_auth: fromEmailAuth,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'TEMPLATE_NOT_FOUND' || err.code === 'TEMPLATE_APPLICATION_MISMATCH') {
      return fail(res, req.correlationId, err.code, err.message, err.status || 400);
    }
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'SCHEDULE_UPDATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

module.exports = router;
