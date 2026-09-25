# Embed Admin UI dashboards in Refexone (super-app)

**Status:** Phase 1 **live** (`embed7b` admin-ui + `embed7` backend). Revisions: `refex-admin-ui-00116-5vw` → pending embed7b; backend `refex-backend-api-00159-6j7`.

## Embed design tokens (reference screenshot + Refex brand)

| Token | Value | Notes |
|-------|-------|-------|
| Page background | `#F5F7FA` | Matches PM dashboard screenshot |
| Font | **Inter** | Same as reference; artifact link was not readable |
| Accent blue | `#0F6CBD` | Refex brand (not Material `#1976D2`) |
| Icon pill bg | `#EEF3FF` | Filter icon circles |
| Card | white, `rounded-xl`, shadow `0 4px 18px rgba(112,144,176,0.12)` | KPI + chart cards in embed |

## Embed layout (`?embed=1` only — normal Admin UI unchanged)

| Zone | Content |
|------|---------|
| **Top header** | Application name only (e.g. “IT Helpdesk”) |
| **Second container (pastel card)** | Time greeting (Good morning / afternoon / evening) + **Dinesh Agarwal · Group CEO** + Full Engagement report + icon + Active badge + Refresh dashboard |
| **Below** | Same KPI charts/tables; all explanatory/filter/technical copy hidden (no Last synced, no kissflow domain, no filter hints) |

Original application URLs are unchanged — append `&embed=1` to get the embed shell.

**Refexone Back button:** append `&return_to=https://your-refexone-url` (URL-encoded). Browser Back returns to Refexone instead of Admin UI history.

**Embed filters (right-aligned, same row as greeting):** Company · User · Period. Compare removed. No Business Functions filter.

## Goal

