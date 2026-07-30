'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EmailTemplate extends Model {
    static associate() {}
  }
  EmailTemplate.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      subject: { type: DataTypes.STRING, allowNull: false },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'HTML body with {{variable}} placeholders',
      },
      description: { type: DataTypes.STRING, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'EmailTemplate',
      tableName: 'email_templates',
      underscored: true,
      indexes: [{ name: 'ux_email_templates_name', unique: true, fields: ['name'] }],
    },
  );
  return EmailTemplate;
};
