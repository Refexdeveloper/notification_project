'use strict';

const express = require('express');
const cors = require('cors');
const { parseSendRequest, sendHtmlMail } = require('./mail');

const port = Number(process.env.PORT || 8080);
const apiKey = String(process.env.COMMENT_MAIL_API_KEY || '').trim();

function authorized(req) {
  if (!apiKey) return false;
  const header = String(req.get('x-api-key') || req.get('authorization') || '').trim();
  const token = header.replace(/^Bearer\s+/i, '');
  return token === apiKey;
}

const app = express();
app.disable('x-powered-by');
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
}));
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'refex-comment-mail' });
});

app.get('/', (_req, res) => {
  res.json({
    service: 'refex-comment-mail',
    health: '/health',
    send: 'POST /v1/send',
  });
});

app.post('/v1/send', async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const parsed = parseSendRequest(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }
  try {
    const info = await sendHtmlMail(parsed);
    return res.json({
      ok: true,
      to: parsed.to,
      cc: parsed.cc,
      subject: parsed.subject,
      messageId: info?.messageId || '',
    });
  } catch (err) {
    const code = err?.code === 'SMTP_NOT_CONFIGURED' ? 503 : 502;
    console.error(JSON.stringify({
      msg: 'comment-mail send failed',
      error: err?.message || String(err),
      to: parsed.to,
      cc: parsed.cc,
    }));
    return res.status(code).json({ ok: false, error: 'Failed to send email' });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: `No route ${req.method} ${req.path}` });
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      msg: 'comment-mail-api started',
      port,
      smtpConfigured: Boolean(process.env.SMTP_USER && (process.env.SMTP_APP_PASSWORD || process.env.SMTP_PASSWORD)),
    }));
  });
}

module.exports = { app };
