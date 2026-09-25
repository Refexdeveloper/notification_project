# Dashboard KPI / MIS parity — 2026.09.02-d3

Version: `2026.09.02-d3` (`apps/admin-ui/src/lib/dashboardVersion.ts`)

## 2026.09.02-d3

User dropdown no longer collapses two APP_ROLE people who share a last initial (`Vinod Kumar` / `Vinodkumar S`). Dedupe is by email or user id.

Applies to **main** and **`?embed=1`** (same `AppDashboardTab` / `dashboard/page.tsx`).

## 2026.09.02-d2

Users card, user dropdown, and default MIS rows use the Kissflow **APP_ROLE** roster (ITSM **21**), not requesters. Ticket people who are not app members stay on the Records table only.

## Fixes

1. Users card ≡ dropdown `All Users (N)` ≡ MIS row count when no KPI/user filter. Source is APP_ROLE (`metrics.total_users` / `app_users`), not the 75 requester list.
2. Clicking Open, Closed, Rejected, Opened today, or Closed today filters the MIS table and Records table and scrolls to that section. Adoption / Signed-in / Users cards do not filter.
3. Opened today and Closed today appear on every per-app dashboard and the consolidated overview.
4. Assigned to no longer renders as `Unknown`. Names come from Kissflow `_current_assigned_to` / `AssignedTo` / closed-by / requester. `IT Manager Refex` maps to Sakthivel.
5. Drafts stay excluded. Closed today uses `_completed_at` / `_closed_at` (then modified), not created date.

## Revert

Set `DASHBOARD_VERSION` back and restore this file set:

- `apps/admin-ui/src/lib/appDashboardClientFilter.ts`
- `apps/admin-ui/src/lib/personName.ts`
- `apps/admin-ui/src/lib/dashboardEmpty.ts`
- `apps/admin-ui/src/lib/dashboardVersion.ts`
- `apps/admin-ui/src/pages/applications/detail/components/AppDashboardTab.tsx`
- `apps/admin-ui/src/pages/dashboard/page.tsx`
- `apps/admin-ui/src/components/feature/EmbedAppRecordsTable.tsx`
- `apps/admin-ui/src/services/appRecordsApi.ts`
- `apps/admin-ui/src/services/appDashboardApi.ts`
- `services/backend-api/src/lib/appRecords.js`
- `services/backend-api/src/lib/appDashboard.js`
