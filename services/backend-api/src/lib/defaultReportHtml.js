'use strict';

/** Default HTML starter for newly created backend templates. */
function defaultReportHtml(appName) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{ReportTitle}}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#12202a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2eaee;">
          <tr>
            <td style="background:#0f766e;padding:28px 32px;">
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);">Notification Engine</div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">{{ReportTitle}}</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:8px;">${appName} · {{ReportDate}}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#3d4f5c;">
                Hello {{RecipientName}}, here is your scheduled report for <strong>${appName}</strong>.
              </p>
              <div style="margin-top:24px;font-size:13px;color:#5b6b76;line-height:1.6;">
                {{ReportBody}}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid #eef2f4;font-size:11px;color:#8a9aa5;">
              Sent by Notification Engine · {{CompanyName}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { defaultReportHtml };
