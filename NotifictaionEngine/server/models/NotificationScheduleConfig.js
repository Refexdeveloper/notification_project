'use strict';
const { Model } = require('sequelize');

/**
 * Final-MIS-style scheduled notification config (singleton pattern).
 * Used for period reports / digests with idempotent delivery.
 */
module.exports = (sequelize, DataTypes) => {
  class NotificationScheduleConfig extends Model {
    static associate() {}
  }
  NotificationScheduleConfig.init(
    {
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
        defaultValue: 'Default scheduled notification',
      },
      to_emails: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '[]',
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: 'Scheduled Notification',
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'HTML with {{report_period}}, {{from_date}}, {{to_date}}, {{generated_datetime}}',
      },
      schedule_type: {
        type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'quarterly'),
        allowNull: false,
        defaultValue: 'daily',
      },
      schedule_time: {
        type: DataTypes.STRING(10),
        allowNull: true,
        defaultValue: '09:00',
      },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: false },
      last_sent_at: { type: DataTypes.DATE, allowNull: true },
      last_successful_period_end: {
        type: DataTypes.STRING(10),
        allowNull: true,
        comment: 'YYYY-MM-DD idempotency key',
      },
      schedule_failure_period_end: { type: DataTypes.STRING(10), allowNull: true },
      schedule_failure_summary: { type: DataTypes.STRING(512), allowNull: true },
      schedule_failure_last_attempt_at: { type: DataTypes.DATE, allowNull: true },
      delivery_alert_sent_for_period: { type: DataTypes.STRING(10), allowNull: true },
    },
    {
      sequelize,
      modelName: 'NotificationScheduleConfig',
      tableName: 'notification_schedule_configs',
      underscored: true,
    },
  );
  return NotificationScheduleConfig;
};
