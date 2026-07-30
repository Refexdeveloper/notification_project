# Repository Convergence Assessment

**Runbook:** `ops/runbooks/01-inspect-repository-convergence-state.sh`  
**Generated:** 2026-07-30 (inspection pass)  
**Git branch:** `feature/repository-convergence-inspection`  
**Git remote:** `https://github.com/Refexdeveloper/notification_project.git`

---

## Executive summary

This repository currently contains **two independent systems** copied into one Git root without convergence:

| System | Path | Owner (inferred) | Production role |
|--------|------|------------------|-----------------|
| Notification Engine (Admin UI + MySQL prototype backend) | `NotifictaionEngine/` | Raghul (frontend); prototype Express backend | **UI authority** — not production backend |
| Refex Adoption User Report (Bash pipeline + PostgreSQL) | `refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report/` | Ashiq (backend/pipeline) | **Operational reporting authority** — current production path |

There is **no unified backend API**, **no OpenAPI contract**, **no Cloud Build definitions at repo root**, and **no automated tests**. Frontend–backend binding is in progress but currently targets the MySQL prototype, not the PostgreSQL engagement model.

Convergence is **required and feasible**, but blocked on secret hygiene, customer-data retention decisions, and explicit schema/API ownership before structural refactor proceeds.

---

## 1. Canonical business truth (as discovered)

1. **Kissflow** is the system of record for users, process items, and assignments.
2. **PostgreSQL (`engagement_reporting`)** is the intended canonical operational reporting store (per `db/contracts/canonical-load-contract.json`).
3. **MySQL (`notification_engine`)** is a **prototype configuration store** — useful UI patterns, **not** production schema.
4. **BigQuery** is referenced as a derived analytics store — **not implemented** in code.
5. **Email rendering and dispatch** currently live in Bash runbooks inside the combined Cloud Run container — not separate services in this repo.
6. **Approved email design** exists in generated HTML under `templates/generated/` and inline Bash heredocs in runbooks 06/11.

---

## 2. Repository layout discovered

```
Notification Engine Data/                 ← Git root
├── .gitignore
├── NotifictaionEngine/                   ← Raghul Admin UI + MySQL prototype
│   ├── client/                           React 19 + Vite + TypeScript
│   ├── server/                           Express + Sequelize + MySQL
│   └── project_plan.md
└── refex-adoption-user-report-Live_IT_Service_Request_A00/
    └── refex-adoption-user-report/       ← Ashiq engagement pipeline
        ├── ops/runbooks/01-13           Bash orchestration
        ├── db/migrations/               PostgreSQL canonical model
        ├── data/discovery/              Raw Kissflow payloads (1,143 tracked files)
        ├── templates/generated/         Generated HTML reports
        ├── entrypoint.py                Cloud Run HTTP wrapper
        └── Dockerfile
```

**Naming debt:** `NotifictaionEngine` (typo), deeply nested `refex-adoption-user-report-Live_IT_Service_Request_A00/` wrapper folder.

---

## 3. Frontend discovery (Raghul)

| Attribute | Value |
|-----------|-------|
| Framework | React 19, TypeScript, Vite 8, Tailwind, react-router-dom v7 |
| Package manager | npm (lockfiles in root, client, server) |
| API binding | Relative `/api/*` via Vite dev proxy → `localhost:4000` |
| Runtime config | Partial — Kissflow dev keys via `VITE_*` env vars; **no production API base URL config** |
| Auth | Local email/password JWT against MySQL backend |
| Kissflow access | **Direct** via `vite-kissflow-proxy.ts` and `kissflowClient.ts` (violates target architecture) |
| Tests | **None** |
| Docker / Cloud Build | **None** |

**Authoritative UI pages:** applications, templates, schedulers, settings, audit logs, login — aligned with Notification Configuration Studio spec in `project_plan.md`.

**Non-authoritative / legacy:** `client/src/mocks/*` (original Readdy scaffold data still present).

---

## 4. Backend discovery

### 4a. Prototype MySQL backend (`NotifictaionEngine/server/`)

| Attribute | Value |
|-----------|-------|
| Framework | Express 4 + Sequelize 6 + mysql2 |
| Entry point | `app.js` (active); `src/index.ts` is orphaned Fastify scaffold |
| Schema management | `sequelize.sync({ alter: true })` — **no formal migrations** |
| Models (11) | User, Role, Application, EmailTemplate, EmailScheduler, EmailLog, SMTPConfig, AuditLog, KissflowResource, KissflowField, NotificationScheduleConfig |
| Schedulers | node-cron via `schedulerService.js` |
| Email | nodemailer via `emailService.js` |
| Tests | **None** |

