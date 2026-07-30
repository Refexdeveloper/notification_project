const {
  User,
  Role,
  SMTPConfig,
  EmailTemplate,
  EmailScheduler,
  EmailLog,
  NotificationScheduleConfig,
  Application,
  AuditLog,
} = require('../models');
const emailService = require('../services/emailService');
const schedulerService = require('../services/schedulerService');
const kissflowResourceService = require('../services/kissflowResourceService');
const { signTokens } = require('../middleware/authMiddleware');
const cron = require('node-cron');

function cronValidate(expr) {
  try {
    return cron.validate(String(expr || '').trim());
  } catch {
    return false;
  }
}

async function audit(userId, action, entityType, entityId, details, req) {
  try {
    await AuditLog.create({
      user_id: userId || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId != null ? String(entityId) : null,
      details: details ? JSON.stringify(details) : null,
      ip_address: req?.ip || null,
    });
  } catch (e) {
    console.warn('Audit log skipped:', e.message);
  }
}

function sanitizeSMTP(config) {
  if (!config) return null;
  const json = config.toJSON ? config.toJSON() : { ...config };
  if (json.auth_pass) json.auth_pass = '••••••••';
  return json;
}

function parseEmails(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const a = JSON.parse(val);
      if (Array.isArray(a)) return a;
    } catch {
      /* fallthrough */
    }
    return val.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// ── Auth ──────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }
    const user = await User.findOne({
      where: { email },
      include: [{ model: Role, as: 'role' }],
    });
    if (!user || !(await user.validatePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (!user.is_active) return res.status(403).json({ message: 'User is inactive' });

    const tokens = signTokens(user);
    await audit(user.id, 'LOGIN', 'User', user.id, null, req);
    return res.json({
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role?.name,
      },
    });
  } catch (err) {
    console.error('login', err);
    return res.status(500).json({ message: 'Login failed', error: err.message });
  }
};

exports.me = async (req, res) => {
  return res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role?.name,
  });
};

// ── Users ─────────────────────────────────────────────
exports.listUsers = async (_req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      include: [{ model: Role, as: 'role', attributes: ['id', 'name'] }],
      order: [['id', 'ASC']],
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list users', error: err.message });
  }
};

