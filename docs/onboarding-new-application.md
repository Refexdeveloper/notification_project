# Onboarding a New Kissflow Application

This guide describes what happens when you **Connect application** in the Admin UI — the equivalent of creating a new project in the Refex User Engagement / Notification Engine.

Production Admin UI: `https://refex-admin-ui-645830234926.asia-south1.run.app`

All Admin UI API calls use the **same-origin proxy** (`/api/v1/...` on the Admin UI host), which forwards to `backend-api`.

---

## Terminology

| User term | Codebase term |
|-----------|---------------|
| New project | **Connect application** |
| Project / app | **Kissflow application** (`application_id`, e.g. `Lead_tracker_1_A00`) |
| URL route id | `{environment}-{application_id}` (e.g. `production-IT_Service_Management_A00`) |

Registration stores metadata in PostgreSQL. It does **not** automatically ingest Kissflow data, create templates, or activate schedules.

---

## Overview: four onboarding steps

After Connect, the application **Overview** tab shows a checklist:

1. **Application registered** — PostgreSQL rows created (automatic on Connect)
2. **Sync fields** — pull Kissflow process fields for template placeholders (manual)
3. **Create HTML templates** — design report emails (manual)
4. **Schedule & recipients** — cron + email list (manual)

Optional ops step (not in the UI checklist):

5. **Run ingest pipeline** — load users/items into PostgreSQL for dashboard metrics and report content

---

## Phase 1 — Connect application

### Where in the UI

| Location | Path |
|----------|------|
| Applications list | `/applications` → **Connect** |
| Connect modal | `apps/admin-ui/src/pages/applications/components/AddApplicationForm.tsx` |
| After success | `/applications/{environment}-{application_id}?tab=overview` |

### What you provide

**Kissflow account**

- Account ID (`kissflow_account_id`)
- App ID (`application_id`) — Kissflow process ID for Admin APIs
- Subdomain, region (`com` / `eu`), environment (Development / UAT / Staging / Production)
- Application name and description

**Resource IDs** (entered manually or auto-discovered on validate)

- `process_ids`
- `dataform_ids`
- `board_ids`
- `dataset_ids`

**API authentication** (validation only)

- Access Key ID and Secret — used to verify Kissflow connectivity during Connect. **Not persisted to PostgreSQL.** Runtime credentials come from GCP Secret Manager (see Settings tab → credentials status).

### API calls (Admin UI → backend-api)

#### Step 1 — Validate Kissflow

```
POST /api/v1/applications/validate
```

**Request body:**

```json
{
  "kissflow_account_id": "AcCMptp3yqcn",
  "application_id": "Lead_tracker_1_A00",
  "application_name": "Lead Tracker",
  "display_name": "Refex Production",
  "subdomain": "refexgroup",
  "region": "com",
  "environment": "production",
  "description": "Optional description",
  "access_key_id": "...",
  "access_key_secret": "...",
  "process_ids": ["Lead_tracker_1_A00"],
  "dataform_ids": [],
  "board_ids": [],
  "dataset_ids": []
}
```

**Response (200):**

```json
{
  "valid": true,
  "process_ids": ["..."],
  "dataform_ids": ["..."],
  "board_ids": ["..."],
  "dataset_ids": ["..."],
  "warnings": ["..."],
  "application_id": "...",
  "kissflow_account_id": "..."
}
```

The Connect form auto-runs validate on submit if not already validated. Discovered IDs are applied into the form.

**Backend:** `services/backend-api/src/routes/applications.js`  
**Discovery logic:** `services/backend-api/src/lib/kissflowDiscovery.js`

#### Step 2 — Register application

```
POST /api/v1/applications
```

**Required headers:**

| Header | Purpose |
|--------|---------|
| `Idempotency-Key` | Min 8 chars; safe retry without duplicate registration |
| Session auth | IAP in production; dev stub when `ALLOW_DEV_AUTH_STUB=true` |

**Request body:** Same shape as validate.

**Response (201 created / 200 idempotent replay):**

```json
{
  "item": {
    "account_id": "uuid",
    "credential_binding_id": "uuid",
    "environment": "production",
    "application_id": "Lead_tracker_1_A00",
    "application_name": "Lead Tracker",
    "kissflow_account_id": "AcCMptp3yqcn",
    "subdomain": "refexgroup",
    "region": "com",
    "process_ids": ["Lead_tracker_1_A00"],
    "route_id": "production-Lead_tracker_1_A00",
    "credentials_persisted": false,
    "credential_secret_resource": "{\"key_id\":\"projects/.../secrets/...\", ...}"
  },
  "idempotent_replay": false
}
```

