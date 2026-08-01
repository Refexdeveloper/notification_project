# Refex User Engagement Report Engine

Production-grade monorepo: Admin UI + PostgreSQL engagement pipeline on GCP.

## Architecture (consolidated)

```
Kissflow APIs → engagement-pipeline runbooks → Cloud SQL (engagement_reporting)
Admin UI (apps/admin-ui) → backend-api (OpenAPI v1) → PostgreSQL ONLY
```

**Single production path:** GCP + PostgreSQL + `backend-api` + `admin-ui` (backend mode).  
MySQL prototype is archived under `archive/prototype-mysql-api/`.

See `docs/architecture/consolidation-stack.md` for full stack decision.

## Repository layout

| Path | Purpose |
|------|---------|
| `apps/admin-ui/` | React Admin UI — **backend-api mode only** in dev/prod |
| `services/backend-api/` | Authoritative OpenAPI v1 API (Express, PostgreSQL) |
| `services/engagement-pipeline/` | Bash/Python ingest + render + send (legacy until cutover) |
| `archive/prototype-mysql-api/` | **Archived** MySQL prototype — salvage only |
| `db/migrations/` | PostgreSQL canonical schema |
| `openapi/backend-api.yaml` | Authoritative FE/BE contract v1 |
| `config/secrets.manifest.yaml` | Secret Manager bindings (no values) |
| `cloudbuild/` | Validation, migration, service build pipelines |
| `ops/runbooks/` | Idempotent operational runbooks |
| `docs/architecture/` | Architecture and convergence docs |
| `docs/onboarding-new-application.md` | Connect application → templates → schedules → ingest |
| `docs/release-notes/` | Shipped changes and production verification |
| `tests/` | Repository-level automated checks |

## Quick start (local)

```bash
# Backend API (PostgreSQL — OpenAPI v1)
cd services/backend-api
cp .env.example .env   # set PG* vars
npm install
npm run dev            # http://localhost:8080/api/v1/health

# Admin UI (proxies /api/v1 → backend-api only)
cd apps/admin-ui
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:8080/api/v1
# VITE_USE_BACKEND_API=true
npm install && npm run dev   # http://localhost:3000
```

Do **not** start MySQL or the archived prototype API.

## Runbooks

| # | Script | Purpose |
|---|--------|---------|
| 01 | `01-inspect-repository-convergence-state.sh` | Read-only repo assessment |
| 02 | `02-secret-and-sensitive-data-preflight.sh` | Secret scan |
| 02b | `02b-remediate-secret-blockers.sh` | Remove blockers from index + source |
| 03 | `03-frontend-backend-repository-convergence.sh` | Monorepo layout |
| 05 | `05-mysql-prototype-salvage-dry-run.sh` | MySQL → PostgreSQL dry-run |
| 28 | `28-deploy-backend-api-and-admin-ui-shadow.sh` | **Shadow GCP deploy** (no scheduler cutover) |
| 29 | `29-shadow-compare-cloud-vs-legacy.sh` | Read-only cloud vs legacy counts |
| 30 | `30-iap-load-balancer-setup.sh` | IAP + HTTPS LB (production auth) |
| 31 | `31-scheduler-cutover-checklist.sh` | Scheduler cutover (requires CUTover_APPROVED) |
| 32 | `32-deploy-schedule-runner.sh` | Deploy `refex-schedule-runner` Cloud Run |
| 32 | `32-provision-schedulers-from-postgresql.sh` | Sync Cloud Scheduler jobs from PostgreSQL |
| 33 | `33-test-schedule-send.sh` | Manual test send for one `SCHEDULE_ID` |

Legacy pipeline runbooks 01–18 remain under `services/engagement-pipeline/ops/runbooks/`.

## Deployment

Cloud Build: `cloudbuild/services.yaml` builds `backend-api`, `admin-ui`, `engagement-pipeline`.

**Shadow deploy (requires `DEPLOY_APPROVED=true`):**

```bash
bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh plan
```

Do **not** activate schedulers or delete the legacy full-pipeline service without controlled cutover — see `docs/architecture/deployment-and-cutover.md`.

## Security

- All secrets via Google Secret Manager — see `config/secrets.manifest.yaml`
- Frontend receives **no secrets**
- Customer discovery data and generated HTML are **gitignored**
- Never commit `.env`, `.env.local`, or `notification_engine.json`

## Documentation

| Doc | Purpose |
|-----|---------|
| [Onboarding a new application](docs/onboarding-new-application.md) | Connect Kissflow app, APIs called, PostgreSQL records, ingest |
| [Production hardening (Jul 2026)](docs/release-notes/2026-07-31-production-hardening.md) | CORS fix, dashboard perf, template sync, PM ingest |
| [Deployment and cutover](docs/architecture/deployment-and-cutover.md) | Shadow deploy → scheduler cutover |

## Status

- **Done:** Admin UI same-origin `/api/v1` proxy; backend-api + PostgreSQL production path
- **Done:** Template sync, PM ingest fixes, dashboard perf, Lead Tracker on PostgreSQL
- **Done:** MySQL prototype archived; single local dev proxy path
- **Next:** Merge feature branch to `main`; optional combined report template sync
