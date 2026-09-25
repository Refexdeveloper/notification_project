# Company filter — aasik_ITSM vs Notification Engine

**Date:** 10 Sep 2026  
**Status:** Implemented in Notification Engine (`2026.09.02-d5`). ITSM Company now uses requester `user_details_lookup` (blank → Refex Industries Limited) with exact catalog match.  
**Owner:** Notification Engine (embed + main). Email runner unchanged.  
**Not involved:** Refex One (`super-app`) — launcher / OIDC / SAML only.

---

## 1. Which product?

| Product | Role in this issue |
|---------|--------------------|
| **aasik_ITSM** | Source of truth for Kissflow ITSM MIS Company filter |
| **Notification Engine** | Dashboards showing **wrong / extra** company data |
| **Refex One** | Not used. Do not change launcher or OIDC |

Embed (`?embed=1`) and main `/applications/…?tab=dashboard` share `AppDashboardTab`. A company-filter fix must land once there. Consolidated `/dashboard` uses the same client helpers (`companyCountsFromRecords` / `filterAppRecords`).

**Do not change scheduled email runner KPIs** for this. Email reports do not use this Company dropdown.

---

## 2. What “correct” means (aasik_ITSM)

Settled in `aasik_ITSM/docs/PRODUCT_DECISIONS.md`:

- **Company** = requester’s legal entity from Kissflow lookup **`user_details_lookup`**  
  (`Company_Name` / `REFEX_COMPANY_NAME_1`). **Not** the process **Entity** field.
- Blank lookup → treat as **`Refex Industries Limited`**.
- Filter is an **exact** normalized string match (`matchesRefexCompanyFilter`).
- Dropdown is a **fixed 29-name list** (`REFEX_COMPANY_NAME_LIST`), plus All Companies.
- Company filter is **client-side** on already-loaded report rows. Kissflow is **not** queried again with `$company`.
- **Extrovis** entity: no Refex 29-company dropdown (entity column filter instead).
- **Venwind**: separate Entity tab on the **same Refex process**; rows whose company/entity contains Venwind. Refex tab **excludes** those rows. Switching Refex ↔ Venwind does **not** refetch `All_tickets`.

Field ids (Refex service report `Service_Items_Refex_A00`):

| Meaning | Kissflow id / key |
|---------|-------------------|
| Lookup column | `Column_bRn4sBWeeF` |
| Native key | `user_details_lookup` |
| Attributes | `Company_Name`, `REFEX_COMPANY_NAME_1` |

Code: `extractRefexCompanyNameFromItem` → `mapReportRow.companyName` → `applyMisColumnFilters` → `matchesRefexCompanyFilter`.

---

## 3. APIs — they are not the same

Company is **not** a Kissflow query parameter in either product. The difference is **which payload is loaded** and **which JSON keys are read**.

### aasik_ITSM (Kissflow pages)

| Step | API | What it is for |
|------|-----|----------------|
| Main MIS | Process **report** `GET …/process/{processId}/report/{reportId}` | Refex: `Live_IT_Service_Request_A00` / **`Service_Items_Refex_A00`**. Extrovis: `Live_IT_Service_Request_Extrovis_A00` / **`All_tickets_A00`**. |
| Live Open / Pending | Pending / my-items by activity | Fast landing; **not** the Company source |
| Refresh | Same report + optional `$modified_at_gt` delta | IndexedDB / in-memory cache; **no extra company API** |

Optimization (already in aasik, **not** copied to NE):

1. Paint from pending pools first; walk the full report in the background.
2. Cache full report in memory / IndexedDB; entity/company switches are **in-memory filters**.
3. Skip per-ticket instance GET on Admin/CEO landing.
4. Soft refresh merges deltas; does not blank KPIs.

Company list never comes from “whatever companies appear in this page of Get-all-items”.

### Notification Engine

| Step | API | What it is for |
|------|-----|----------------|
| Ingest | Kissflow **Admin Get-all-items** `GET /process/2/{account}/admin/{processId}/item` | Snapshot into PostgreSQL `engagement_reporting.item.source_payload` |
| Dashboard KPIs | `GET /api/v1/dashboard/application/{id}` | Engagement cache + SQL snapshot |
| Records / MIS filters | `GET /api/v1/dashboard/application/{id}/records?inventory=1` | Serialized rows for client filters |