**Anti-patterns confirmed in code:**

- MySQL ENUM columns (`Application.region`, `Application.environment`, etc.)
- `access_key_id` / `access_key_secret` stored on `applications` table
- Comma-separated JSON in TEXT columns (`process_ids`, `dataform_ids`, `board_ids`)
- Hardcoded DB password fallback: `RefexAdmin@123` in `server/config/config.js`
- Local password authentication with JWT
- SMTP credentials in `smtp_configs` model

### 4b. Production engagement pipeline (`refex-adoption-user-report/`)

| Attribute | Value |
|-----------|-------|
| Runtime | Bash runbooks + Python 3 HTTP entrypoint |
| Database | PostgreSQL `engagement_reporting` via `psql` |
| Migration | Single file: `db/migrations/001-canonical-engagement-model.sql` |
| Ingestion | Runbooks 09 (ITSM), 12 (PM) — paginated Kissflow REST |
| Renderer | Runbooks 06 (ITSM), 11 (combined) — inline SQL → HTML heredocs |
| Dispatcher | Runbook 07 — Gmail SMTP via curl |
| Combined pipeline | Runbook 13 chains ingest → render → send in **one container** |
| GCP references | `projectconfig.md`: project `master-diorama-489103-u2`, region `asia-south1` |
| Cloud Build | **Not present** in repo |
| Tests | **Empty** `tests/` directory |

**Existing PostgreSQL tables (16):** `snapshot_run`, `application`, `process`, `"user"`, `principal`, `principal_user`, `item`, `item_field`, `item_child_row`, `item_child_field`, `item_assignment`, `role_membership_resolution`, `report_run`, `report_dataset`, `report_render`, `report_delivery`.

**Gap vs target model:** Missing domains for sync watermarks, user activity events, report definitions/versions, templates, schedules, recipients, notification outbox, delivery attempts, dead letter queue, admin users/roles, credential bindings, schema snapshots, BigQuery publication ledger.

---

## 5. Duplicate and conflicting ownership

| Concern | Prototype (MySQL) | Pipeline (PostgreSQL) | Resolution needed |
|---------|-------------------|----------------------|-------------------|
| Applications | `applications` table | `application` dimension table | Split account/app/process; Secret Manager refs only |
| Schedulers | `email_schedulers` + `notification_schedule_configs` | None (hardcoded in runbooks/Scheduler) | Single `report_schedule` model |
| Templates | `email_templates` | Inline HTML in Bash | `report_template` + versioned artifacts |
| Email delivery | `email_logs` | `report_delivery` | Unified outbox + `delivery_attempt` |
| Users/auth | Local `users` + password | N/A | Corporate identity + `admin_user` |
| Kissflow credentials | DB columns + frontend env | Secret Manager env vars | Secret Manager only |
| Ingestion | None | Runbooks 09/12 | `ingestion-worker` service |
| API for frontend | Express `/api/*` | None | New `backend-api` OpenAPI v1 |

**Two schedulers risk:** Prototype node-cron + Cloud Scheduler on combined pipeline — must not coexist in production without cutover plan.

---

## 6. Runbook inventory

### Legacy pipeline runbooks (`refex-adoption-user-report/ops/runbooks/`)

| # | Script | Purpose |
|---|--------|---------|
| 01 | `01-verify-context.sh` | Dev Kissflow discovery (interactive credentials) |
| 02 | `02-inspect-kissflow-discovery.sh` | Human-readable discovery inspection |
| 03 | `03-build-compact-semantic-summary.sh` | Normalize discovery artifacts |
| 04 | `04-build-canonical-postgresql-model.sh` | Generate migration + contract (audit only) |
| 05 | `05-load-snapshot-to-postgresql.sh` | Load normalized snapshot to PostgreSQL |
| 06 | `06-render-html-report.sh` | ITSM HTML report |
| 07 | `07-send-email-report.sh` | Email via SMTP |
| 08 | `08-render-and-send-report.sh` | Chain 06 → 07 |
| 09 | `09-ingest-and-load.sh` | Production ITSM ingest + load |
| 10 | `10-full-pipeline.sh` | ITSM end-to-end |
| 11 | `11-render-combined-report.sh` | Combined ITSM + PM HTML |
| 12 | `12-ingest-pm-and-load.sh` | PM ingest + load |
| 13 | `13-full-pipeline-combined.sh` | Combined end-to-end |

Also present: `07-send-email-report.sh.bak` (should be removed during convergence).

### Repository-root runbooks (new convergence sequence)