exports.getUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] },
      include: [{ model: Role, as: 'role', attributes: ['id', 'name'] }],
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get user', error: err.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role_id, role, is_active } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email, password required' });
    }

    let resolvedRoleId = role_id ? Number(role_id) : null;
    if (!resolvedRoleId && role) {
      const found = await Role.findOne({ where: { name: String(role) } });
      if (!found) return res.status(400).json({ message: `Unknown role: ${role}` });
      resolvedRoleId = found.id;
    }
    if (!resolvedRoleId) {
      return res.status(400).json({ message: 'role_id or role required' });
    }

    const existing = await User.findOne({ where: { email: String(email).trim().toLowerCase() } });
    if (existing) {
      return res.status(409).json({ message: 'A user with this email already exists' });
    }

    const roleRow = await Role.findByPk(resolvedRoleId);
    if (!roleRow) return res.status(400).json({ message: 'Invalid role_id' });

    const user = await User.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      password,
      role_id: resolvedRoleId,
      is_active: is_active !== false,
    });
    await audit(req.user.id, 'CREATE_USER', 'User', user.id, { email: user.email }, req);
    const created = await User.findByPk(user.id, {
      attributes: { exclude: ['password'] },
      include: [{ model: Role, as: 'role' }],
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create user', error: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const { name, email, password, role_id, role, is_active } = req.body || {};
    if (name != null) user.name = String(name).trim();
    if (email != null) {
      const nextEmail = String(email).trim().toLowerCase();
      const clash = await User.findOne({ where: { email: nextEmail } });
      if (clash && clash.id !== user.id) {
        return res.status(409).json({ message: 'A user with this email already exists' });
      }
      user.email = nextEmail;
    }
    if (role_id != null) user.role_id = Number(role_id);
    else if (role) {
      const found = await Role.findOne({ where: { name: String(role) } });
      if (!found) return res.status(400).json({ message: `Unknown role: ${role}` });
      user.role_id = found.id;
    }
    if (is_active != null) user.is_active = Boolean(is_active);
    if (password) user.password = password;
    await user.save();
    await audit(req.user.id, 'UPDATE_USER', 'User', user.id, null, req);
    const updated = await User.findByPk(user.id, {
      attributes: { exclude: ['password'] },
      include: [{ model: Role, as: 'role' }],
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    await user.destroy();
    await audit(req.user.id, 'DELETE_USER', 'User', req.params.id, { email: user.email }, req);
    res.json({ ok: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete user', error: err.message });
  }
};

exports.listRoles = async (_req, res) => {
  try {
    res.json(await Role.findAll({ order: [['id', 'ASC']] }));
  } catch (err) {
    res.status(500).json({ message: 'Failed to list roles', error: err.message });
  }
};

// ── SMTP ──────────────────────────────────────────────
exports.getSMTPConfig = async (_req, res) => {
  let config = await SMTPConfig.findOne({ where: { is_active: true } });
  if (!config) config = await SMTPConfig.findOne({ order: [['id', 'DESC']] });
  res.json(sanitizeSMTP(config));
};

exports.saveSMTPConfig = async (req, res) => {
  try {
    const required = ['host', 'port', 'auth_user', 'from_email'];
    for (const key of required) {
      if (!req.body?.[key] && req.body?.[key] !== 0) {
        return res.status(400).json({ message: `Missing field: ${key}` });
      }
    }

    const existing = await SMTPConfig.findOne({ where: { is_active: true } });
    let authPass = req.body.auth_pass;
    const masked =
      !authPass ||
      String(authPass).includes('•') ||
      String(authPass).trim() === '';
    if (masked) {
      if (!existing?.auth_pass) {
        return res.status(400).json({ message: 'Missing field: auth_pass' });
      }
      authPass = existing.auth_pass;
    }

    await SMTPConfig.update({ is_active: false }, { where: {} });
    const config = await SMTPConfig.create({
      host: req.body.host,
      port: Number(req.body.port),
      secure: Boolean(req.body.secure) || Number(req.body.port) === 465,
      auth_user: req.body.auth_user,
      auth_pass: authPass,
      from_email: req.body.from_email,
      from_name: req.body.from_name || null,
      is_active: true,
    });
    emailService.invalidateTransporter();
    await audit(req.user.id, 'UPDATE_SMTP_CONFIG', 'SMTPConfig', config.id, { host: config.host }, req);
    res.status(201).json(sanitizeSMTP(config));
  } catch (err) {
    res.status(500).json({ message: 'Failed to save SMTP', error: err.message });
  }
};

exports.testSMTPConfig = async (req, res) => {
  try {
    const to = (req.body?.to && String(req.body.to).trim()) || req.user.email;
    if (!to) {
      return res.status(400).json({ success: false, message: 'No recipient email (pass "to" or ensure your user has an email)' });
    }

    let config = req.body?.config;
    if (!config) {
      const row = await SMTPConfig.findOne({ where: { is_active: true } });
      if (!row) return res.status(400).json({ success: false, message: 'No active SMTP config — save settings first' });
      config = row.toJSON();
    }

    // Never use masked secrets from a client-provided config blob
    if (!config.auth_pass || String(config.auth_pass).includes('•')) {
      const row = await SMTPConfig.findOne({ where: { is_active: true } });
      if (row?.auth_pass) config.auth_pass = row.auth_pass;
    }

    const result = await emailService.sendTestEmail(config, to);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'SMTP test failed',
        error: result.error || 'SMTP test failed',
      });
    }
    res.json({
      success: true,
      message: result.warning
        ? `Test email sent to ${to}. ${result.warning}`
        : `Test email sent to ${to}`,
      messageId: result.messageId,
      warning: result.warning || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'SMTP test failed', error: err.message });
  }
};

// ── Templates ─────────────────────────────────────────
exports.listTemplates = async (_req, res) => {
  res.json(await EmailTemplate.findAll({ order: [['name', 'ASC']] }));
};

exports.createTemplate = async (req, res) => {
  try {
    const { name, subject, body, description, is_active } = req.body || {};
    if (!name || !subject || !body) {
      return res.status(400).json({ message: 'name, subject, body required' });
    }
    const tpl = await EmailTemplate.create({
      name,
      subject,
      body,
      description: description || null,
      is_active: is_active !== false,
    });
    await audit(req.user.id, 'CREATE_TEMPLATE', 'EmailTemplate', tpl.id, { name }, req);
    res.status(201).json(tpl);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create template', error: err.message });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const tpl = await EmailTemplate.findByPk(req.params.id);
    if (!tpl) return res.status(404).json({ message: 'Template not found' });
    const { name, subject, body, description, is_active } = req.body || {};
    if (name != null) tpl.name = name;
    if (subject != null) tpl.subject = subject;
    if (body != null) tpl.body = body;
    if (description != null) tpl.description = description;
    if (is_active != null) tpl.is_active = is_active;
    await tpl.save();
    await audit(req.user.id, 'UPDATE_TEMPLATE', 'EmailTemplate', tpl.id, null, req);
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update template', error: err.message });
  }
};

exports.previewTemplate = async (req, res) => {
  const tpl = await EmailTemplate.findByPk(req.params.id);
  if (!tpl) return res.status(404).json({ message: 'Template not found' });
  const variables = req.body?.variables || {};
  res.json({
    subject: emailService.replaceTemplateVariables(tpl.subject, variables),
    body: emailService.replaceTemplateVariables(tpl.body, variables),
  });
};

exports.testTemplate = async (req, res) => {
  try {
    const tpl = await EmailTemplate.findByPk(req.params.id);
    if (!tpl) return res.status(404).json({ message: 'Template not found' });
    const to = req.body?.to || req.user.email;
    const variables = req.body?.variables || {
      name: req.user.name,
      date: new Date().toLocaleDateString('en-IN'),
    };
    const subject = emailService.replaceTemplateVariables(tpl.subject, variables);
    const body = emailService.replaceTemplateVariables(tpl.body, variables);
    const ok = await emailService.sendEmail(to, `[TEST] ${subject}`, body, {
      entity_type: 'EmailTemplate',
      entity_id: String(tpl.id),
    });
    if (!ok) return res.status(400).json({ message: 'Send failed — check SMTP' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Test send failed', error: err.message });
  }
};

// ── Schedulers ────────────────────────────────────────
exports.listSchedulers = async (_req, res) => {
  res.json(
    await EmailScheduler.findAll({
      include: [{ model: EmailTemplate, as: 'template', attributes: ['id', 'name'] }],
      order: [['id', 'ASC']],
    }),
  );
};

exports.createScheduler = async (req, res) => {
  try {
    const { name, cron_expression, job_type, template_id, to_emails, is_active } = req.body || {};
    if (!name || !cron_expression || !job_type) {
      return res.status(400).json({ message: 'name, cron_expression, job_type required' });
    }
    const row = await EmailScheduler.create({
      name,
      cron_expression,
      job_type,
      template_id: template_id || null,
      to_emails: JSON.stringify(parseEmails(to_emails)),
      is_active: is_active !== false,
    });
    await schedulerService.refresh();
    await audit(req.user.id, 'CREATE_SCHEDULER', 'EmailScheduler', row.id, { name }, req);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create scheduler', error: err.message });
  }
};

exports.updateScheduler = async (req, res) => {
  try {
    const row = await EmailScheduler.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Scheduler not found' });
    const { name, cron_expression, job_type, template_id, to_emails, is_active } = req.body || {};
    if (name != null) row.name = name;
    if (cron_expression != null) row.cron_expression = cron_expression;
    if (job_type != null) row.job_type = job_type;
    if (template_id !== undefined) row.template_id = template_id;
    if (to_emails != null) row.to_emails = JSON.stringify(parseEmails(to_emails));
    if (is_active != null) row.is_active = is_active;
    await row.save();
    await schedulerService.refresh();
    await audit(req.user.id, 'UPDATE_SCHEDULER', 'EmailScheduler', row.id, null, req);
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update scheduler', error: err.message });
  }
};

/** Upsert UI report schedule onto server cron (by external_id). */
exports.syncScheduler = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.external_id || !b.name || !b.cron_expression) {
      return res.status(400).json({ message: 'external_id, name, cron_expression required' });
    }
    if (!cronValidate(b.cron_expression)) {
      return res.status(400).json({ message: `Invalid cron expression: ${b.cron_expression}` });
    }

    const payload = {
      name: String(b.name).trim(),
      external_id: String(b.external_id).trim(),
      cron_expression: String(b.cron_expression).trim(),
      job_type: b.job_type || 'report_send',
      template_id: b.template_id || null,
      to_emails: JSON.stringify(parseEmails(b.to_emails)),
      cc_emails: JSON.stringify(parseEmails(b.cc_emails)),
      subject: b.subject ? String(b.subject).slice(0, 512) : null,
      html_body: b.html_body != null ? String(b.html_body) : null,
      meta: b.meta != null ? JSON.stringify(b.meta) : null,
      is_active: b.is_active !== false,
    };

    let row = await EmailScheduler.findOne({ where: { external_id: payload.external_id } });
    if (row) {
      await row.update(payload);
    } else {
      row = await EmailScheduler.create(payload);
    }

    await schedulerService.refresh();
    await audit(req.user.id, 'SYNC_SCHEDULER', 'EmailScheduler', row.id, {
      external_id: payload.external_id,
      is_active: payload.is_active,
    }, req);

    // If activating and already past due today, fire catch-up immediately
    if (payload.is_active) {
      setImmediate(() => {
        schedulerService.runReportCatchUp().catch((e) => console.error('Immediate catch-up failed:', e));
      });
    }

    res.json(row);
  } catch (err) {
    res.status(500).json({ message: 'Failed to sync scheduler', error: err.message });
  }
};

