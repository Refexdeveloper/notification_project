const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
if (process.env.TZ && String(process.env.TZ).trim()) {
  process.env.TZ = String(process.env.TZ).trim();
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const bodyParser = require('body-parser');
const db = require('./models');
const routes = require('./routes');
const schedulerService = require('./services/schedulerService');
const kissflowResourceService = require('./services/kissflowResourceService');
const { kissflowProxyMiddleware } = require('./middleware/kissflowProxy');

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
});

const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

app.use(
  helmet({
    hsts: false,
    contentSecurityPolicy: false,
  }),
);
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || true,
    credentials: true,
  }),
);
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  const now = new Date();
  res.json({
    status: 'ok',
    service: 'notification-engine-server',
    env: process.env.NODE_ENV || 'development',
    db: process.env.DB_NAME || 'notification_engine',
    tz: process.env.TZ || null,
    server_local_string: now.toString(),
    server_utc_iso: now.toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>Notification Engine API</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#111}
  code{background:#f4f4f5;padding:2px 6px;border-radius:4px}
  a{color:#2563eb}
</style></head>
<body>
  <h1>Notification Engine API</h1>
  <p>This is the <strong>backend</strong> on port ${PORT}. There is no app UI here.</p>
  <p>Open the frontend at <a href="http://localhost:3000">http://localhost:3000</a></p>
  <p>API health: <a href="/api/health"><code>/api/health</code></a></p>
  <p>Login example: <code>POST /api/auth/login</code></p>
</body></html>`);
});

app.use('/api/kissflow-proxy', kissflowProxyMiddleware);

app.use('/api', routes);

async function syncSchema() {
  // alter:true on every nodemon restart causes MySQL ALTER deadlocks (ER_LOCK_DEADLOCK).
  // Default: create missing tables only. Use DB_SYNC_ALTER=true when you intentionally change models.
  const useAlter = process.env.DB_SYNC_ALTER === 'true';
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.sequelize.sync(useAlter ? { alter: true } : undefined);
      console.log(`Sequelize sync complete${useAlter ? ' (alter)' : ''}`);
      return;
    } catch (err) {
      const isDeadlock =
        err?.parent?.code === 'ER_LOCK_DEADLOCK' ||
        err?.original?.code === 'ER_LOCK_DEADLOCK' ||
        String(err?.message || '').includes('Deadlock');
      if (!isDeadlock || attempt === maxAttempts) throw err;
      console.warn(`Schema sync deadlock (attempt ${attempt}/${maxAttempts}), retrying...`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function boot() {
  try {
    await db.sequelize.authenticate();
    console.log(`MySQL connected → ${process.env.DB_NAME || 'notification_engine'}`);

    if (process.env.SKIP_DB_SYNC === 'true') {
      console.log('Skipping Sequelize sync (SKIP_DB_SYNC=true)');
    } else {
      await syncSchema();
    }

    await kissflowResourceService.ensureKissflowSchema();
    console.log('Kissflow resource schema ready');

    await schedulerService.init();
    console.log('Scheduler initialized');

    app.listen(PORT, HOST, () => {
      console.log(`Notification Engine API on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('Boot failed:', err);
    process.exit(1);
  }
}

boot();

module.exports = app;
