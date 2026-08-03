# Release Notes — Production Hardening (July 2026)

Summary of work shipped on branch `feature/template-sync-dashboard-perf` and deployed to GCP Cloud Run.

**Production URLs**

| Service | URL |
|---------|-----|
| Admin UI | `https://refex-admin-ui-645830234926.asia-south1.run.app` |
| Backend API | `https://refex-backend-api-645830234926.asia-south1.run.app` |
| Schedule runner | `https://refex-schedule-runner-645830234926.asia-south1.run.app` |

**Deployed revisions (post CORS fix)**

| Service | Revision | Commit |
|---------|----------|--------|
| Admin UI | `refex-admin-ui-00027-j2s` | `1615ad1` |
| Backend API | `refex-backend-api-00036-pvl` | `1615ad1` |
| Schedule runner | `refex-schedule-runner-00015-jjh` | `19dcd45` |

Deploy runbook: `ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh`

---

## Admin UI fixes

### Same-origin API proxy (CORS / network errors)

**Problem:** Browser fetched `refex-backend-api-...run.app` from `refex-admin-ui-...run.app`. Cross-origin requests failed (CORS / IAP), showing:

> Network error — check API URL and CORS (Admin UI must reach backend-api).

**Fix:**

- Admin UI nginx proxies `/api/v1/` to backend-api (`apps/admin-ui/nginx.conf.template`)
- Vite build uses relative `VITE_API_BASE_URL=/api/v1`
- Backend CORS hardened as fallback (`services/backend-api/src/lib/cors.js`)

**Verify:**

```bash
curl https://refex-admin-ui-645830234926.asia-south1.run.app/api/v1/health
curl https://refex-admin-ui-645830234926.asia-south1.run.app/api/v1/dashboard
```

DevTools Network tab should show requests to `/api/v1/...` on the **Admin UI host**, not cross-origin to backend-api.

### Application route ID parsing

**Problem:** App detail URLs use route ids like `production-Project_Management_Tracker_A00`. Frontend sent the full route id to the API instead of the Kissflow `application_id`, so pages loaded empty.

**Fix:** `resolveBackendApplicationId()` in `apps/admin-ui/src/services/applicationsApi.ts` strips the `{environment}-` prefix before API calls.

### Global `/templates` page

**Problem:** `PrototypeOnlyGate` blocked `/templates` in backend mode.

**Fix:** Route wired to backend API; gate removed from router. Template editor supports version history and test email via linked schedule.

### Dashboard performance

- Removed send history section from dashboard landing
- Parallel app queries on backend (`services/backend-api/src/routes/dashboard.js`)
- Lighter UI (reduced heavy animation); session cache for faster repeat loads

---

## Backend API fixes

### Template API

- Version history endpoints
- Delete guards when template is linked to an active schedule
- Cache invalidation on publish/update

Files: `services/backend-api/src/routes/templates.js`, `services/backend-api/src/lib/templateRepository.js`

### Dashboard API

- Removed `recent_sends` query from dashboard aggregate
- Parallel per-application metric queries

File: `services/backend-api/src/routes/dashboard.js`

---

## Engagement pipeline fixes

### PM completed-task counts

**Problem:** Incremental PM ingest could drop completed tasks when Kissflow returned a partial snapshot.

**Fix:** Merge completed tasks from prior snapshot during incremental ingest.

Files:

- `services/engagement-pipeline/ops/runbooks/12-ingest-pm-and-load.sh`
- `services/engagement-pipeline/ops/runbooks/ingest-sync-lib.sh`

### Report rendering from PostgreSQL templates

ITSM, PM, and Lead Tracker renders use PostgreSQL templates via `TEMPLATE_ID` and `report-template-lib.sh` instead of seed-only HTML.

Lead Tracker service: `services/engagement-pipeline/lib/leadReportService.js`

### Test email fallback

Scheduled test send can use last cached report without forcing a Kissflow refresh when appropriate.

File: `services/engagement-pipeline/ops/runbooks/19-dispatch-scheduled-report.sh`

### ITSM branding

Force RefexOne logo in ITSM HTML reports (`05dc503`).

---

## Cloud Build / deploy

- `apps/admin-ui/package-lock.json` synced for Cloud Build `npm ci`
- Runbook 28 updated for `BACKEND_UPSTREAM_URL` / `BACKEND_HOST` on Admin UI container
- `cloudbuild/services.yaml` passes proxy env vars at build/deploy time

---

## Commit history (feature branch)

| Commit | Summary |
|--------|---------|
| `19dcd45` | Template sync, PM ingest fixes, dashboard perf, pipeline hardening |
| `8eb473e` | Fix admin-ui package-lock for Cloud Build |
| `c789fd7` | Fix API route id parsing; unblock `/templates` |
| `1615ad1` | Same-origin nginx `/api/v1` proxy + CORS hardening |

---

## Intentionally not included

Per project scope decisions:

| Item | Status |
|------|--------|
| Combined report full template sync (`11-render-combined-report.sh`) | Not done |
| Block editor (HTML ↔ blocks converter) | Not in scope |

---

## Post-deploy verification checklist

- [ ] Hard refresh Admin UI (Cmd+Shift+R)
- [ ] Dashboard loads application cards with metrics
- [ ] App detail pages load engagement data (`/applications/production-{appId}`)
- [ ] `/templates` lists and edits templates with version history
- [ ] Test email from Schedulers tab succeeds
- [ ] PM tracker shows correct completed task counts after ingest
- [ ] API proxy health: `GET /api/v1/health` on Admin UI host returns 200

---

## Related documentation

- [Onboarding a new application](../onboarding-new-application.md)
- [Deployment and cutover](../architecture/deployment-and-cutover.md)

---

## Follow-up — Aug 2026 (ITSM empty table + placeholders)

### ITSM 11:00 / 13:00 empty user table

**Cause:** Incremental ITSM ingest wrote a sparse “latest” snapshot (delta-only tickets). Render filters `entity = Refex` and drops users with zero open/closed tickets → blank `{{UserTableHtml}}` and zero ticket KPIs. 09:00 looked fine when it still ran against a full snapshot (or legacy full pipeline).

**Fix:**

- Carry-forward prior items/assignments in `09-ingest-and-load.sh` (same pattern as PM)
- Prefer richest completed snapshot in last 7 days as merge base (`ingest_get_best_base_snapshot_run_id`)
- Empty-table fallback message in `06-render-html-report.sh`

### Template placeholder picker

Template editor now shows click-to-insert pipeline placeholders and warns when tokens are not filled at send time.
