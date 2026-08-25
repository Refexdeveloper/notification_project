# Release Notes — Report KPI Fixes (August 2026)

Handoff for agents continuing scheduled email report work. Covers Opened/Closed Today, Total/Open/Closed ticket cards, MIS highlight, ingest, and deploy.

**GCP project:** `master-diorama-489103-u2` · **region:** `asia-south1`  
**Schedule runner service:** `refex-schedule-runner`  
**Deploy runbook:** `ops/runbooks/32-deploy-schedule-runner.sh`

| Item | Value (as of deploy `5f8183d`) |
|------|--------------------------------|
| Commit | `5f8183d` |
| Revision | `refex-schedule-runner-00060-6ns` (100% traffic) |
| Image tag | `asia-south1-docker.pkg.dev/.../schedule-runner:5f8183d` |

---

## Product rules (do not break)

1. **Scheduled mail** is the path that must show correct KPIs (Cloud Scheduler → schedule-runner → ingest → render → send).
2. **Test send** behavior must stay as designed: prefer snapshot render; do **not** force full ingest on every test send (except when no snapshot exists for Extrovis/Solar-style first runs).
3. **Lead Tracker** already counts live Kissflow in `archive/prototype-mysql-api/services/leadReportService.js`. ITSM / PM / Solar / Expense / Travel must stay aligned with that intent for **today** and **totals**.
4. Do **not** commit `ops/tmp/`, `data/audit/` junk, `.env`, or secrets.

---

## Problems we fixed

### Opened Today / Closed Today were wrong on scheduled ITSM (and siblings)

**Root causes:**

- Incremental ingest carried forward an old base snapshot; tickets raised today were missing from SQL.
- Entity filter `ENTITY_FILTER=Refex` excluded tickets with blank Entity.
- Kissflow list payloads often omit `_completed_at`; closed-at must fall back to `_modified_at` when the item is business-closed.
- Earlier Cloud Run revisions overwrote images without the full-ingest / live-overlay fixes sticking in practice.

**Fixes:**

- Force `FULL_INGEST=true` on scheduled dispatches (`19-dispatch-scheduled-report.sh` + `ingest_force_full_for_schedule` in `ops/runbooks/ingest-sync-lib.sh`).
- Live Kissflow overlay via `services/engagement-pipeline/scripts/count-live-today-kpis.js` + `report_live_today_kpis` in `ops/runbooks/report-template-lib.sh`.
- Wired into renders: `06` (ITSM), `14` (PM), `21` (Solar), `23` (Expense/Travel).
- Newest snapshot CTE: `report_latest_snapshot_cte`.

### Total / Open / Closed ticket cards were wrong (ITSM)

**Root causes:**

- **Total** came from Entity-scoped `sla` SQL.
- **Open / Closed** were summed from MIS **user-row** `open_count` / `closed_count` (can disagree with Total).
- Blank Entity tickets were dropped when `ENTITY_FILTER=Refex`.

**Fixes (commit `5f8183d`):**

- KPI cards use the same snapshot summary fields (`total_tickets`, `open_tickets`, `closed_tickets`).
- Live overlay also supplies `total_tickets` / `open_tickets` / `closed_tickets`.
- For Refex scope: blank/null Entity counts as Refex (SQL + live JS). Extrovis still exact-match only.

### MIS “signed in today” highlight

Rows for users whose last sign-in is today (IST) get green background (`#dcfce7`) in ITSM/PM/Solar/process HTML tables and Lead Tracker user table.

---

## Closed Today — exact condition (aligned to Admin All dashboard)

Source of truth: `aasik_ITSM` `kfITServiceDashboard.js` —
`isRefexServiceClosedTicket` + `isDashboardRowClosedToday` / `getRefexClosedAtRaw`.
Email matches **Admin All** (no Me / My Team / Closed By).

A ticket counts toward **Closed Today** when:

1. It is **business-closed**, and  
2. Its **closed-at** calendar date in **`Asia/Kolkata`** equals **today IST**.

