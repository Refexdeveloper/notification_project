'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Role extends Model {
    static associate(models) {
      Role.hasMany(models.User, { foreignKey: 'role_id', as: 'users' });
    }
  }
  Role.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      description: DataTypes.STRING,
    },
    {
      sequelize,
      modelName: 'Role',
      tableName: 'roles',
      underscored: true,
      indexes: [{ name: 'ux_roles_name', unique: true, fields: ['name'] }],
    },
  );
  return Role;
};