Sampled **10 Sep 2026** production inventory (ITSM):

- `data_source`: `snapshot_items`
- **335** rows (dashboard FY live overlay can be larger, e.g. ~611)
- **`company_name` is only `Refex` (329) or `Extrovis` (6)** — that is the **Entity bucket**, not a legal company

NE **now** reads `user_details_lookup` / `Column_bRn4sBWeeF` in `appRecords.js` (`extractItsmCompanyNameFromRaw`) for ITSM live rows and snapshot SQL. Other apps are unchanged.

---

## 4. How NE currently derives “Company”

Pipeline (same for embed and main):

```
Kissflow Get-all-items  OR  live cache raw
        ↓
companyTextFromRaw()     Entity / Company / Legal_Entity / Organisation
        ↓  if those are empty, copy Entity text (“Refex”)
company_name = "Refex" | "Extrovis"
        ↓
stampRecordsWithAssigneeCompany()
        ↓  if label is only a bucket, overlay **assignee’s** roster company
dropdown = catalog 29-list ∩ counts  +  leftover free-text
        ↓
recordMatchesCompany()   fuzzy includes() on a haystack of entity + company
```

### Extract (`services/backend-api/src/lib/appRecords.js`)

`companyTextFromRaw` looks at:

`Company`, `Legal_Entity`, `Legal_Entity_Name`, `Organisation`, `Organization`, `Created_by_Company`, `Creator_Company`, then **`entityTextFromRaw` (Entity)**.

SQL snapshot path uses `source_payload->>'Entity'` / `->>'Company'` the same way. **No lookup column.**

### Overlay (`stampRecordsWithAssigneeCompany`)

If the row is only `Refex` / `Extrovis` / `Venwind`, NE copies **the assigned agent’s** company from the APP_ROLE roster.

That is **not** the requester’s `user_details_lookup`. One agent can stamp dozens of tickets with *their* legal entity (or leave them as `Refex`). Dropdown then shows **assignee companies** (e.g. Venwind, 3i) mixed with entity leftovers.

### Match (`recordMatchesCompany`)

Not exact. After resolving a catalog id it also does:

- `hay.includes(legalName)` or `legalName.includes(hay)`
- `hay` in ITSM mode includes **entity_key** (`refex`)

So picking **Refex Industries Limited** matches almost every Refex-entity ticket, because haystack contains `"refex"`. That is the main “unwanted data” behaviour.

Blank company is **not** defaulted to Refex Industries Limited (aasik does).

---

## 5. Why the two UIs disagree

| Check | aasik_ITSM | Notification Engine today |
|-------|------------|---------------------------|
| Company field | `user_details_lookup.Company_Name` | Entity (`Refex`) or assignee roster company |
| Blank | Refex Industries Limited | Stay `Refex` / get assignee stamp |
| Match | Exact normalized name | Fuzzy substring vs 29-list ids |
| Dropdown | Always 29 names + All | Only names that got a count after stamp |
| API for rows | Process **report** | **Get-all-items** → Postgres / cache |
| Extra company HTTP | None | None (wrong keys, not extra calls) |

**Equals?** No. Counts for a selected company cannot match Kissflow MIS until NE reads the same lookup field and uses exact match.

---

## 6. All NE dashboards (no code change; impact map)

| Surface | Company dropdown | Same bug? |
|---------|------------------|-----------|
| ITSM app dashboard (main + embed) | Yes, hidden when Entity = Extrovis | **Yes — vs aasik** |
| Consolidated `/dashboard` (+ embed) | Yes | **Yes** — same helpers, mixed apps |
| PM, P2P, Travel, Solar, Lead, EMS | Yes | Same 29-list + fuzzy match. Those apps **do not** have ITSM `user_details_lookup`. Their Kissflow Company/Entity fields may be valid for *that* app. Do **not** apply ITSM lookup to them without checking each process. |