### Business-closed (ITSM) — Admin Closed KPI

```
Closed =
  NOT Rejected
  AND (
    reopen hold step  -- IT Tech Reopen / ReOpen Window / Employee Feedback / Ticket Reopen
    OR Kissflow process Completed (_status Completed only — NOT Statu_1/Validation Closed)
  )
```

- **Rejected** (`Rejected` / `Reject` / `Declined`) never counts as Closed.
- **Statu_1 / Validation = Closed** alone does **not** count as Closed.
- **No Closed By / Me filter** on email cards (same as Admin All).

### Closed-at timestamp (matches `getRefexClosedAtRaw`)

- **Reopen hold:** prefer `_modified_at`, then completed/closed fields.
- **Process Completed:** prefer `_completed_at` / `_closed_at` / Completed_* / Closed_*, then `_modified_at`.

### Opened Today (Today Open)

Created today IST **and** still base-open (not Closed, not Rejected, not Cancelled) — not merely “created today”.

### Open (backlog)

Not Closed, not Rejected, not Cancelled (dashboard `isRefexServiceOpenTicket` base). Email does **not** apply Agent Me Closed By or Manager monitoring “agent pipeline only” narrowing unless product asks later.

---

## Key files

| Area | Path |
|------|------|
| Shared SQL + live helpers | `ops/runbooks/report-template-lib.sh` |
| Force full ingest on schedules | `ops/runbooks/ingest-sync-lib.sh` |
| Dispatch (schedule vs test) | `services/engagement-pipeline/ops/runbooks/19-dispatch-scheduled-report.sh` |
| Live KPI script | `services/engagement-pipeline/scripts/count-live-today-kpis.js` |
| ITSM render | `services/engagement-pipeline/ops/runbooks/06-render-html-report.sh` |
| PM / Solar / process renders | `14-`, `21-`, `23-render-*-html-report.sh` |
| ITSM / PM / Solar / process ingest | `09-`, `12-`, `20-`, `22-ingest-*-and-load.sh` |
| Lead Tracker live counts | `archive/prototype-mysql-api/services/leadReportService.js` |
| Schedule-runner image | `services/engagement-pipeline/Dockerfile.schedule-runner` |
| Deploy | `ops/runbooks/32-deploy-schedule-runner.sh` · `cloudbuild/schedule-runner-only.yaml` |

---

## Deploy (schedule-runner only)

Emails are rendered by **schedule-runner**, not admin-ui. After KPI/render/ingest changes:

```bash
export CLOUDSDK_PYTHON=...   # if needed on this machine
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
cd "<repo>"
DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh build-deploy
```

Verify traffic:

```bash
gcloud run services describe refex-schedule-runner \
  --region=asia-south1 --project=master-diorama-489103-u2 \
  --format='value(status.traffic)'
```

Useful log filters: `Live Kissflow`, `FULL_INGEST`, `total_tickets`, `Incremental`, `entity=`.

---

## Related commits (this thread)

| Commit | Summary |
|--------|---------|
| `c28a8d2` / `1d7705e` | Nested Kissflow date SQL; closed via `_modified_at`; dashboard PG fallback |
| `da4b546` | MIS green highlight; richer closed detection |
| `3f34105` | Keep test-send unchanged; scheduled today KPIs |
| `1fb315e` | Force full ingest on schedules + live today overlay |
| `5f8183d` | Fix Total/Open/Closed via live counts + blank Entity as Refex |

---

## If KPIs look wrong again — checklist

1. Confirm **schedule-runner** revision includes the expected commit SHA (image tag).
2. In logs for that schedule run: is it **Full ingest** or still **Incremental**?
3. Is `ENTITY_FILTER` set (e.g. `Refex`)? Blank Entity should count for Refex only.
4. Did live overlay run (`Live Kissflow ticket KPIs: ...`)?
5. Compare Closed Today against Kissflow: status/step + `_modified_at` date in IST — not “any ticket touched today”.
6. Do **not** “fix” by changing test-send to always full-ingest unless product asks.
