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
- **Frontend + backend together** — Admin UI preview/starters/Settings must match seed + `reportStarters` + schedule-runner. See `.cursor/rules/frontend-backend-report-parity.mdc`. Never ship email-only or UI-only for the same KPI/layout.
- ITSM Closed / Today Closed / Today Open must match **Admin All** rules in `aasik_ITSM` (`kfITServiceDashboard.js`) — no Me/Team/Closed By. See release note.
- ITSM **Source** (Email/Mobile/…) must read Kissflow `Source` **and** report Column ids (`Column_BDSZ_sAHys` / `Column_hFjGV8lRrn`); never ship all-zero Email/Mobile when tickets exist. Helper: `itsm-ticket-source.js`.
- KPI source of truth for process reports: live Kissflow overlay + full ingest on schedules.
- Never commit secrets, `ops/tmp/`, or noisy `data/audit/` artifacts.

## Tests for ITSM HTML data

```bash
node tests/itsm-ticket-source.test.js
npx playwright test tests/playwright/itsm-report-html.spec.js
```

## Deploy that affects email numbers

```bash
DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh build-deploy
```

Admin UI / backend-api deploys do **not** update scheduled email KPI logic.

## Cursor rules

- `.cursor/rules/frontend-backend-report-parity.mdc` — Admin UI + seed + runner must change together
- `.cursor/rules/engagement-report-kpis.mdc` — Closed Today / entity scope
- `.cursor/rules/itsm-email-html-data.mdc` — Source panel, Today, Sign-in, Playwright
- `.cursor/rules/project-tracker-kpi-cards.mdc` — KPI card size/palette from Project Tracker (`PremiumKPICard`, always 4-up). Reference: `/Users/mohamedaasik/Desktop/Cursor/ProjectTracker`
