'use strict';
const { Model } = require('sequelize');

/** A Kissflow process / board / dataform registered under an Application. */
module.exports = (sequelize, DataTypes) => {
  class KissflowResource extends Model {
    static associate(models) {
      KissflowResource.belongsTo(models.Application, {
        foreignKey: 'application_id',
        as: 'application',
      });
      KissflowResource.hasMany(models.KissflowField, {
        foreignKey: 'kissflow_resource_id',
        as: 'fields',
      });
    }
  }
  KissflowResource.init(
    {
      application_id: { type: DataTypes.INTEGER, allowNull: false },
      resource_type: {
        type: DataTypes.ENUM('process', 'board', 'dataform'),
        allowNull: false,
        defaultValue: 'process',
      },
      /** Kissflow resource id e.g. Lead_tracker_1_A00 */
      resource_id: { type: DataTypes.STRING(128), allowNull: false },
      admin_process_id: { type: DataTypes.STRING(128), allowNull: true },
      display_name: { type: DataTypes.STRING, allowNull: true },
      item_count: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
      last_sync_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'KissflowResource',
      tableName: 'kissflow_resources',
      underscored: true,
      indexes: [
        {
          name: 'ux_kissflow_resources_app_type_rid',
          unique: true,
          fields: ['application_id', 'resource_type', 'resource_id'],
        },
      ],
    },
  );
  return KissflowResource;
};
