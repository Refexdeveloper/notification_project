const cron = require('node-cron');
const {
  EmailScheduler,
  EmailTemplate,
  NotificationScheduleConfig,
  sequelize,
} = require('../models');
const emailService = require('./emailService');
const leadReportService = require('./leadReportService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SMTP_ATTEMPTS = 3;
const SMTP_RETRY_DELAY_MS = 7000;
const PERIOD_SMTP_ATTEMPTS = 4;
const PERIOD_SMTP_RETRY_DELAY_MS = 15000;
const TZ = process.env.TZ || 'Asia/Kolkata';

function parseEmails(val) {
  if (Array.isArray(val)) return val.filter(Boolean).map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return [];
    try {
      const a = JSON.parse(s);
      return Array.isArray(a)
        ? a.map(String).map((e) => e.trim()).filter(Boolean)
        : s.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    } catch {
      return s.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    }
  }
  return [];
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localNowParts() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] ?? new Date().getDay(),
    date: Number(parts.day),
    month: Number(parts.month) - 1,
  };
}

function sameLocalDay(dateVal, ymdStr) {
  if (!dateVal) return false;
  const d = new Date(dateVal);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d) === ymdStr;
}

/** Same calendar rules as Biogas Final MIS. */
function getDateRangeForSchedule(scheduleType) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (scheduleType === 'daily') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { startDate: ymd(y), endDate: ymd(y) };
  }

  if (scheduleType === 'weekly') {
    const end = new Date(today);
    end.setDate(end.getDate() - 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return { startDate: ymd(start), endDate: ymd(end) };
  }

  if (scheduleType === 'monthly') {
    const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(firstThis);
    end.setDate(end.getDate() - 1);
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { startDate: ymd(start), endDate: ymd(end) };
  }

  const q = Math.floor(today.getMonth() / 3);
  const startMonth = (((q - 1 + 4) % 4) * 3);
  let year = today.getFullYear();
  if (q === 0) year -= 1;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return { startDate: ymd(start), endDate: ymd(end) };
}

function isScheduledAttemptDue(scheduleType, scheduleTime) {
  const now = localNowParts();
  const [hh, mm] = String(scheduleTime || '09:00').split(':').map((x) => Number(x));
  const dueMinutes = (Number.isFinite(hh) ? hh : 9) * 60 + (Number.isFinite(mm) ? mm : 0);
  const nowMinutes = now.hour * 60 + now.minute;
  if (nowMinutes < dueMinutes) return false;

  if (scheduleType === 'daily') return true;
  if (scheduleType === 'weekly') return now.weekday === 1;
  if (scheduleType === 'monthly') return now.date === 1;
  if (scheduleType === 'quarterly') return now.date === 1 && [0, 3, 6, 9].includes(now.month);
  return false;
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Fit legacy VARCHAR(32) last_status columns + keep errors readable. */
function compactStatus(value) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (s.length <= 32) return s;
  if (/553|not allowed to relay/i.test(s)) return 'failed:smtp_553_from';
  if (/auth|invalid login|535/i.test(s)) return 'failed:smtp_auth';
  if (/ECONN|ETIMEDOUT|connect/i.test(s)) return 'failed:smtp_connect';
  return `failed:${s}`.slice(0, 32);
}

function reportDue(scheduler, now) {
  const meta = parseMeta(scheduler.meta);
  const cadence = meta.cadence || {};
  const type = cadence.type || 'daily';
  const time = cadence.time || '09:00';
  const [hh, mm] = String(time).split(':').map((x) => Number(x));
  const dueMinutes = (Number.isFinite(hh) ? hh : 9) * 60 + (Number.isFinite(mm) ? mm : 0);
  const nowMinutes = now.hour * 60 + now.minute;
  if (nowMinutes < dueMinutes) return false;
  if (type === 'daily') return true;
  if (type === 'weekly') return now.weekday === (cadence.weekday ?? 1);
  if (type === 'monthly') return now.date === Math.min(cadence.monthDay || 1, 28);
  // cron: rely on node-cron exact fire; catch-up uses HH:MM from expression when possible
  const parts = String(scheduler.cron_expression || '').trim().split(/\s+/);
  if (parts.length >= 2) {
    const cMin = Number(parts[0]);
    const cHour = Number(parts[1]);
    if (Number.isFinite(cMin) && Number.isFinite(cHour)) {
      return nowMinutes >= cHour * 60 + cMin;
    }
  }
  return false;
}

