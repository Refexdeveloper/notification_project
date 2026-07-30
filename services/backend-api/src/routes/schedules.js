'use strict';

const express = require('express');
const { ok, fail } = require('../lib/envelope');
const { getPool, isDatabaseConfigured } = require('../lib/db');

const router = express.Router({ mergeParams: true });

const SCHEDULES_QUERY = `
SELECT
  rs.report_schedule_id::text AS id,
  rs.cron_expression,
  rs.timezone,
  rs.is_active,
  rs.created_at,
  rd.name AS definition_name,
  rdv.config->>'application_id' AS application_id,
  rdv.config->>'template_id' AS template_id,
  rdv.config->>'template_name' AS template_name,
  rdv.config->>'from_email' AS from_email,
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
  AND ($2::text IS NULL OR rdv.config->>'application_id' = $2)
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
  rdv.config->>'template_id' AS template_id,
  rdv.config->>'template_name' AS template_name,
  rdv.config->>'from_email' AS from_email,
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
  AND rdv.config->>'application_id' = $2
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
    template_id: row.template_id || null,
    template_name: row.template_name || null,
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

  if (!hasRecipientsTo && !hasRecipientsCc && !hasIsActive && !hasFromEmail) {
    return fail(
      res,
      req.correlationId,
      'UPDATE_FIELDS_REQUIRED',
      'Provide from_email, recipients_to, recipients_cc, and/or is_active',
      400,
    );
  }

  const recipientsTo = hasRecipientsTo ? normalizeEmailList(body.recipients_to) : null;
  const recipientsCc = hasRecipientsCc ? normalizeEmailList(body.recipients_cc) : null;
  const isActive = hasIsActive ? Boolean(body.is_active) : null;
  const fromEmail = hasFromEmail ? normalizeSingleEmail(body.from_email) : null;

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
    }

    if (hasIsActive) {
      await client.query(
        'UPDATE engagement_reporting.report_schedule SET is_active = $2 WHERE report_schedule_id = $1::uuid',
        [scheduleId, isActive],
      );
    }

    await client.query('COMMIT');

    const { rows } = await getPool().query(SCHEDULE_BY_ID_QUERY, [environment, applicationId, scheduleId]);
    if (!rows.length) {
      return fail(res, req.correlationId, 'SCHEDULE_NOT_FOUND', 'Schedule not found after update', 404);
    }

    return ok(res, req.correlationId, {
      item: mapScheduleRow(rows[0]),
      environment,
      application_id: applicationId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '42P01') {
      return ok(res, req.correlationId, { warning: 'SCHEMA_NOT_MIGRATED' });
    }
    return fail(res, req.correlationId, 'SCHEDULE_UPDATE_FAILED', err.message, 500, true);
  } finally {
    client.release();
  }
});

module.exports = router;