**Common errors:**

| Code | Meaning |
|------|---------|
| `409 APPLICATION_ACCOUNT_MISMATCH` | App already registered under a different account |
| `409 PROCESS_ALREADY_REGISTERED` | Process ID linked to another application |
| `502 KISSFLOW_VALIDATION_FAILED` | Keys or Kissflow API unreachable |
| `503 DATABASE_NOT_CONFIGURED` | PostgreSQL not available |

**Registration logic:** `services/backend-api/src/lib/applicationRegistration.js`

### Kissflow APIs called during validate

| Step | Kissflow endpoint | Purpose |
|------|-------------------|---------|
| Connection probe | `GET https://{subdomain}.kissflow.{region}/user/2/{accountId}/?page_number=1&page_size=1` | Verify keys |
| Fallback probe | `GET .../process/2/{accountId}/admin/{processId}/item?page_number=1&page_size=1&apply_preference=1` | If user API fails |
| Process discovery | Admin item endpoint for candidate process IDs | Validate processes |
| Dataform discovery | `GET .../dataform/2/{accountId}/` | List dataforms |
| Board discovery | `GET .../board/2/{accountId}/` | List boards |
| Dataset discovery | `GET .../dataset/2/{accountId}/` | List datasets |

Headers: `X-Access-Key-Id`, `X-Access-Key-Secret`, `Accept: application/json`

### PostgreSQL records created at registration

| Table | What is written |
|-------|-----------------|
| `engagement_reporting.account` | UPSERT on `kissflow_account_id` |
| `engagement_reporting.credential_binding` | GCP Secret Manager resource pointer (`provider='KISSFLOW'`) |
| `engagement_reporting.application` | App metadata in `source_payload` JSONB |
| `engagement_reporting.process` | One row per `process_id` |
| `engagement_reporting.audit_event` | `REGISTER_APPLICATION` with idempotency evidence |

Schema: `db/migrations/001-canonical-engagement-model.sql`, `002-platform-extensions.sql`

### Not created at registration

- `snapshot_run`, `user`, `item`, `item_field`, `item_assignment` (ingest)
- `report_template`, `report_schedule`, `report_recipient` (templates/schedules)
- `sync_run`, `sync_watermark` (field sync / ingest)
- `report_run`, `report_delivery` (sent reports)

---

## Phase 2 — Sync fields

**UI:** Application detail → **Discovery** tab, or header **Sync fields** button.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/v1/applications/{applicationId}/processes/{processId}/fields` | Read cached field catalog |
| `POST` | `/api/v1/applications/{applicationId}/processes/{processId}/fields/sync?environment={env}` | Pull latest fields from Kissflow |

**Kissflow called:**

```
GET .../process/2/{accountId}/admin/{processId}/item?page_number=1&page_size=500&apply_preference=1
```

**PostgreSQL updated:** field discovery JSON on `process` row; `sync_watermark`

Templates use these fields as placeholders (e.g. `{{Status}}`, `{{Assigned_To}}`).

---

## Phase 3 — Create HTML templates

**UI:** Application detail → **Templates** tab  
Global template library: `/templates` (backend mode)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/v1/applications/{applicationId}/templates` | List templates |
| `POST` | `/api/v1/applications/{applicationId}/templates` | Create draft |
| `PATCH` | `/api/v1/applications/{applicationId}/templates/{templateId}` | Edit / publish |
| `GET` | `/api/v1/applications/{applicationId}/templates/{templateId}/versions` | Version history |
| `DELETE` | `/api/v1/applications/{applicationId}/templates/{templateId}` | Delete (guarded if linked to schedule) |

**Create example:**

```json
{
  "name": "Daily Lead Report",
  "subject": "Lead Tracker — {{date}}",
  "description": "Morning summary",
  "status": "draft"
}
```

**PostgreSQL created:** `report_template`, `report_template_version`, `report_definition_version` (`kind: template_only`)

Publish a template before attaching it to an active schedule.

---

## Phase 4 — Create schedules

