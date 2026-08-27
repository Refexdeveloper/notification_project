# Procurement to Pay (P2P) — direct read-only MySQL

P2P is **not** a Kissflow app. Dashboards and reports read Cloud SQL MySQL `p2p_system` with a **dedicated read-only user**.

## Hard rules

- Never use `p2p_app` (or root).
- Never `INSERT` / `UPDATE` / `DELETE` / `ALTER` / `DROP` / migrations against `p2p-mysql`.
- No DB mirror unless reporting load starts stressing production.
- Prefer Cloud SQL Auth Proxy / Connector + Secret Manager.

## Env vars (backend-api)

| Variable | Purpose |
|----------|---------|
| `P2P_DB_USER` | Read-only reporting user (e.g. `p2p_reporting_ro`) |
| `P2P_DB_PASSWORD` | Secret |
| `P2P_INSTANCE_CONNECTION_NAME` | `master-diorama-489103-u2:asia-south1:p2p-mysql` |
| `P2P_DB_NAME` | `p2p_system` (default) |
| `P2P_DB_HOST` / `P2P_DB_PORT` | Optional local proxy override |

## Manual RO user (run once yourself — never automated)

```sql
CREATE USER 'p2p_reporting_ro'@'%' IDENTIFIED BY '<strong-unique-password>';
GRANT SELECT, SHOW VIEW ON p2p_system.* TO 'p2p_reporting_ro'@'%';
FLUSH PRIVILEGES;
```

Verify: an `INSERT` with this user must fail.

## Admin UI pattern

Same shell as other apps: Dashboard, Overview, Users, Templates, Schedules, Sent, Settings.

Kissflow-only pieces (Sync fields / process discovery) do not apply until mapped; starter HTML lives at `db/seeds/p2p-engagement-template.html`.

Application id: `Procurement_to_Pay_A00`.

**Listing:** Do not use Add Application (that path validates Kissflow). Backend `GET /api/v1/applications` idempotently upserts P2P into `engagement_reporting.application` via `ensureP2pApplication`. After backend-api deploy, refresh Applications to see **Procurement to Pay**.

## Live schema (p2p_system)

| Table | Role |
|-------|------|
| `purchase_requests` | PR documents — `status` (uppercase), amount `total_amount` |
| `purchase_orders` | PO documents — `status` (enum), amount `grand_total` |

**PR status buckets:** `APPROVED` → closed · `REJECTED` → rejected · all other (`DRAFT`, `PENDING_*`) → open.

**PO status buckets:** `draft` / `pending_*` / `sent_to_vendor` → open · `approved` through `paid` → closed · `rejected` / `cancelled` → rejected.

| `pr_line_items` / `po_line_items` | Line items — not KPI totals |
| `pr_approvals` | Approval workflow — not KPI totals |
| `users` | P2P app users (~1,959) — separate from PR/PO counts |

Dashboard KPIs sum **PR + PO only**, not `user_permissions` / `users` row counts.

Optional env overrides: `P2P_PR_TABLE`, `P2P_PO_TABLE`.

## Code

- `services/backend-api/src/lib/p2pReadonly.js` — SELECT-only guard
- `services/backend-api/src/lib/p2pDashboard.js` — dashboard payload (starts with `information_schema` inventory; map PR/PO status next)
