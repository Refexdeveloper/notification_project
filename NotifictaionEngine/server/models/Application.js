'use strict';
const { Model } = require('sequelize');

/** Kissflow application registration persisted server-side (moves off localStorage later). */
module.exports = (sequelize, DataTypes) => {
  class Application extends Model {
    static associate(models) {
      Application.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
      Application.hasMany(models.KissflowResource, {
        foreignKey: 'application_id',
        as: 'kissflowResources',
      });
    }
  }
  Application.init(
    {
      /** Client localStorage id e.g. app-refex-lead-tracker-prod */
      external_id: { type: DataTypes.STRING(128), allowNull: true, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      account_id: { type: DataTypes.STRING, allowNull: false },
      app_id: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Kissflow process App ID for Admin APIs (e.g. Lead_tracker_1_A00)',
      },
      subdomain: { type: DataTypes.STRING, allowNull: false },
      region: { type: DataTypes.ENUM('com', 'eu'), defaultValue: 'com' },
      environment: {
        type: DataTypes.ENUM('Development', 'UAT', 'Staging', 'Production'),
        defaultValue: 'Development',
      },
      process_ids: { type: DataTypes.TEXT, allowNull: true, comment: 'JSON array' },
      dataform_ids: { type: DataTypes.TEXT, allowNull: true },
      board_ids: { type: DataTypes.TEXT, allowNull: true },
      access_key_id: { type: DataTypes.STRING, allowNull: true },
      access_key_secret: { type: DataTypes.TEXT, allowNull: true },
      discovered_fields: { type: DataTypes.TEXT('long'), allowNull: true, comment: 'JSON' },
      status: {
        type: DataTypes.ENUM('Active', 'Inactive', 'Maintenance'),
        defaultValue: 'Active',
      },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
      last_sync_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Application',
      tableName: 'applications',
      underscored: true,
    },
  );
  return Application;
};
