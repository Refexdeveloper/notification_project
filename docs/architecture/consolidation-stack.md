# Consolidated Production Stack

Single path for Refex User Engagement Report Engine after Phase 1 consolidation.

## Use this (only)

| Layer | Component | Location |
|-------|-----------|----------|
| **Cloud** | GCP Cloud Run, Cloud SQL, Secret Manager, IAP | `asia-south1`, project `master-diorama-489103-u2` |
| **Database** | PostgreSQL `engagement_reporting` | `db/migrations/` |
| **API** | Express OpenAPI v1 | `services/backend-api` (:8080) |
| **UI** | React Admin UI (backend mode) | `apps/admin-ui` (`VITE_USE_BACKEND_API=true`) |
| **Pipeline** | Bash runbooks (legacy monolith until cutover) | `services/engagement-pipeline/` |

```
Kissflow → engagement-pipeline runbooks → PostgreSQL
Admin UI → backend-api → PostgreSQL
```

## Retired

| Component | Was | Now |
|-----------|-----|-----|
| MySQL | `notification_engine` on localhost:3306 | **Archived** → `archive/prototype-mysql-api/` |
| Prototype API | Express :4000 | **Archived** (same folder) |
| Vite proxy | `/api` → `:4000` | **Removed** — only `/api/v1` → `:8080` |
| Prototype UI mode | Global tabs, localStorage schedulers | **Hidden** when `VITE_USE_BACKEND_API=true` |

## Legacy (keep until cutover)

- Cloud Run: `aasik-refex-report-itsm-a00-svcreq-a00-full-pipeline`
- Cloud Scheduler on legacy pipeline
- Do **not** delete until shadow comparison passes — see `deployment-and-cutover.md`

## Local dev

```bash
# 1. PostgreSQL + migrations
# 2. Backend API
cd services/backend-api && cp .env.example .env && npm run dev

# 3. Admin UI (backend mode — default)
cd apps/admin-ui && cp .env.example .env.local && npm run dev
```

Do **not** start MySQL or the archived prototype API.

## GCP shadow deploy (Phase 2)

Runbook **28** deploys `backend-api` + `admin-ui` to Cloud Run with `--no-traffic` (no scheduler changes):

```bash
bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh plan
DEPLOY_APPROVED=true BACKEND_API_URL=https://YOUR-BACKEND.run.app/api/v1 \
  bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh deploy
```

Images are built via Docker or `cloudbuild/services.yaml`.

## Cutover sequence (after shadow)

1. Shadow ingest + report checksum compare
2. Test recipients only
3. Pause old Cloud Scheduler
4. Enable new schedules
5. Observe 7+ days
6. Decommission legacy full-pipeline service

See `deployment-and-cutover.md`.
