// @ts-check
const { test, expect } = require('@playwright/test');

const ADMIN_URL = process.env.ADMIN_UI_URL || 'https://refex-admin-ui-dhwffeu7pq-el.a.run.app';
const API_TIMEOUT_MS = 25_000;

test.describe('Admin UI — dashboard smoke', () => {
  test('API health via same-origin proxy responds quickly', async ({ request }) => {
    const res = await request.get(`${ADMIN_URL}/api/v1/health`, { timeout: API_TIMEOUT_MS });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.status).toBe('alive');
  });

  test('main dashboard API returns applications within timeout', async ({ request }) => {
    const started = Date.now();
    const res = await request.get(`${ADMIN_URL}/api/v1/dashboard?environment=production`, {
      timeout: API_TIMEOUT_MS,
    });
    const elapsed = Date.now() - started;
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data?.applications)).toBe(true);
    expect(body.data.applications.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(API_TIMEOUT_MS);
  });

  test('dashboard page loads without infinite spinner', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`${ADMIN_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /engagement overview/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/could not load dashboard/i)).not.toBeVisible({ timeout: 5_000 });
  });
});