Side effects of a **future** ITSM-only fix (for when we implement):

- Changing `companyTextFromRaw` globally would retag PM/Travel/Lead `Company_Name` (Lead already uses `Company_Name` as a **subject** fallback). Scope any extract to **ITSM**.
- Exact match + lookup would **shrink** ITSM company slices (stop “Industries Limited” ≈ all Refex). KPI cards, MIS, Records must stay in lockstep.
- Defaulting blank → Industries Limited increases that one company’s count; document the delta.
- Venwind: aasik is an **Entity** tab; NE 29-list puts Venwind under Company when Entity = All. Align carefully so Extrovis entity still has **no** 29-list (`showCompanyFilter`).
- Email HTML / schedule-runner: do not retarget unless product asks.

---

## 7. How aasik stays fast *and* correct

Correctness is **field choice + exact match**, not a heavier API.

1. One report walk (`Service_Items_Refex_A00` / `All_tickets_A00`).
2. Map `Column_bRn4sBWeeF` once per row into `companyName`.
3. Header Company select filters that array in the browser (`matchesRefexCompanyFilter`).
4. Entity Refex ↔ Venwind is the same cached array.

NE already has the right *shape* (client filter on an inventory). It filters the **wrong column** and **over-matches**.

Implemented 10 Sep 2026 (`2026.09.02-d5`):

1. Persist / read `user_details_lookup` (or `Column_bRn4sBWeeF`) on ITSM live map + snapshot SQL.
2. Set `company_name` from that lookup; blank → `Refex Industries Limited`.
3. Do **not** stamp assignee company over that value (ITSM only).
4. Match with exact catalog id (same idea as `matchesRefexCompanyFilter`). No Entity haystack fuzzy match.
5. Keep the 29-name catalog in sync with `REFEX_COMPANY_NAME_LIST`.
6. After deploy: Refresh the ITSM dashboard so engagement_cache is rebuilt. Email runner was not changed.

---

## 8. 29-company list (already the same)

Both codebases list the same 29 labels (3i Medical… through Vyzag Bio-Energy…). Drift risk is low; still treat `REFEX_COMPANY_NAME_LIST` as canonical when changing NE `RAW_LABELS`.

---

## 9. Code map

**aasik_ITSM**

- `src/lib/itDashboardProfiles.js` — `userDetailsLookup: 'Column_bRn4sBWeeF'`
- `src/lib/kfITServiceDashboard.js` — `REFEX_COMPANY_NAME_LIST`, `matchesRefexCompanyFilter`, `extractRefexCompanyNameFromItem`, `applyMisColumnFilters`
- `src/itsm/refex/shared/refexReportQuery.js` — report query (`$entity`, not company)
- `docs/PRODUCT_DECISIONS.md`, `docs/DASHBOARD_LOADING_OPTIMIZATION.md`

**Notification Engine**

- `apps/admin-ui/src/lib/refexCompanies.ts` — 29-list, `recordMatchesCompany`
- `apps/admin-ui/src/lib/appDashboardClientFilter.ts` — `filterAppRecords`, `companyCountsFromRecords`, `stampRecordsWithAssigneeCompany`
- `apps/admin-ui/src/pages/applications/detail/components/AppDashboardTab.tsx` — Company dropdown (embed + main)
- `apps/admin-ui/src/pages/dashboard/page.tsx` — consolidated Company filter
- `services/backend-api/src/lib/appRecords.js` — `companyTextFromRaw`, SQL Entity/Company coalesce

---

## 10. Verify later (when implementing)

ITSM main and `?embed=1`, FY, Entity = All / Refex / Extrovis:

1. Company dropdown names = Kissflow 29-list (Extrovis entity: no company list).
2. Pick each company: NE record count = aasik MIS count for the same period/entity (drafts excluded on both).
3. No ticket with lookup company A appears under company B.
4. Blank lookup counted under Refex Industries Limited.
5. Open/Closed/Rejected/Today still add up after the company slice.
6. PM / P2P / Travel / Solar / Lead / EMS company behaviour **unchanged** unless that app was in scope.
