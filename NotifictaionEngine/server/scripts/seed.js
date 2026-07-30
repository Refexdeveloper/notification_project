require('dotenv').config();
const db = require('../models');
const {
  Role,
  User,
  SMTPConfig,
  EmailTemplate,
  NotificationScheduleConfig,
} = db;

async function seed() {
  await db.sequelize.authenticate();
  await db.sequelize.sync({ alter: true });

  const [adminRole] = await Role.findOrCreate({
    where: { name: 'Admin' },
    defaults: { description: 'Full access' },
  });
  await Role.findOrCreate({
    where: { name: 'Operator' },
    defaults: { description: 'Operate notifications' },
  });
  await Role.findOrCreate({
    where: { name: 'Viewer' },
    defaults: { description: 'Read-only' },
  });

  const [admin] = await User.findOrCreate({
    where: { email: 'admin@notificationengine.com' },
    defaults: {
      name: 'Admin',
      password: 'password123',
      role_id: adminRole.id,
      is_active: true,
    },
  });
  console.log('Admin user:', admin.email, '(password123)');

  const existingSmtp = await SMTPConfig.findOne({ where: { is_active: true } });
  if (!existingSmtp && process.env.SMTP_HOST) {
    await SMTPConfig.create({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE) === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth_user: process.env.SMTP_USER,
      auth_pass: process.env.SMTP_PASS,
      from_email: process.env.SMTP_FROM || process.env.SMTP_USER,
      from_name: 'Notification Engine',
      is_active: true,
    });
    console.log('Seeded SMTP from env defaults');
  }

  await EmailTemplate.findOrCreate({
    where: { name: 'welcome_notification' },
    defaults: {
      subject: 'Welcome {{name}}',
      body: '<p>Hello <strong>{{name}}</strong>,</p><p>Your Notification Engine account is ready.</p><p>Date: {{date}}</p>',
      description: 'Sample welcome template',
      is_active: true,
    },
  });

  await EmailTemplate.findOrCreate({
    where: { name: 'scheduled_digest' },
    defaults: {
      subject: 'Digest for {{date}}',
      body: '<p>Scheduled digest for <strong>{{name}}</strong> on {{date}}.</p><p>Generated {{generated_datetime}}</p>',
      description: 'Used by cron schedulers',
      is_active: true,
    },
  });

  await NotificationScheduleConfig.findOrCreate({
    where: { id: 1 },
    defaults: {
      name: 'Daily period notification',
      to_emails: JSON.stringify([admin.email]),
      subject: 'Notification Engine report {{report_period}}',
      body: '<p>Period: <strong>{{report_period}}</strong></p><p>From {{from_date}} to {{to_date}}</p><p>Generated {{generated_datetime}}</p>',
      schedule_type: 'daily',
      schedule_time: '09:00',
      is_active: false,
    },
  });

  console.log('Seed complete');
  await db.sequelize.close();
}

seed().catch(async (err) => {
  console.error(err);
  try {
    await db.sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
