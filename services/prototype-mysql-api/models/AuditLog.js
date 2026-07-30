'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AuditLog extends Model {
    static associate(models) {
      AuditLog.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }
  AuditLog.init(
    {
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(64), allowNull: false },
      entity_type: { type: DataTypes.STRING(64), allowNull: true },
      entity_id: { type: DataTypes.STRING(64), allowNull: true },
      details: { type: DataTypes.TEXT, allowNull: true },
      ip_address: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'audit_logs',
      underscored: true,
      updatedAt: false,
    },
  );
  return AuditLog;
};
