'use strict';

/** Gmail SMTP can only send as SMTP_USER unless the From address is a configured send-as alias. */
function validateScheduleFromEmail(fromEmail) {
  const from = String(fromEmail || '').trim().toLowerCase();
  const smtpUser = String(process.env.SMTP_USER || process.env.SMTP_FROM || '').trim().toLowerCase();

  if (!from) {
    return { valid: false, authorized: false, message: 'From email is required' };
  }

  if (!smtpUser) {
    return {
      valid: true,
      authorized: null,
      message:
        'From email format OK. SMTP_USER is not configured on backend-api — authorize this address as a Gmail send-as alias for the SMTP mailbox before sending.',
      smtp_user: null,
    };
  }

  if (from === smtpUser) {
    return { valid: true, authorized: true, message: 'From matches SMTP mailbox', smtp_user: smtpUser };
  }

  return {
    valid: true,
    authorized: false,
    message: `From (${from}) must be added as a "Send mail as" alias in Google Workspace for ${smtpUser}, or use ${smtpUser} as From.`,
    smtp_user: smtpUser,
  };
}

module.exports = {
  validateScheduleFromEmail,
};
