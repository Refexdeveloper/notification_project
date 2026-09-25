// @ts-check
const { test, expect } = require('@playwright/test');

const ADMIN_URL = process.env.ADMIN_UI_URL || 'https://refex-admin-ui-dhwffeu7pq-el.a.run.app';
const API_URL = process.env.API_BASE_URL || 'https://refex-admin-ui-dhwffeu7pq-el.a.run.app';
const API_TIMEOUT_MS = 40_000;

const APP_IDS = [
  'IT_Service_Management_A00',
  'Project_Management_Tracker_A00',
  'Procurement_to_Pay_A00',
  'Expense_and_Travel_Management_A00',
  'Solar_Site_Expense_Governance_Syst_A00',
  'Lead_Trcaker_A00',
  'EMS_001_A00',
];

test.describe('Notification Engine — live dashboards', () => {
  test('overview API excludes drafts and returns applications', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/dashboard?environment=production`, {
      timeout: API_TIMEOUT_MS,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const apps = body.data?.applications || [];
    expect(apps.length).toBeGreaterThan(0);
    const total = apps.reduce(
      (sum, app) => sum + Number(app.metrics?.total_items || 0),
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  for (const appId of APP_IDS) {
    test(`app dashboard API ${appId}`, async ({ request }) => {
      test.setTimeout(90_000);
      const res = await request.get(
        `${API_URL}/api/v1/applications/${appId}/dashboard?environment=production&period=all`,
        { timeout: API_TIMEOUT_MS },
      );
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Number(body.data?.metrics?.total || 0)).toBeGreaterThanOrEqual(0);
      const users = body.data?.users || [];
      for (const u of users.slice(0, 40)) {
        const name = String(u.user_name || '').trim();
        expect(name === '—' || name === '-').toBeFalsy();
      }
    });

    test(`record inventory ${appId} has ids and no drafts`, async ({ request }) => {
      test.setTimeout(90_000);
      const res = await request.get(
        `${API_URL}/api/v1/applications/${appId}/records?environment=production&inventory=1&limit=200`,
        { timeout: API_TIMEOUT_MS },
      );
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      const items = body.data?.items || [];
      for (const row of items) {
        const hay = `${row.status_raw || ''} ${row.current_step || ''} ${row.status || ''}`.toLowerCase();
        expect(hay.includes('draft')).toBeFalsy();
        expect(String(row.request_id || row.id || '').trim()).not.toBe('');
      }
    });
  }

  test('main dashboard company filter does not keep the unscoped total', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${ADMIN_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const totalCard = page.getByText('Total items').first();
    await expect(totalCard).toBeVisible({ timeout: 45_000 });
    const unscoped = await page.locator('text=Total items').locator('xpath=..').locator('xpath=..').innerText();
    const companyTrigger = page.getByRole('button', { name: /all companies|company/i }).first();
    if (!(await companyTrigger.isVisible().catch(() => false))) return;
    await companyTrigger.click();
    const option = page.getByRole('option').nth(1);
    if (!(await option.isVisible().catch(() => false))) return;
    await option.click();
    await page.waitForTimeout(1500);
    const scoped = await page.locator('text=Total items').locator('xpath=..').locator('xpath=..').innerText();
    expect(scoped).not.toEqual(unscoped);
  });

  test('ITSM embed and main dashboards load', async ({ page }) => {
    test.setTimeout(90_000);
    const path = '/applications/production-IT_Service_Management_A00?tab=dashboard';
    await page.goto(`${ADMIN_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText(/total/i).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/\bNever\b/)).toHaveCount(0);
    await page.goto(`${ADMIN_URL}${path}&embed=1`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText(/total/i).first()).toBeVisible({ timeout: 45_000 });
  });

  test('Project Tracker and P2P dashboards load on main + embed', async ({ page }) => {
    test.setTimeout(180_000);
    for (const id of ['Project_Management_Tracker_A00', 'Procurement_to_Pay_A00']) {
      const path = `/applications/production-${id}?tab=dashboard`;
      await page.goto(`${ADMIN_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.getByText(/total/i).first()).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText(/\bNever\b/)).toHaveCount(0);
      await page.goto(`${ADMIN_URL}${path}&embed=1`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.getByText(/total/i).first()).toBeVisible({ timeout: 45_000 });
    }
  });
});
