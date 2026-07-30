# Deprecated — MySQL prototype API

This service is **archived**. It was the original Notification Engine prototype:

- Express + Sequelize + MySQL (`notification_engine`)
- Port **4000** in local dev
- JWT login, in-process `node-cron` schedulers

The Admin UI no longer proxies to this service. Use `services/backend-api` and PostgreSQL instead.

Archived on consolidation (Phase 1). Safe to delete after MySQL salvage dry-run confirms nothing unique remains.
