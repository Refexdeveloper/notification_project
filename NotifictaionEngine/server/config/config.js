require('dotenv').config();

const pool = {
  max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : 10,
  min: process.env.DB_POOL_MIN ? Number(process.env.DB_POOL_MIN) : 0,
  acquire: process.env.DB_POOL_ACQUIRE ? Number(process.env.DB_POOL_ACQUIRE) : 30000,
  idle: process.env.DB_POOL_IDLE ? Number(process.env.DB_POOL_IDLE) : 10000,
};

const password =
  process.env.DB_PASS || process.env.DB_PASSWORD || 'RefexAdmin@123';

const base = {
  username: process.env.DB_USER || 'raghul',
  password,
  database: process.env.DB_NAME || 'notification_engine',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  dialect: 'mysql',
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,
  pool,
  timezone: '+05:30',
};

module.exports = {
  development: { ...base },
  test: { ...base },
  production: { ...base },
};
