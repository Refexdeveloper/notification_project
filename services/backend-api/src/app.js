'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { correlationMiddleware } = require('./middleware/correlation');
const { resolveCorsOptions } = require('./lib/cors');
const { ok } = require('./lib/envelope');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const applicationsRoutes = require('./routes/applications');
const engagementRoutes = require('./routes/engagement');
const templatesRoutes = require('./routes/templates');
const schedulesRoutes = require('./routes/schedules');
const usersRoutes = require('./routes/users');
const historyRoutes = require('./routes/history');
const deliveryHistoryRoutes = require('./routes/deliveryHistory');
const dashboardRoutes = require('./routes/dashboard');
const fieldsRoutes = require('./routes/fields');
const platformUsersRoutes = require('./routes/platformUsers');
const opsRoutes = require('./routes/ops');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors(resolveCorsOptions()));
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationMiddleware);

  const api = express.Router();
  api.use(healthRoutes);
  api.use('/auth', authRoutes);
  api.use('/users', usersRoutes);
  api.use('/platform-users', platformUsersRoutes);
  api.use('/ops', opsRoutes);
  api.use('/applications', applicationsRoutes);
  api.use('/applications/:applicationId/engagement', engagementRoutes);
  api.use('/applications/:applicationId/templates', templatesRoutes);
  api.use('/applications/:applicationId/schedules', schedulesRoutes);
  api.use('/applications/:applicationId/processes/:processId/fields', fieldsRoutes);
  api.use('/applications/:applicationId/history', historyRoutes);
  api.use('/history', deliveryHistoryRoutes);
  api.use('/dashboard', dashboardRoutes);

  app.use('/api/v1', api);

  app.get('/', (req, res) => {
    ok(res, req.correlationId, {
      service: 'refex-backend-api',
      version: 'v1',
      health: '/api/v1/health',
      ready: '/api/v1/ready',
      session: '/api/v1/auth/session',
      applications: '/api/v1/applications',
      note: 'OpenAPI routes live under /api/v1. Use the Admin UI for configuration.',
    });
  });

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      correlation_id: req.correlationId || 'unknown',
      error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` },
    });
  });

  return app;
}

module.exports = { createApp };
