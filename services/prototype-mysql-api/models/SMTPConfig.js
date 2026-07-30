'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class SMTPConfig extends Model {
    static associate() {}
  }
  SMTPConfig.init(
    {
      host: { type: DataTypes.STRING, allowNull: false },
      port: { type: DataTypes.INTEGER, defaultValue: 587 },
      secure: { type: DataTypes.BOOLEAN, defaultValue: false },
      auth_user: { type: DataTypes.STRING, allowNull: false },
      auth_pass: { type: DataTypes.STRING, allowNull: false },
      from_email: { type: DataTypes.STRING, allowNull: false },
      from_name: { type: DataTypes.STRING, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'SMTPConfig',
      tableName: 'smtp_configs',
      underscored: true,
      timestamps: true,
    },
  );
  return SMTPConfig;
};
