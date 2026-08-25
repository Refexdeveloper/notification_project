# Agent handoff — Refex Engagement Report Engine

Start here when continuing this repo in a new Cursor/agent session.

## What this project is

Kissflow engagement reporting: Admin UI → `backend-api` → PostgreSQL; **scheduled emails** via Cloud Run `refex-schedule-runner` (ingest → render HTML → SMTP).

GCP: project `master-diorama-489103-u2`, region `asia-south1`.

## Read these first for report / KPI work

1. **[Report KPI fixes (Aug 2026)](docs/release-notes/2026-08-21-report-kpi-fixes.md)** — Opened/Closed Today, Total/Open/Closed conditions, full ingest, live overlay, deploy, commit map.
2. **[Onboarding a new application](docs/onboarding-new-application.md)** — connect app → templates → schedules.
3. **[Production hardening (Jul 2026)](docs/release-notes/2026-07-31-production-hardening.md)** — earlier production notes.

## Hard constraints (report emails)

- Fix **scheduled** mail KPIs without changing **test-send** conditions unless the user explicitly asks.
- ITSM Closed / Today Closed / Today Open must match **Admin All** rules in `aasik_ITSM` (`kfITServiceDashboard.js`) — no Me/Team/Closed By. See release note.
- KPI source of truth for process reports: live Kissflow overlay + full ingest on schedules.
- Never commit secrets, `ops/tmp/`, or noisy `data/audit/` artifacts.

## Deploy that affects email numbers

```bash
DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh build-deploy
```

Admin UI / backend-api deploys do **not** update scheduled email KPI logic.

## Cursor rule

Project rule `.cursor/rules/engagement-report-kpis.mdc` reminds agents of Closed Today conditions and the docs above when editing pipeline/report files.
