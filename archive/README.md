# Archive

Deprecated code kept for reference and one-time salvage only. **Do not run in production.**

| Path | Former location | Status |
|------|-----------------|--------|
| `prototype-mysql-api/` | `services/prototype-mysql-api/` | Archived — MySQL + Express prototype (port 4000) |

Production stack:

- **Database:** PostgreSQL `engagement_reporting` (Cloud SQL)
- **API:** `services/backend-api` (OpenAPI v1, port 8080)
- **UI:** `apps/admin-ui` with `VITE_USE_BACKEND_API=true`

To salvage remaining MySQL-only config (dry-run): `ops/runbooks/05-mysql-prototype-salvage-dry-run.sh`
