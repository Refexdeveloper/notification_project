'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

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
