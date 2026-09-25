// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/playwright',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  reporter: [['list']],
});