/** Add missing columns when SKIP_DB_SYNC=true (no full alter). */
async function ensureSchedulerColumns() {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable('email_schedulers');
  } catch {
    return;
  }
  const add = async (name, spec) => {
    if (!desc[name]) {
      await qi.addColumn('email_schedulers', name, spec);
      console.log(`Added email_schedulers.${name}`);
    }
  };
  const { DataTypes } = require('sequelize');
  await add('external_id', { type: DataTypes.STRING(96), allowNull: true });
  await add('cc_emails', { type: DataTypes.TEXT, allowNull: true });
  await add('subject', { type: DataTypes.STRING(512), allowNull: true });
  await add('html_body', { type: DataTypes.TEXT('long'), allowNull: true });
  await add('meta', { type: DataTypes.TEXT, allowNull: true });

  // Widen last_status if it is still the old short VARCHAR
  try {
    const statusCol = desc.last_status || desc.lastStatus;
    const type = String(statusCol?.type || '').toLowerCase();
    if (type.includes('varchar') && !type.includes('255') && !type.includes('512')) {
      await sequelize.query(
        'ALTER TABLE `email_schedulers` MODIFY COLUMN `last_status` VARCHAR(255) NULL',
      );
      console.log('Widened email_schedulers.last_status to VARCHAR(255)');
    }
  } catch (e) {
    console.warn('Could not widen last_status:', e.message || e);
  }
}

class SchedulerService {
  constructor() {
    this.jobs = new Map();
    this.periodJob = null;
    this.catchUpJob = null;
    this._periodLock = false;
    this._catchUpLock = false;
  }

  async init() {
    console.log('Initializing Scheduler Service...');
    await ensureSchedulerColumns();

    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();

    const schedulers = await EmailScheduler.findAll({ where: { is_active: true } });
    for (const scheduler of schedulers) this.scheduleJob(scheduler);

    if (this.periodJob) {
      this.periodJob.stop();
      this.periodJob = null;
    }
    this.periodJob = cron.schedule(
      '*/15 * * * *',
      async () => {
        try {
          await this.runPeriodNotificationCheck();
        } catch (e) {
          console.error('Period notification job failed:', e);
        }
      },
      { timezone: TZ },
    );
    console.log(`Period notification check scheduled (every 15 minutes, TZ=${TZ}).`);

    if (this.catchUpJob) {
      this.catchUpJob.stop();
      this.catchUpJob = null;
    }
    this.catchUpJob = cron.schedule(
      '* * * * *',
      async () => {
        try {
          await this.runReportCatchUp();
        } catch (e) {
          console.error('Report catch-up failed:', e);
        }
      },
      { timezone: TZ },
    );
    console.log(`Report schedule catch-up running every minute (TZ=${TZ}).`);
  }

  async refresh() {
    await this.init();
  }

  scheduleJob(scheduler) {
    if (!cron.validate(scheduler.cron_expression)) {
      console.warn(`Invalid cron for scheduler ${scheduler.id}: ${scheduler.cron_expression}`);
      return;
    }
    if (this.jobs.has(scheduler.id)) this.jobs.get(scheduler.id).stop();

    const job = cron.schedule(
      scheduler.cron_expression,
      async () => {
        try {
          await this.runCronScheduler(scheduler.id);
        } catch (e) {
          console.error(`Scheduler ${scheduler.id} failed:`, e);
        }
      },
      { timezone: TZ },
    );
    this.jobs.set(scheduler.id, job);
    console.log(`Scheduled job: ${scheduler.name} (${scheduler.cron_expression}) TZ=${TZ}`);
  }

  async runReportCatchUp() {
    if (this._catchUpLock) return;
    this._catchUpLock = true;
    try {
      const now = localNowParts();
      const rows = await EmailScheduler.findAll({
        where: { is_active: true, job_type: 'report_send' },
      });
      for (const row of rows) {
        const status = String(row.last_status || '');
        // Already sent today, or already failed today (avoid minute spam until manual retry)
        if (sameLocalDay(row.last_run_at, now.ymd) && (status === 'sent' || status.startsWith('failed'))) {
          continue;
        }
        if (!reportDue(row, now)) continue;
        console.log(`Catch-up firing report scheduler ${row.id} (${row.name})`);
        await this.runCronScheduler(row.id);
      }
    } finally {
      this._catchUpLock = false;
    }
  }