| # | Script | Purpose |
|---|--------|---------|
| 01 | `01-inspect-repository-convergence-state.sh` | This assessment (read-only) |

---

## 7. Generated, experimental, and obsolete artifacts

| Category | Location | Recommendation |
|----------|----------|----------------|
| **Authoritative** | `db/migrations/001-*.sql`, runbooks 05-13, `entrypoint.py`, `Dockerfile` | Retain; refactor incrementally |
| **Authoritative UI** | `NotifictaionEngine/client/src/pages/*`, components, services | Retain frontend; rebind API |
| **Experimental** | `NotifictaionEngine/client/src/mocks/*`, orphaned Fastify scaffold | Remove after API binding |
| **Prototype backend** | `NotifictaionEngine/server/*` | Salvage patterns only; replace with PostgreSQL backend |
| **Generated** | `templates/generated/*.html`, `data/audit/runbook-*/*` | Gitignore; store in GCS in production |
| **Raw discovery / PII** | `data/discovery/**` (1,143 files) | **Remove from Git**; retention policy required |
| **Binary bloat** | `google-cloud-cli-darwin-arm.tar.gz` | **Remove from Git** |
| **Backup noise** | `07-send-email-report.sh.bak` | Delete |
| **Missing** | `notification_engine.json` | Not present (good) |

---

## 8. Technical break points (pre-convergence)

| Failure mode | Where it breaks | Detection | Recovery |
|--------------|-----------------|-----------|----------|
| Duplicate scheduler execution | Prototype cron + Cloud Scheduler | Overlapping report runs / duplicate emails | DB uniqueness on report_run; disable one scheduler |
| Partial ingest | Runbook 09/12 middle page failure | `snapshot_run.status = PARTIAL` | Replay from failed page; watermark must not advance |
| Frontend calls wrong backend | FE bound to MySQL Express | Schema mismatch errors | OpenAPI contract + generated client |
| Secrets in Git history | Initial commit | Runbook 02 scan | History rewrite or secret rotation |
| Customer data exposure | `data/discovery/` tracked | Compliance review | Remove from repo; use private bucket |
| Combined pipeline filesystem coupling | Runbook 13 single container | Cannot scale renderer/dispatcher independently | Artifact via GCS; separate services |
| FE direct Kissflow | `kissflowClient.ts` | Credential leakage to browser | Remove; backend proxy only |
| Migration interruption | Single SQL file, no ledger | Partial schema | Advisory lock + migration ledger (required) |

---

## 9. Uncertainty register (one item per next action)

| ID | Uncertainty | Blocks |
|----|-------------|--------|
| U-01 | Are live secrets present in Git history or only pattern references? | Runbook B (secret preflight) |
| U-02 | Customer-data retention policy for `data/discovery/` exports | Git history cleaning scope |
| U-03 | Approved Refex identity mechanism (IAP vs other) | Auth design in backend-api |
| U-04 | Whether existing GCP renderer/dispatcher services match runbook 06/07 HTML | Service reuse vs rewrite |
| U-05 | Target monorepo folder naming (`NotifictaionEngine` typo correction) | Runbook C structure |

**This runbook resolves:** frontend root, backend root, duplicate packages, schema authority split, runbook inventory, missing Cloud Build/tests.

---

## 10. Recommended convergence sequence (bounded)

1. **Runbook 02** — Secret and sensitive-data preflight (**STOP if live secrets tracked**)
2. **Runbook 03** — Repository structure convergence (preserve FE, isolate BE)
3. **Runbook 04** — Canonical PostgreSQL migration extension
4. **Runbook 05** — MySQL prototype salvage adapter (dry-run only)
5. **Runbook 06** — OpenAPI v1 contract
6. **Runbooks 07–09** — Outbox/DLQ, Cloud Build, E2E validation + PR

Do **not** activate Cloud Scheduler or deploy until shadow comparison and test recipient validation complete.

---

## 11. Stop conditions status

| Condition | Status |
|-----------|--------|
| Repo root unclear | **Clear** — Git root is workspace root |
| Frontend ownership unclear | **Clear** — `NotifictaionEngine/client` |
| Live secrets tracked | **Unknown** — requires Runbook 02 |
| Git history contains credentials | **Unknown** — requires Runbook 02 |
| Two schemas claim canonical ownership | **YES** — MySQL prototype vs PostgreSQL engagement |
| FE/BE contracts conflict | **YES** — no shared contract exists |
| Cloud deployment required | **No** — out of scope for this pass |

**Proceed to Runbook 02 after human review of this assessment.**
