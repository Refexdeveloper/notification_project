'use strict';
const { Model } = require('sequelize');

/** One discovered Kissflow column/field on a resource (from Admin Get-all-items). */
module.exports = (sequelize, DataTypes) => {
  class KissflowField extends Model {
    static associate(models) {
      KissflowField.belongsTo(models.KissflowResource, {
        foreignKey: 'kissflow_resource_id',
        as: 'resource',
      });
    }
  }
  KissflowField.init(
    {
      kissflow_resource_id: { type: DataTypes.INTEGER, allowNull: false },
      field_name: { type: DataTypes.STRING(191), allowNull: false },
      field_label: { type: DataTypes.STRING(255), allowNull: true },
      field_type: { type: DataTypes.STRING(64), allowNull: true },
      sample_value: { type: DataTypes.TEXT, allowNull: true },
      occurrences: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
      is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'KissflowField',
      tableName: 'kissflow_fields',
      underscored: true,
      indexes: [
        {
          name: 'ux_kissflow_fields_resource_name',
          unique: true,
          fields: ['kissflow_resource_id', 'field_name'],
        },
        { name: 'idx_kissflow_fields_resource_id', fields: ['kissflow_resource_id'] },
      ],
    },
  );
  return KissflowField;
};
