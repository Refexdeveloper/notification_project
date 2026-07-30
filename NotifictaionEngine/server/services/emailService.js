const nodemailer = require('nodemailer');
const { SMTPConfig, EmailLog, sequelize } = require('../models');

function buildFrom(config) {
  const name = config.from_name && String(config.from_name).trim();
  if (name) return `"${name.replace(/"/g, '')}" <${config.from_email}>`;
  return config.from_email;
}

/** Port 465 = implicit SSL. 587/25 = STARTTLS (secure: false). */
function getTransportOptions(config) {
  const port = Number(config.port) || 587;
  const useSecure = port === 465 || (Boolean(config.secure) && port === 465);
  return {
    host: config.host,
    port,
    secure: useSecure,
    auth: {
      user: config.auth_user,
      pass: config.auth_pass,
    },
  };
}

class EmailService {
  constructor() {
    this.transporter = null;
    this.lastConfigId = null;
    this._emailLogColumns = null;
  }

  async getEmailLogColumns() {
    if (this._emailLogColumns) return this._emailLogColumns;
    try {
      const table = await sequelize.getQueryInterface().describeTable('email_logs');
      this._emailLogColumns = new Set(Object.keys(table || {}));
    } catch {
      this._emailLogColumns = new Set(['recipient', 'subject', 'status', 'error_message', 'sent_at']);
    }
    return this._emailLogColumns;
  }

  async safeCreateEmailLog(fields) {
    try {
      const cols = await this.getEmailLogColumns();
      const payload = {};
      for (const [k, v] of Object.entries(fields || {})) {
        if (cols.has(k)) payload[k] = v;
      }
      if (!payload.recipient && !payload.subject && !payload.status) return;
      await EmailLog.create(payload);
    } catch (e) {
      console.warn('EmailLog insert skipped:', e.message || e);
    }
  }

  async getTransporter() {
    const config = await SMTPConfig.findOne({ where: { is_active: true } });
    if (!config) throw new Error('No active SMTP configuration found');

    if (this.transporter && this.lastConfigId === config.id) return this.transporter;

    this.transporter = nodemailer.createTransport(getTransportOptions(config));
    this.lastConfigId = config.id;
    return this.transporter;
  }

  createTransporterFromConfig(config) {
    return nodemailer.createTransport(getTransportOptions(config));
  }

  invalidateTransporter() {
    this.transporter = null;
    this.lastConfigId = null;
  }

  async sendEmail(to, subject, html, meta = {}) {
    const logFields = (base) => ({
      ...base,
      entity_type: meta.entity_type ?? null,
      entity_id: meta.entity_id != null ? String(meta.entity_id) : null,
    });

    let transporter;
    try {
      transporter = await this.getTransporter();
    } catch (error) {
      await this.safeCreateEmailLog(
        logFields({
          recipient: to,
          subject,
          status: 'failed',
          error_message: error.message,
        }),
      );
      return false;
    }

    try {
      const config = await SMTPConfig.findOne({ where: { is_active: true } });
      await transporter.sendMail({
        from: buildFrom(config),
        to,
        subject,
        html,
      });
      await this.safeCreateEmailLog(logFields({ recipient: to, subject, status: 'sent' }));
      return true;
    } catch (error) {
      await this.safeCreateEmailLog(
        logFields({
          recipient: to,
          subject,
          status: 'failed',
          error_message: error.message,
        }),
      );
      return false;
    }
  }

