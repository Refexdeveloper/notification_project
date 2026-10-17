'use strict';

const nodemailer = require('nodemailer');
const { readGcpSecret } = require('./gcpSecrets');

const SMTP_USER_SECRET = process.env.SMTP_USER_SECRET || 'engagement-report-smtp-user';
const SMTP_PASS_SECRET = process.env.SMTP_APP_PASSWORD_SECRET || 'engagement-report-smtp-app-password';

async function loadSmtpAuth() {
  let user = String(process.env.SMTP_USER || process.env.SMTP_FROM || '').trim();
  let pass = String(process.env.SMTP_APP_PASSWORD || process.env.SMTP_PASSWORD || '').trim();
  if (!user) user = await readGcpSecret(SMTP_USER_SECRET);
  if (!pass) pass = await readGcpSecret(SMTP_PASS_SECRET);
  return { user: String(user || '').trim(), pass: String(pass || '').trim() };
}

async function sendTransactionalMail({ to, subject, text, html }) {
  const auth = await loadSmtpAuth();
  if (!auth.user || !auth.pass) {
    const err = new Error('SMTP is not configured');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: auth.user, pass: auth.pass },
  });
  await transporter.sendMail({
    from: `"Notification Engine" <${auth.user}>`,
    to,
    subject,
    text,
    html: html || undefined,
  });
  return { sent: true, from: auth.user };
}

module.exports = { loadSmtpAuth, sendTransactionalMail };
