/**
 * Playwright smoke: per-app schedule routing + Test email button.
 *
 * Run:
 *   ADMIN_UI_URL=https://refex-admin-ui-645830234926.asia-south1.run.app \
 *   node ops/tests/schedule-routing-smoke.mjs
 *
 * Local:
 *   npm run dev:admin-ui   # in another terminal
 *   ADMIN_UI_URL=http://localhost:5173 node ops/tests/schedule-routing-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.ADMIN_UI_URL || 'http://localhost:5173';
const APPS = {
  pm: {
    path: '/applications/production-Project_Management_Tracker_A00?tab=schedulers',
    label: 'Project Management',
    expectTemplate: /project|pm|task/i,
    rejectTemplate: /itsm|service request|signin report/i,
  },
  itsm: {
    path: '/applications/production-IT_Service_Management_A00?tab=schedulers',
    label: 'IT Service Management',
    expectTemplate: /itsm|engagement|signin|service/i,
    rejectTemplate: /project task engagement/i,
  },
};

const checks = [];
const failures = [];

function pass(name, detail = '') {
  checks.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  checks.push({ name, ok: false, detail });
  failures.push({ name, detail });
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function seedSession(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('ne_access_token', 'backend-session');
    localStorage.setItem(
      'ne_auth_user',
      JSON.stringify({ name: 'Dev Operator', email: 'dev@refex.co.in', role: 'ADMIN' }),
    );
    localStorage.setItem('ne_apps_environment', 'Production');
  });
}

async function inspectSchedulersTab(page, spec) {
  await seedSession(page);
  await page.goto(`${BASE}${spec.path}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);

  const mainText = await page.locator('main').innerText();
  if (/Could not load schedules/i.test(mainText)) {
    fail(`${spec.label}: schedules tab loads`, mainText.slice(0, 120).replace(/\s+/g, ' '));
    return null;
  }
  pass(`${spec.label}: schedules tab loads`);

  if (spec.expectTemplate.test(mainText)) {
    pass(`${spec.label}: shows expected template family`, spec.expectTemplate.toString());
  } else if (/No schedules for this app/i.test(mainText)) {
    pass(`${spec.label}: no schedules seeded (skipped template assertion)`);
    return mainText;
  } else {
    fail(`${spec.label}: shows expected template family`, mainText.slice(0, 160).replace(/\s+/g, ' '));
  }

  if (spec.rejectTemplate.test(mainText) && !/No schedules/i.test(mainText)) {
    fail(`${spec.label}: does not show wrong-app template`, mainText.slice(0, 160).replace(/\s+/g, ' '));
  } else {
    pass(`${spec.label}: no wrong-app template in list`);
  }

  return mainText;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
  });

  try {
    for (const [key, spec] of Object.entries(APPS)) {
      const body = await inspectSchedulersTab(page, spec);
      if (!body || /No schedules for this app/i.test(body)) continue;

      const scheduleButton = page.locator('button.surface').filter({ hasText: /Template:/i }).first();
      if (!(await scheduleButton.count())) {
        fail(`${spec.label}: schedule row clickable`, 'No schedule rows found');
        continue;
      }

      await scheduleButton.click();
      await page.waitForTimeout(800);

      const testBtn = page.getByRole('button', { name: 'Test email' });
      if (await testBtn.isVisible()) {
        pass(`${spec.label}: Test email button visible`);
      } else {
        fail(`${spec.label}: Test email button visible`);
      }

      const editorText = await page.locator('.surface').filter({ hasText: 'Save schedule' }).innerText();
      if (key === 'pm' && /IT_Service_Management|Live_IT_Service_Request/i.test(editorText)) {
        fail(`${spec.label}: editor identity is PM not ITSM`, editorText.slice(0, 120).replace(/\s+/g, ' '));
      } else if (key === 'itsm' && /Project_Management_Tracker|Project_Sub_Task/i.test(editorText)) {
        fail(`${spec.label}: editor identity is ITSM not PM`, editorText.slice(0, 120).replace(/\s+/g, ' '));
      } else {
        pass(`${spec.label}: editor shows app-appropriate process/template`);
      }
    }
  } catch (err) {
    fail('Schedule routing smoke runner', err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }

  console.log('\n---');
  console.log(`Passed: ${checks.filter((c) => c.ok).length}/${checks.length}`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main();