exports.deleteSchedulerByExternal = async (req, res) => {
  try {
    const externalId = String(req.params.externalId || '').trim();
    const row = await EmailScheduler.findOne({ where: { external_id: externalId } });
    if (!row) return res.json({ ok: true, deleted: false });
    await row.destroy();
    await schedulerService.refresh();
    await audit(req.user.id, 'DELETE_SCHEDULER', 'EmailScheduler', row.id, { external_id: externalId }, req);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete scheduler', error: err.message });
  }
};

exports.runSchedulerNow = async (req, res) => {
  try {
    const externalId = req.body?.external_id || req.body?.externalId;
    const id = req.body?.id;
    let row = null;
    if (externalId) {
      row = await EmailScheduler.findOne({ where: { external_id: String(externalId) } });
    } else if (id) {
      row = await EmailScheduler.findByPk(Number(id));
    }
    if (!row) return res.status(404).json({ message: 'Scheduler not found on server — Save/Activate first' });

    // Allow re-send: clear today's sent lock
    await row.update({ last_status: 'manual', is_active: true });
    await schedulerService.runCronScheduler(row.id);

    const fresh = await EmailScheduler.findByPk(row.id);
    if (fresh?.last_status === 'sent') {
      return res.json({ ok: true, message: `Sent to recipients (${fresh.last_status})`, status: fresh.last_status });
    }
    return res.status(400).json({
      message: `Send finished with status: ${fresh?.last_status || 'unknown'}`,
      status: fresh?.last_status,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to run scheduler', error: err.message });
  }
};

// ── Period notification config (Final MIS pattern) ────
exports.getPeriodConfigs = async (_req, res) => {
  res.json(await NotificationScheduleConfig.findAll({ order: [['id', 'ASC']] }));
};

exports.upsertPeriodConfig = async (req, res) => {
  try {
    const id = req.params.id || req.body?.id || 1;
    let row = await NotificationScheduleConfig.findByPk(id);
    const payload = {
      name: req.body.name,
      to_emails: JSON.stringify(parseEmails(req.body.to_emails)),
      subject: req.body.subject,
      body: req.body.body,
      schedule_type: req.body.schedule_type,
      schedule_time: req.body.schedule_time,
      is_active: req.body.is_active,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    if (!row) {
      row = await NotificationScheduleConfig.create({
        id: Number(id) || undefined,
        name: payload.name || 'Scheduled notification',
        to_emails: payload.to_emails || '[]',
        subject: payload.subject || 'Scheduled Notification',
        body: payload.body || null,
        schedule_type: payload.schedule_type || 'daily',
        schedule_time: payload.schedule_time || '09:00',
        is_active: payload.is_active === true,
      });
    } else {
      await row.update(payload);
    }
    await audit(req.user.id, 'UPSERT_PERIOD_CONFIG', 'NotificationScheduleConfig', row.id, null, req);
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: 'Failed to save period config', error: err.message });
  }
};

exports.sendPeriodTest = async (req, res) => {
  try {
    const row = await NotificationScheduleConfig.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Config not found' });
    const toList = parseEmails(row.to_emails);
    if (!toList.length) return res.status(400).json({ message: 'No recipients configured' });

    res.status(202).json({ queued: true, message: 'Test email queued' });

    setImmediate(async () => {
      const vars = {
        report_period: req.body?.startDate && req.body?.endDate
          ? `${req.body.startDate} to ${req.body.endDate}`
          : 'test period',
        from_date: req.body?.startDate || '',
        to_date: req.body?.endDate || '',
        generated_datetime: new Date().toLocaleString('en-IN'),
      };
      const subject = emailService.replaceTemplateVariables(row.subject, vars);
      const html = emailService.replaceTemplateVariables(
        row.body || '<p>Test scheduled notification for {{report_period}}</p>',
        vars,
      );
      await emailService.sendEmailToMany(toList, `[TEST] ${subject}`, html, {
        entity_type: 'NotificationScheduleConfig',
        entity_id: String(row.id),
      });
      await row.update({ last_sent_at: new Date() });
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to queue test', error: err.message });
  }
};

// ── Email logs ────────────────────────────────────────
exports.listEmailLogs = async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const where = {};
  if (req.query.entity_type) where.entity_type = req.query.entity_type;
  const { rows, count } = await EmailLog.findAndCountAll({
    where,
    order: [['sent_at', 'DESC']],
    limit,
    offset,
  });
  res.json({ total: count, items: rows });
};

// ── Applications (Kissflow) ───────────────────────────
exports.listApplications = async (_req, res) => {
  const apps = await Application.findAll({ order: [['id', 'DESC']] });
  res.json(
    apps.map((a) => {
      const j = a.toJSON();
      if (j.access_key_secret) j.access_key_secret = '••••••••';
      return j;
    }),
  );
};

exports.createApplication = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.account_id || !b.subdomain) {
      return res.status(400).json({ message: 'name, account_id, subdomain required' });
    }
    const app = await Application.create({
      name: b.name,
      account_id: b.account_id,
      app_id: b.app_id || null,
      subdomain: b.subdomain,
      region: b.region || 'com',
      environment: b.environment || 'Development',
      process_ids: JSON.stringify(b.process_ids || []),
      dataform_ids: JSON.stringify(b.dataform_ids || []),
      board_ids: JSON.stringify(b.board_ids || []),
      access_key_id: b.access_key_id || null,
      access_key_secret: b.access_key_secret || null,
      created_by: req.user.id,
      status: 'Active',
    });
    await audit(req.user.id, 'CREATE_APPLICATION', 'Application', app.id, { name: app.name }, req);
    res.status(201).json(app);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create application', error: err.message });
  }
};

