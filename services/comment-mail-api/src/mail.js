'use strict';

const nodemailer = require('nodemailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MAX_HTML_BYTES = 200 * 1024;
const MAX_RECIPIENTS = 8;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function asEmailList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;]+/);
  const out = [];
  for (const item of raw) {
    const email = normalizeEmail(item);
    if (!email || !EMAIL_RE.test(email)) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

function parseSendRequest(body = {}) {
  const to = asEmailList(body.to);
  const cc = asEmailList(body.cc).filter((email) => !to.includes(email));
  const subject = String(body.subject || '').trim();
  const html = String(body.html || '').trim();
  const displayFrom = normalizeEmail(body.from) || 'itsupport@extrovis.com';

  if (!to.length) {
    return { error: 'At least one valid to email is required' };
  }
  if (to.length + cc.length > MAX_RECIPIENTS) {
    return { error: `Too many recipients (max ${MAX_RECIPIENTS})` };
  }
  if (!html) {
    return { error: 'html body is required' };
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return { error: 'html body is too large' };
  }
  if (!subject) {
    return { error: 'subject is required' };
  }
  if (!EMAIL_RE.test(displayFrom)) {
    return { error: 'from must be a valid email' };
  }
  return { to, cc, subject, html, displayFrom };
}

function smtpConfig() {
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    user: String(process.env.SMTP_USER || '').trim(),
    pass: String(process.env.SMTP_APP_PASSWORD || process.env.SMTP_PASSWORD || '').trim(),
  };
}

async function sendHtmlMail({ to, cc, subject, html, displayFrom }) {
  const cfg = smtpConfig();
  if (!cfg.user || !cfg.pass) {
    const err = new Error('SMTP is not configured');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const displayName = String(process.env.COMMENT_MAIL_FROM_NAME || 'Extrovis IT Support').trim();
  const mail = {
    from: `"${displayName}" <${displayFrom}>`,
    sender: cfg.user,
    replyTo: displayFrom,
    to: to.join(', '),
    subject,
    html,
    envelope: { from: cfg.user, to: [...to, ...cc] },
  };
  if (cc.length) mail.cc = cc.join(', ');

  try {
    return await transporter.sendMail(mail);
  } catch (firstErr) {
    if (normalizeEmail(displayFrom) === normalizeEmail(cfg.user)) throw firstErr;
    mail.from = `"${displayName}" <${cfg.user}>`;
    mail.replyTo = displayFrom;
    return await transporter.sendMail(mail);
  }
}

module.exports = {
  EMAIL_RE,
  asEmailList,
  parseSendRequest,
  sendHtmlMail,
  smtpConfig,
};
