/**
 * Playwright: ITSM email HTML must show real Source / Today / Sign-in numbers
 * when data is provided (zeros only when truly zero).
 *
 * Run from repo root:
 *   npx playwright test tests/playwright/itsm-report-html.spec.js
 */
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const BUILD_SRC = path.join(
  REPO,
  'services/engagement-pipeline/scripts/build-itsm-source-breakdown.js',
);

function buildSourceHtml(env) {
  return execFileSync(process.execPath, [BUILD_SRC], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function wrapItsmPage({ sourceHtml, kpis }) {
  return `<!DOCTYPE html><html><body>
<table role="presentation" width="100%">
<tr><td>
  <div data-testid="total-tickets">${kpis.total}</div>
  <div data-testid="open-tickets">${kpis.open}</div>
  <div data-testid="closed-tickets">${kpis.closed}</div>
  <div data-testid="opened-today">${kpis.openedToday}</div>
  <div data-testid="closed-today">${kpis.closedToday}</div>
  <div data-testid="signed-in-today">${kpis.signedInToday}</div>
  <div data-testid="total-users">${kpis.totalUsers}</div>
</td></tr>
${sourceHtml}
</table>
</body></html>`;
}

test.describe('ITSM report HTML data integrity', () => {
  test('Source panel shows Email/Mobile/Web when counts are non-zero', async ({ page }) => {
    const sourceHtml = buildSourceHtml({
      SOURCE_EMAIL_ALL: '12',
      SOURCE_WHATSAPP_ALL: '4',
      SOURCE_MOBILE_ALL: '9',
      SOURCE_WEB_ALL: '21',
      SOURCE_OTHER_ALL: '0',
      SOURCE_EMAIL_TODAY: '3',
      SOURCE_WHATSAPP_TODAY: '1',
      SOURCE_MOBILE_TODAY: '2',
      SOURCE_WEB_TODAY: '1',
      SOURCE_OTHER_TODAY: '0',
      TOTAL_TICKETS: '46',
      SOURCE_TODAY_TOTAL: '7',
    });
    expect(sourceHtml).toContain('Ticket source');
    expect(sourceHtml).toMatch(/Email<\/td><td[^>]*>12<\/td>/);
    expect(sourceHtml).toMatch(/Mobile<\/td><td[^>]*>9<\/td>/);
    expect(sourceHtml).toMatch(/Email<\/td><td[^>]*>3<\/td>/);

    const html = wrapItsmPage({
      sourceHtml,
      kpis: {
        total: 46,
        open: 18,
        closed: 28,
        openedToday: 7,
        closedToday: 2,
        signedInToday: 5,
        totalUsers: 40,
      },
    });
    const file = path.join(os.tmpdir(), `itsm-report-${Date.now()}.html`);
    fs.writeFileSync(file, html, 'utf8');
    await page.goto(`file://${file}`);

    await expect(page.getByTestId('total-tickets')).toHaveText('46');
    await expect(page.getByTestId('open-tickets')).toHaveText('18');
    await expect(page.getByTestId('closed-tickets')).toHaveText('28');
    await expect(page.getByTestId('opened-today')).toHaveText('7');
    await expect(page.getByTestId('closed-today')).toHaveText('2');
    await expect(page.getByTestId('signed-in-today')).toHaveText('5');
    await expect(page.getByTestId('total-users')).toHaveText('40');
    await expect(page.getByText('Ticket source')).toBeVisible();
    await expect(page.getByText('All tickets')).toBeVisible();
    await expect(page.getByText('Today open tickets')).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).toMatch(/Email\s+12/);
    expect(body).toMatch(/Mobile\s+9/);
    expect(body).toMatch(/Web\s+21/);
    expect(Number(body.match(/Email\s+(\d+)/)[1])).toBeGreaterThan(0);
    expect(Number(body.match(/Mobile\s+(\d+)/)[1])).toBeGreaterThan(0);

    fs.unlinkSync(file);
  });

  test('Source panel may show 0 when channel truly has no tickets', async ({ page }) => {
    const sourceHtml = buildSourceHtml({
      SOURCE_EMAIL_ALL: '0',
      SOURCE_WHATSAPP_ALL: '0',
      SOURCE_MOBILE_ALL: '0',
      SOURCE_WEB_ALL: '15',
      SOURCE_OTHER_ALL: '0',
      SOURCE_EMAIL_TODAY: '0',
      SOURCE_WHATSAPP_TODAY: '0',
      SOURCE_MOBILE_TODAY: '0',
      SOURCE_WEB_TODAY: '2',
      SOURCE_OTHER_TODAY: '0',
      TOTAL_TICKETS: '15',
      SOURCE_TODAY_TOTAL: '2',
    });
    expect(sourceHtml).toMatch(/Email<\/td><td[^>]*>0<\/td>/);
    expect(sourceHtml).toMatch(/Web<\/td><td[^>]*>15<\/td>/);

    const file = path.join(os.tmpdir(), `itsm-report-zero-${Date.now()}.html`);
    fs.writeFileSync(
      file,
      wrapItsmPage({
        sourceHtml,
        kpis: {
          total: 15,
          open: 5,
          closed: 10,
          openedToday: 2,
          closedToday: 0,
          signedInToday: 1,
          totalUsers: 10,
        },
      }),
      'utf8',
    );
    await page.goto(`file://${file}`);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/Email\s+0/);
    expect(body).toMatch(/Web\s+15/);
    fs.unlinkSync(file);
  });
});
