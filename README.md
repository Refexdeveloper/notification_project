# Refex User Engagement Report Engine

Production-grade monorepo converging Raghul's Admin UI and Ashiq's PostgreSQL engagement pipeline into a deployable platform.

## Architecture

```
Kissflow APIs → ingestion-worker → Cloud SQL (engagement_reporting)
              → report-orchestrator → email-renderer → GCS artifact
              → notification_outbox → email-dispatcher → delivery ledger
              → async BigQuery publication

Admin UI (apps/admin-ui) → backend-api (OpenAPI v1) ONLY
```

## Repository layout

| Path | Purpose |
|------|---------|
| `apps/admin-ui/` | React Admin UI (Raghul) |
| `services/engagement-pipeline/` | Bash/Python ingest + render + send (Ashiq) |
| `services/prototype-mysql-api/` | Legacy MySQL prototype — **salvage only, not production** |
| `db/migrations/` | PostgreSQL canonical schema |
| `openapi/backend-api.yaml` | Authoritative FE/BE contract v1 |
| `config/secrets.manifest.yaml` | Secret Manager bindings (no values) |
| `cloudbuild/` | Validation, migration, service build pipelines |
| `ops/runbooks/` | Idempotent operational runbooks |
| `docs/architecture/` | Architecture and convergence docs |
| `tests/` | Repository-level automated checks |

## Quick start (local)

```bash
# Backend API (PostgreSQL — OpenAPI v1)
cd services/backend-api
cp .env.example .env   # set PG* vars if PostgreSQL available
npm install
npm run dev            # http://localhost:8080/api/v1/health

# Admin UI (proxies /api/v1 → backend-api, /api → legacy prototype)
cd apps/admin-ui
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:8080/api/v1
npm install && npm run dev
```

## Runbooks

| # | Script | Purpose |
|---|--------|---------|
| 01 | `01-inspect-repository-convergence-state.sh` | Read-only repo assessment |
| 02 | `02-secret-and-sensitive-data-preflight.sh` | Secret scan |
| 02b | `02b-remediate-secret-blockers.sh` | Remove blockers from index + source |
| 03 | `03-frontend-backend-repository-convergence.sh` | Monorepo layout |
| 05 | `05-mysql-prototype-salvage-dry-run.sh` | MySQL → PostgreSQL dry-run |

Legacy pipeline runbooks 01–13 remain under `services/engagement-pipeline/ops/runbooks/`.

## Deployment

Cloud Build definitions in `cloudbuild/` prepare validation and image builds. **Do not deploy or activate schedulers without controlled cutover** — see `docs/architecture/deployment-and-cutover.md`.

## Security

- All secrets via Google Secret Manager — see `config/secrets.manifest.yaml`
- Frontend receives **no secrets**
- Customer discovery data and generated HTML are **gitignored**
- Never commit `.env`, `.env.local`, or `notification_engine.json`

## Status

This branch prepares a reviewable convergence PR. Production readiness requires shadow comparison, idempotency tests, DLQ recovery validation, and scheduler cutover — not yet executed.
