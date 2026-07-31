/**
 * API end-to-end smoke (no browser). Verifies core production paths.
 *
 *   BACKEND_API_URL=https://refex-backend-api-....run.app/api/v1 node ops/tests/e2e-api-smoke.mjs
 */
const BASE = (process.env.BACKEND_API_URL || 'https://refex-backend-api-645830234926.asia-south1.run.app/api/v1').replace(/\/$/, '');

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

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const health = await getJson('/health');
  if (health.ok && health.data?.success !== false) {
    pass('GET /health', String(health.status));
  } else {
    fail('GET /health', JSON.stringify(health.data).slice(0, 120));
  }

  const apps = await getJson('/applications?environment=production');
  const appItems = apps.data?.data?.items ?? apps.data?.data ?? [];
  const appCount = Array.isArray(appItems) ? appItems.length : 0;
  if (apps.ok && appCount > 0) {
    pass('GET /applications', `${appCount} apps`);
  } else {
    fail('GET /applications', `status=${apps.status}`);
  }

  const dash = await getJson('/dashboard?environment=production');
  const dashApps = dash.data?.data?.applications ?? [];
  const sends = dash.data?.data?.recent_sends ?? [];
  if (dash.ok && dashApps.length > 0) {
    pass('GET /dashboard', `${dashApps.length} apps, ${sends.length} recent sends`);
  } else {
    fail('GET /dashboard', JSON.stringify(dash.data?.error || dash.data).slice(0, 120));
  }

  const hist = await getJson('/history?environment=production&limit=50');
  const histItems = hist.data?.data?.items ?? [];
  if (hist.ok && histItems.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = histItems.filter((i) => String(i.sent_at || '').startsWith(today)).length;
    pass('GET /history', `${histItems.length} rows, ${todayCount} today (UTC date)`);
  } else {
    fail('GET /history', `items=${histItems.length}`);
  }

  for (const appId of ['IT_Service_Management_A00', 'Project_Management_Tracker_A00', 'Lead_Trcaker_A00']) {
    const appHist = await getJson(
      `/applications/${encodeURIComponent(appId)}/history?environment=production&sends_only=true`,
    );
    const items = appHist.data?.data?.items ?? [];
    if (appHist.ok) {
      pass(`GET /applications/${appId}/history`, `${items.length} sends`);
    } else {
      fail(`GET /applications/${appId}/history`, String(appHist.status));
    }
  }

  if (process.env.RUN_TEST_SEND === 'true') {
    const testSend = await fetch(
      `${BASE}/applications/IT_Service_Management_A00/schedules/55555555-5555-4555-8555-555555555555/test-send?environment=production`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-auth-email': 'dev@refex.co.in',
          'x-dev-auth-name': 'Dev Operator',
          'x-dev-auth-role': 'ADMIN',
        },
        body: JSON.stringify({ test_recipient: 'mohamedaasik.m@refex.co.in' }),
      },
    );
    const testBody = await testSend.json().catch(() => ({}));
    if (testSend.ok && testBody.data?.dispatched) {
      pass('POST test-send (ITSM)', testBody.data?.status || 'ok');
    } else {
      fail('POST test-send (ITSM)', JSON.stringify(testBody.error || testBody).slice(0, 160));
    }
  } else {
    pass('POST test-send (ITSM)', 'skipped (set RUN_TEST_SEND=true to run)');
  }

  console.log('\n---');
  console.log(`Passed: ${checks.filter((c) => c.ok).length}/${checks.length}`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  fail('e2e-api-smoke runner', err.message);
  process.exit(1);
});