exports.syncKissflowResourceFields = async (req, res) => {
  try {
    const result = await kissflowResourceService.syncResourceFields(req.body || {});
    res.json({
      ok: true,
      fieldCount: result.fieldCount,
      resource_id: result.resource.resource_id,
      last_sync_at: result.resource.last_sync_at,
    });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Failed to sync fields' });
  }
};

exports.getKissflowResourceFields = async (req, res) => {
  try {
    const { resource, fields } = await kissflowResourceService.getResourceFields(req.query || {});
    if (!resource) {
      return res.json({ fields: [], resource: null });
    }
    res.json({
      fields,
      resource: {
        resource_id: resource.resource_id,
        resource_type: resource.resource_type,
        admin_process_id: resource.admin_process_id,
        item_count: resource.item_count,
        last_sync_at: resource.last_sync_at,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load fields' });
  }
};

// ── Audit logs ────────────────────────────────────────
exports.listAuditLogs = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const where = {};
    if (req.query.action) where.action = req.query.action;
    if (req.query.entity_type) where.entity_type = req.query.entity_type;

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    res.json({
      total: count,
      items: rows.map((r) => {
        const j = r.toJSON();
        if (typeof j.details === 'string') {
          try {
            j.details = JSON.parse(j.details);
          } catch {
            /* keep string */
          }
        }
        return j;
      }),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to list audit logs', error: err.message });
  }
};
