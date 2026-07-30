const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

router.post('/auth/login', ctrl.login);
router.get('/auth/me', authenticate, ctrl.me);

router.use(authenticate);

router.get('/roles', ctrl.listRoles);
router.get('/users', requireAdmin, ctrl.listUsers);
router.get('/users/:id', requireAdmin, ctrl.getUser);
router.post('/users', requireAdmin, ctrl.createUser);
router.put('/users/:id', requireAdmin, ctrl.updateUser);
router.delete('/users/:id', requireAdmin, ctrl.deleteUser);

router.get('/smtp-config', requireAdmin, ctrl.getSMTPConfig);
router.post('/smtp-config', requireAdmin, ctrl.saveSMTPConfig);
router.post('/smtp-config/test', requireAdmin, ctrl.testSMTPConfig);

router.get('/templates', ctrl.listTemplates);
router.post('/templates', requireAdmin, ctrl.createTemplate);
router.put('/templates/:id', requireAdmin, ctrl.updateTemplate);
router.post('/templates/:id/preview', ctrl.previewTemplate);
router.post('/templates/:id/test', requireAdmin, ctrl.testTemplate);

router.get('/schedulers', ctrl.listSchedulers);
router.post('/schedulers', requireAdmin, ctrl.createScheduler);
router.put('/schedulers/:id', requireAdmin, ctrl.updateScheduler);
router.post('/schedulers/sync', requireAdmin, ctrl.syncScheduler);
router.post('/schedulers/run-now', requireAdmin, ctrl.runSchedulerNow);
router.delete('/schedulers/by-external/:externalId', requireAdmin, ctrl.deleteSchedulerByExternal);

router.get('/period-configs', ctrl.getPeriodConfigs);
router.put('/period-configs/:id', requireAdmin, ctrl.upsertPeriodConfig);
router.post('/period-configs/:id/send-test', requireAdmin, ctrl.sendPeriodTest);

router.get('/email-logs', requireAdmin, ctrl.listEmailLogs);
router.get('/audit-logs', requireAdmin, ctrl.listAuditLogs);

router.get('/applications', ctrl.listApplications);
router.post('/applications', requireAdmin, ctrl.createApplication);

router.post('/kissflow-resources/sync-fields', ctrl.syncKissflowResourceFields);
router.get('/kissflow-resources/fields', ctrl.getKissflowResourceFields);

module.exports = router;
