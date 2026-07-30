const mysql = require('mysql2/promise');
require('dotenv').config();
const config = require('../config/config.js')[process.env.NODE_ENV || 'development'];

async function createDatabase() {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
  });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\`;`);
  console.log(`Database '${config.database}' created or already exists.`);
  await connection.end();
}

createDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
