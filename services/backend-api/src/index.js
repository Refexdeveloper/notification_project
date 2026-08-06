'use strict';

const { createApp } = require('./app');
const { initDatabase, isDatabaseConfigured } = require('./lib/db');

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

async function start() {
  if (isDatabaseConfigured()) {
    try {
      await initDatabase();
      console.log(JSON.stringify({ msg: 'database pool initialized' }));
      const { ensureBootstrapAdmin } = require('./lib/platformUsers');
      const bootstrap = await ensureBootstrapAdmin();
      console.log(JSON.stringify({ msg: 'platform bootstrap', ...bootstrap }));
    } catch (err) {
      console.error(JSON.stringify({ msg: 'database init failed', error: err.message }));
    }
  }

  const app = createApp();
  app.listen(port, host, () => {
    console.log(
      JSON.stringify({
        msg: 'backend-api started',
        port,
        host,
        git_sha: process.env.GIT_SHA || 'local',
      }),
    );
  });
}

start();
