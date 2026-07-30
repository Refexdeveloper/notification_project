'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { correlationMiddleware } = require('./middleware/correlation');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const applicationsRoutes = require('./routes/applications');
const engagementRoutes = require('./routes/engagement');
const templatesRoutes = require('./routes/templates');
const schedulesRoutes = require('./routes/schedules');
const usersRoutes = require('./routes/users');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationMiddleware);

  const api = express.Router();
  api.use(healthRoutes);
  api.use('/auth', authRoutes);
  api.use('/users', usersRoutes);
  api.use('/applications', applicationsRoutes);
  api.use('/applications/:applicationId/engagement', engagementRoutes);
  api.use('/applications/:applicationId/templates', templatesRoutes);
  api.use('/applications/:applicationId/schedules', schedulesRoutes);

  app.use('/api/v1', api);

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