**UI:** Application detail → **Schedulers** tab

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/v1/applications/{applicationId}/schedules` | List schedules |
| `POST` | `/api/v1/applications/{applicationId}/schedules` | Create schedule |
| `PATCH` | `/api/v1/applications/{applicationId}/schedules/{scheduleId}` | Edit cron, recipients, activate |
| `POST` | `/api/v1/applications/{applicationId}/schedules/{scheduleId}/test-send` | Send test email |
| `DELETE` | `/api/v1/applications/{applicationId}/schedules/{scheduleId}` | Remove schedule |

**Create example:**

```json
{
  "name": "Daily Lead Report",
  "template_id": "uuid-of-published-template",
  "process_id": "Lead_tracker_1_A00",
  "cron_expression": "0 9 * * *",
  "timezone": "Asia/Kolkata",
  "from_email": "reports@refex.com",
  "recipients_to": ["user@refex.com"],
  "recipients_cc": [],
  "is_active": false
}
```

When `is_active: true`, backend syncs a **Cloud Scheduler** job targeting the schedule-runner service.

**PostgreSQL created:** `report_definition`, `report_definition_version`, `report_schedule`, `report_recipient`

Provisioner runbook: `ops/runbooks/32-provision-schedulers-from-postgresql.sh`

---

## Phase 5 — Data ingest (ops / pipeline)

Registration and field sync do **not** load engagement data (users, tickets, tasks). Run ingest when you need dashboard metrics or report body content.

| Runbook | Application type |
|---------|------------------|
| `services/engagement-pipeline/ops/runbooks/09-ingest-and-load.sh` | IT Service Management |
| `services/engagement-pipeline/ops/runbooks/12-ingest-pm-and-load.sh` | Project Management Tracker |
| `services/engagement-pipeline/ops/runbooks/16-ingest-lead-tracker-and-load.sh` | Lead Tracker |

Shared library: `services/engagement-pipeline/ops/runbooks/ingest-sync-lib.sh`

**PostgreSQL created:** `snapshot_run`, `user`, `item`, `item_field`, `item_assignment`, `principal*`

**Scheduled send path:**

```
Cloud Scheduler → refex-schedule-runner → ingest → render HTML → email
```

Dispatch runbook: `services/engagement-pipeline/ops/runbooks/19-dispatch-scheduled-report.sh`

---

## Pre-built seed runbooks (known app types)

For ITSM, PM, and Lead Tracker, seed scripts can pre-create templates and schedules (separate from UI Connect):

| Runbook | App |
|---------|-----|
| `ops/runbooks/23-seed-itsm-report-config.sh` | IT Service Management |
| `ops/runbooks/24-seed-pm-report-config.sh` | Project Management |
| `ops/runbooks/25-seed-lead-tracker-report-config.sh` | Lead Tracker |

---

## End-to-end flow diagram

```
/applications → Connect
       │
       ▼
POST /api/v1/applications/validate
       │  (Kissflow: verify keys + discover resource IDs)
       ▼
POST /api/v1/applications  (+ Idempotency-Key)
       │  (PostgreSQL: account, application, process, audit)
       ▼
/applications/{env}-{appId}?tab=overview
       │
       ├──► POST .../fields/sync          (Discovery tab)
       ├──► POST .../templates            (Templates tab)
       ├──► POST .../schedules              (Schedulers tab)
       └──► ops: ingest runbook             (dashboard + report data)
                    │
                    ▼
            Cron → schedule-runner → render → send
```

---

## Follow-up API reference (post-registration)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/applications` | List registered apps |
| `GET /api/v1/applications/{applicationId}` | App detail |
| `PATCH /api/v1/applications/{applicationId}?environment=` | Update metadata |
| `DELETE /api/v1/applications/{applicationId}?environment=` | Soft-delete |
| `GET /api/v1/applications/{applicationId}/credentials-status` | GCP secret binding status |
| `GET /api/v1/applications/{applicationId}/engagement` | Live / cached metrics |
| `GET /api/v1/dashboard` | Cross-app dashboard summary |

OpenAPI contract: `openapi/backend-api.yaml`

---

## New application checklist

- [ ] Connect at `/applications` with valid Kissflow keys
- [ ] Confirm Overview shows **Application registered**
- [ ] Sync fields on Discovery tab
- [ ] Create and **publish** HTML template
- [ ] Create schedule with recipients; test send
- [ ] Activate schedule (`is_active: true`) when ready
- [ ] Run appropriate ingest runbook for dashboard data
- [ ] Verify GCP Secret Manager has runtime Kissflow credentials (Settings tab)
- [ ] Confirm Cloud Scheduler job exists (`32-provision-schedulers-from-postgresql.sh`)

---

## Related documentation

- [Production hardening release notes (Jul 2026)](./release-notes/2026-07-31-production-hardening.md)
- [Deployment and cutover](./architecture/deployment-and-cutover.md)
- [Consolidation stack](./architecture/consolidation-stack.md)