  async runCronScheduler(id) {
    const scheduler = await EmailScheduler.findByPk(id, {
      include: [{ model: EmailTemplate, as: 'template' }],
    });
    if (!scheduler || !scheduler.is_active) return;

    const now = localNowParts();
    const prevStatus = String(scheduler.last_status || '');
    if (
      scheduler.job_type === 'report_send' &&
      sameLocalDay(scheduler.last_run_at, now.ymd) &&
      (prevStatus === 'sent' || prevStatus.startsWith('failed'))
    ) {
      // Manual run-now sets last_status to 'manual' so this does not block retries
      return;
    }

    const recipients = parseEmails(scheduler.to_emails);
    if (!recipients.length) {
      await scheduler.update({
        last_run_at: new Date(),
        last_status: compactStatus('skipped_no_recipients'),
      });
      return;
    }

    let subject = scheduler.subject || scheduler.name;
    let html =
      scheduler.html_body ||
      `<p>Scheduled notification: <strong>${scheduler.name}</strong></p>`;

    const meta = parseMeta(scheduler.meta);
    if (leadReportService.isLeadTrackerScheduler(meta)) {
      try {
        const built = await leadReportService.buildLeadTrackerReport({
          groupName: meta.userGroupFilter || scheduler.name || meta.websiteFilter,
          websiteFilter: meta.websiteFilter,
        });
        html = built.html;
        subject = built.subject || subject;
        await scheduler.update({ html_body: html, subject });
        console.log(`Lead Tracker report rebuilt for scheduler ${scheduler.id} (${built.rowCount} users)`);
      } catch (e) {
        console.warn(`Lead Tracker rebuild failed for ${scheduler.id}:`, e.message || e);
      }
    } else if (!scheduler.html_body && scheduler.template) {
      const vars = {
        date: new Date().toLocaleDateString('en-IN'),
        name: scheduler.name,
        generated_datetime: new Date().toLocaleString('en-IN'),
        ReportDate: new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' }),
      };
      subject = emailService.replaceTemplateVariables(scheduler.template.subject, vars);
      html = emailService.replaceTemplateVariables(scheduler.template.body, vars);
    }

    const todayVars = {
      ReportDate: new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' }),
      generated_datetime: new Date().toLocaleString('en-IN', { timeZone: TZ }),
      date: new Date().toLocaleDateString('en-IN'),
    };
    subject = emailService.replaceTemplateVariables(subject, todayVars);
    html = emailService.replaceTemplateVariables(html, todayVars);

    const cc = parseEmails(scheduler.cc_emails);
    let lastError = '';
    for (let attempt = 1; attempt <= SMTP_ATTEMPTS; attempt++) {
      const result = await emailService.sendEmailToMany(recipients, subject, html, {
        entity_type: 'EmailScheduler',
        entity_id: String(scheduler.id),
        cc,
      });
      if (result.ok) {
        await scheduler.update({ last_run_at: new Date(), last_status: 'sent' });
        console.log(`Scheduler ${scheduler.id} sent to ${recipients.join(', ')}`);
        return;
      }
      lastError = result.error || 'send failed';
      if (attempt < SMTP_ATTEMPTS) await sleep(SMTP_RETRY_DELAY_MS);
    }
    try {
      await scheduler.update({
        last_run_at: new Date(),
        last_status: compactStatus(`failed:${lastError}`),
      });
    } catch (e) {
      console.error(`Failed to persist scheduler ${scheduler.id} status:`, e.message || e);
    }
    console.error(`Scheduler ${scheduler.id} failed: ${lastError}`);
  }

  async runPeriodNotificationCheck() {
    if (this._periodLock) return;
    this._periodLock = true;
    try {
      const configs = await NotificationScheduleConfig.findAll({ where: { is_active: true } });
      for (const config of configs) {
        await this.runOnePeriodConfig(config);
      }
    } finally {
      this._periodLock = false;
    }
  }

  async runOnePeriodConfig(config) {
    const toList = parseEmails(config.to_emails);
    if (!toList.length) return;
    if (!isScheduledAttemptDue(config.schedule_type, config.schedule_time)) return;

    const { startDate, endDate } = getDateRangeForSchedule(config.schedule_type);
    if (config.last_successful_period_end === endDate) return;

    const vars = {
      report_period: `${startDate} to ${endDate}`,
      from_date: startDate,
      to_date: endDate,
      generated_datetime: new Date().toLocaleString('en-IN', { timeZone: TZ }),
    };
    const subject = emailService.replaceTemplateVariables(config.subject || 'Scheduled Notification', vars);
    const html = emailService.replaceTemplateVariables(
      config.body ||
        '<p>Scheduled notification for period <strong>{{report_period}}</strong>.</p><p>Generated {{generated_datetime}}</p>',
      vars,
    );

    let lastError = '';
    for (let attempt = 1; attempt <= PERIOD_SMTP_ATTEMPTS; attempt++) {
      const result = await emailService.sendEmailToMany(toList, subject, html, {
        entity_type: 'NotificationScheduleConfig',
        entity_id: String(config.id),
        report_period: endDate,
      });
      if (result.ok) {
        await config.update({
          last_sent_at: new Date(),
          last_successful_period_end: endDate,
          schedule_failure_period_end: null,
          schedule_failure_summary: null,
          schedule_failure_last_attempt_at: null,
          delivery_alert_sent_for_period: null,
        });
        console.log(`Period notification ${config.id} sent for period ${endDate}`);
        return;
      }
      lastError = result.error || 'send failed';
      if (attempt < PERIOD_SMTP_ATTEMPTS) await sleep(PERIOD_SMTP_RETRY_DELAY_MS);
    }

    await config.update({
      schedule_failure_period_end: endDate,
      schedule_failure_summary: String(lastError).slice(0, 512),
      schedule_failure_last_attempt_at: new Date(),
    });
  }
}

module.exports = new SchedulerService();
