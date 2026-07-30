require('dotenv').config();
const db = require('../models');

db.sequelize
  .authenticate()
  .then(() => db.sequelize.sync({ alter: true }))
  .then(() => {
    console.log('Sync OK');
    return db.sequelize.close();
  })
  .catch(async (err) => {
    console.error(err);
    process.exit(1);
  });
