'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EmailScheduler extends Model {
    static associate(models) {
      EmailScheduler.belongsTo(models.EmailTemplate, {
        foreignKey: 'template_id',
        as: 'template',
      });
    }
  }
  EmailScheduler.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      /** Client schedule id (e.g. sch-…) for upsert from the UI */
      external_id: { type: DataTypes.STRING(96), allowNull: true, unique: true },
      cron_expression: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '0 9 * * *',
      },
      job_type: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'e.g. template_send, report_send, engagement_digest',
      },
      template_id: { type: DataTypes.INTEGER, allowNull: true },
      to_emails: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'JSON array of recipients',
      },
      cc_emails: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'JSON array of CC recipients',
      },
      subject: { type: DataTypes.STRING(512), allowNull: true },
      html_body: { type: DataTypes.TEXT('long'), allowNull: true },
      meta: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'JSON: cadence, applicationId, timezone, etc.',
      },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      last_run_at: { type: DataTypes.DATE, allowNull: true },
      last_status: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      sequelize,
      modelName: 'EmailScheduler',
      tableName: 'email_schedulers',
      underscored: true,
    },
  );
  return EmailScheduler;
};