  async sendEmailToMany(recipients, subject, html, meta = {}) {
    const list = Array.isArray(recipients)
      ? recipients.filter(Boolean).map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (!list.length) return { ok: false, error: 'No recipients' };

    const ccList = Array.isArray(meta.cc)
      ? meta.cc.filter(Boolean).map((s) => String(s).trim()).filter(Boolean)
      : [];

    let logSubject = meta.report_period
      ? `${subject} [Report period: ${meta.report_period}]`
      : subject;
    if (logSubject.length > 255) logSubject = `${logSubject.slice(0, 252)}...`;

    const logFields = (base) => ({
      ...base,
      entity_type: meta.entity_type ?? null,
      entity_id: meta.entity_id != null ? String(meta.entity_id) : null,
    });

    const config = await SMTPConfig.findOne({ where: { is_active: true } });
    if (!config) {
      await this.safeCreateEmailLog(
        logFields({
          recipient: list.join(', '),
          subject: logSubject,
          status: 'failed',
          error_message: 'No active SMTP configuration found',
        }),
      );
      return { ok: false, error: 'No active SMTP configuration found' };
    }

    const transporter = this.createTransporterFromConfig(config);
    const plain = typeof config.toJSON === 'function' ? config.toJSON() : { ...config };
    const sendWithFrom = (fromEmail) =>
      transporter.sendMail({
        from: buildFrom({ ...plain, from_email: fromEmail }),
        to: list,
        cc: ccList.length ? ccList : undefined,
        subject,
        html,
      });

    const fromPrimary = config.from_email;
    const fromFallback = config.auth_user;

    try {
      await sendWithFrom(fromPrimary);
      await this.safeCreateEmailLog(
        logFields({
          recipient: [...list, ...ccList].join(', '),
          subject: logSubject,
          status: 'sent',
        }),
      );
      return { ok: true };
    } catch (error) {
      const msg = error.message || 'SMTP send failed';
      const relayDenied = /553|sender is not allowed|not allowed to relay/i.test(msg);
      const canFallback =
        relayDenied &&
        fromFallback &&
        String(fromPrimary || '').toLowerCase() !== String(fromFallback).toLowerCase();

      if (canFallback) {
        try {
          await sendWithFrom(fromFallback);
          await this.safeCreateEmailLog(
            logFields({
              recipient: [...list, ...ccList].join(', '),
              subject: logSubject,
              status: 'sent',
            }),
          );
          console.warn(
            `SMTP From "${fromPrimary}" rejected; sent as "${fromFallback}". Update From in Settings.`,
          );
          return { ok: true, warning: `Sent using ${fromFallback} (From was rejected by SMTP)` };
        } catch (retryErr) {
          const errMsg = retryErr.message || msg;
          await this.safeCreateEmailLog(
            logFields({
              recipient: [...list, ...ccList].join(', '),
              subject: logSubject,
              status: 'failed',
              error_message: errMsg,
            }),
          );
          return { ok: false, error: errMsg };
        }
      }

      await this.safeCreateEmailLog(
        logFields({
          recipient: [...list, ...ccList].join(', '),
          subject: logSubject,
          status: 'failed',
          error_message: msg,
        }),
      );
      return { ok: false, error: msg };
    }
  }

  async sendTestEmail(config, to) {
    if (!config?.host || !config?.auth_user || !config?.auth_pass || !config?.from_email || !to) {
      return { success: false, error: 'Missing required config or recipient' };
    }

    const attempt = async (fromEmail) => {
      const transporter = this.createTransporterFromConfig(config);
      return transporter.sendMail({
        from: buildFrom({ ...config, from_email: fromEmail }),
        to: String(to).trim(),
        subject: 'Test Email – Notification Engine SMTP',
        html: '<p>This is a test email from <strong>Notification Engine</strong>.</p><p>SMTP is working.</p>',
      });
    };

    try {
      const info = await attempt(config.from_email);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      const msg = error.message || 'Failed to send';
      const relayDenied = /553|sender is not allowed|not allowed to relay/i.test(msg);
      const fromDiffers =
        String(config.from_email).toLowerCase() !== String(config.auth_user).toLowerCase();

      // Zoho (and similar) often require From === authenticated mailbox
      if (relayDenied && fromDiffers) {
        try {
          const info = await attempt(config.auth_user);
          return {
            success: true,
            messageId: info.messageId,
            warning: `From "${config.from_email}" was rejected by the server; sent as "${config.auth_user}" instead. Update From email in Settings to match your SMTP login.`,
          };
        } catch (retryErr) {
          return {
            success: false,
            error: `${msg} (also failed as ${config.auth_user}: ${retryErr.message || 'send failed'})`,
          };
        }
      }

      return { success: false, error: msg };
    }
  }

  replaceTemplateVariables(templateBody, variables = {}) {
    let body = String(templateBody || '');
    for (const key of Object.keys(variables)) {
      body = body.replace(new RegExp(`{{${key}}}`, 'g'), String(variables[key] ?? ''));
    }
    return body;
  }
}

module.exports = new EmailService();