From [Refexone / super-app](file:///Users/mohamedaasik/Desktop/Cursor/super-app), a CEO/CTO user clicks an **IT Management** (or similar) KPI card and lands on **this** Notification Engine application dashboard — with:

- Deep link to a **specific application**
- **No left sidebar** / no Applications breadcrumb trail
- **Dashboard + Records tabs only**
- Time-based greeting (Good morning / afternoon / evening) with CTO/CEO when role matches
- **Full Engagement report** link → main dashboard still in embed mode (no sidebar), filtered to that app when possible
- Works on **mobile**
- Auth still uses existing Admin UI session (Phase 2 for cross-app SSO)

## Flag (does not change normal Admin UI)

| Query | Effect |
|-------|--------|
| `embed=1` (or `true` / `yes`) | Hide sidebar + Applications crumb; Dashboard + Records only; embed header |
| *(absent)* | Full Admin UI unchanged |

Keep using the **same** application detail / dashboard pages — embed only hides chrome and tabs.

## Deep links (production)

Base: `https://refex-admin-ui-dhwffeu7pq-el.a.run.app`

### Full engagement dashboard (all apps)

`https://refex-admin-ui-dhwffeu7pq-el.a.run.app/dashboard?embed=1`

### Per-app embedded dashboards (final Refexone URLs)

| Refexone card | Embed dashboard URL |
|---------------|---------------------|
| IT Helpdesk | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/applications/production-IT_Service_Management_A00?tab=dashboard&embed=1` |
| Project Tracker | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/applications/production-Project_Management_Tracker_A00?tab=dashboard&embed=1` |
| Procurement / P2P | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/applications/production-Procurement_to_Pay_A00?tab=dashboard&embed=1` |
| Travel | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/applications/production-Expense_and_Travel_Management_A00?tab=dashboard&embed=1` |
| Solar | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/applications/production-Solar_Site_Expense_Governance_Syst_A00?tab=dashboard&embed=1` |
| Lead Tracker | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/applications/production-Lead_Trcaker_A00?tab=dashboard&embed=1` |
| Expense (EMS) | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/applications/production-EMS_001_A00?tab=dashboard&embed=1` |

Records tab: same paths with `tab=records`.

**Full Engagement report** (button in embed card → filtered overview):

`/dashboard?embed=1&app=production-{application_id}`

Example ITSM: `https://refex-admin-ui-dhwffeu7pq-el.a.run.app/dashboard?embed=1&app=production-IT_Service_Management_A00`

### Path reference (relative)

| Refexone card | `application_id` | Path |
|---------------|------------------|------|
| IT Helpdesk / ITSM | `IT_Service_Management_A00` | `/applications/production-IT_Service_Management_A00?tab=dashboard&embed=1` |
| Project Tracker | `Project_Management_Tracker_A00` | `/applications/production-Project_Management_Tracker_A00?tab=dashboard&embed=1` |
| Procurement / P2P | `Procurement_to_Pay_A00` | `/applications/production-Procurement_to_Pay_A00?tab=dashboard&embed=1` |
| Travel | `Expense_and_Travel_Management_A00` | `/applications/production-Expense_and_Travel_Management_A00?tab=dashboard&embed=1` |
| Solar | `Solar_Site_Expense_Governance_Syst_A00` | `/applications/production-Solar_Site_Expense_Governance_Syst_A00?tab=dashboard&embed=1` |
| Lead Tracker | `Lead_Trcaker_A00` | `/applications/production-Lead_Trcaker_A00?tab=dashboard&embed=1` |
| Expense (EMS) | `EMS_001_A00` | `/applications/production-EMS_001_A00?tab=dashboard&embed=1` |

## What already exists

| Surface | URL pattern |
|---------|-------------|
| Admin UI (prod) | `https://refex-admin-ui-dhwffeu7pq-el.a.run.app` |
| Normal app dashboard | `/applications/{environment}-{application_id}?tab=dashboard` |
| Embed (this doc) | add `&embed=1` |

Today, pasting a deep link into another browser often drops to login / apps list because **session cookies are origin-scoped**. That is expected until Phase 2 auth.

## Code map

| Piece | Location |
|-------|----------|
| Embed query helpers | `apps/admin-ui/src/lib/embedMode.ts` |
| Greeting | `apps/admin-ui/src/lib/timeGreeting.ts` |
| Layout hides sidebar when `embed=1` | `apps/admin-ui/src/components/feature/Layout.tsx` |
| Embed tabs (Dashboard + Records) | `applicationDetailTabsForEmbed()` in `backendSurface.ts` |
| App detail preserves `embed` on tab change | `pages/applications/detail/page.tsx` |

## Recommended approach (phased)

### Phase 1 — Embeddable deep links (UI only) — DONE

1. `?embed=1` — hide sidebar + Applications breadcrumb  
2. `?tab=dashboard` / `records` — land on those tabs only  
3. Document stable app IDs for Refexone card mapping (table above)

### Phase 2 — Auth for cross-app open (required for “another browser / another product”)

Pick one:

**A. Shared SSO (preferred)**  
- Refexone and Admin UI trust the same IdP (Azure AD / Kissflow IAM).  
- Card click opens Admin UI; user already has SSO session → no redirect to empty apps list.

**B. One-time embed token**  
- Refexone backend calls Notification Engine: `POST /api/v1/embed/session` with service credentials + target `application_id` + user email/roles.  
- Returns short-lived URL: `/embed/{token}` → Admin UI exchanges token for session cookie scoped to CEO/CTO.  
- Token TTL ~5–15 minutes; single use.

**C. iframe + cookie**  
- Same-site or partitioned cookies; usually worse on mobile Safari — prefer A or B.

### Phase 3 — Mobile / responsive shell

- `embed=1` layout: full-width, no sidebar, sticky compact header (greeting + Full Engagement report).  
- Touch-friendly filter pills (already partly done).  
- Refexone card opens **in-app WebView** or new tab with the embed URL.

## Refexone (super-app) wiring sketch

1. Map KPI card `id` → Notification Engine `application_id` in super-app config.  
2. On click (CEO/CTO role only):  
   `window.open(ADMIN_UI_BASE + '/applications/production-' + appId + '?tab=dashboard&embed=1&return_to=' + encodeURIComponent(REFEXONE_RETURN_URL), '_blank')`  
   or navigate WebView.  
3. Ensure role gate: only users with `ceo` / `cto` (or app-role allowlist) see the card / can mint embed tokens.

## Security notes

- Never put long-lived API keys in the mobile app.  
- Embed tokens must be minted server-side.  
- Restrict embed mode to read dashboards (no platform-user admin).  
- Audit log: who opened which application embed.

## Impact / non-goals

- **Normal Admin UI** (no `embed=1`): unchanged chrome, all tabs, sidebar present.  
- Application dropdown on the main dashboard filter bar is a small shared UX tweak (all modes); KPI layout/charts are unchanged.  
- No backend/API contract change for Phase 1.

## Acceptance criteria

- [x] CEO/CTO opens ITSM with `embed=1` → Dashboard loads without sidebar; only Dashboard + Records.  
- [x] Project Tracker / P2P / Travel / Solar / etc. use the same pattern with different `application_id`.  
- [x] **Full Engagement report** returns to `/dashboard?embed=1&app=…` without sidebar.  
- [x] Greeting + Dinesh Agarwal · Group CEO in second container; app name in top header only.  
- [ ] Unauthenticated user cannot land on live KPIs (existing auth; Phase 2 for cross-product).  
- [ ] Deep link works on mobile viewport (Phase 1 shell is responsive; verify in WebView).

## Deploy embed shell (admin-ui only)

```bash
export CLOUDSDK_PYTHON=/path/to/python3.12   # gcloud needs Python 3.10+
export DEPLOY_APPROVED=true
export DEPLOY_LIVE_TRAFFIC=true
export COMMIT_SHA="embed4-$(date -u +%Y%m%dT%H%M%SZ)"
bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh build
bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh deploy-admin
```

Branch: `feature/refexone-embed-dashboard` (commit `9aefb9f` — push requires GitHub access as `Refexdeveloper`).
