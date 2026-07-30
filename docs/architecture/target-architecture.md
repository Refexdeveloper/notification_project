# Target Architecture

## Services (Cloud Run)

| Service | Type | Visibility | Responsibility |
|---------|------|------------|----------------|
| admin-ui | Service | Public (IAP) | Configuration UI |
| backend-api | Service | Public (IAP) | OpenAPI v1 |
| ingestion-worker | Job | Private | Kissflow → PostgreSQL |
| report-orchestrator | Job/Service | Private | Report run lifecycle |
| email-renderer | Service | Private | HTML → GCS artifact |
| email-dispatcher | Service | Private | Outbox → SMTP |
| outbox-worker | Job | Private | Claim + publish outbox |

Existing combined pipeline (`services/engagement-pipeline`) remains until shadow cutover completes.

## Data stores

- **Cloud SQL PostgreSQL** `engagement_reporting` — operational truth
- **BigQuery** — async analytics (dim/fact tables)
- **GCS** — immutable rendered artifacts
- **Secret Manager** — all credentials

## Idempotency boundaries

- Ingestion: `sync_run.idempotency_key`, `sync_page (sync_run_id, page_number)`
- Report: `report_run.idempotency_key` unique per schedule + period
- Outbox: `notification_outbox.idempotency_key` one per report_run + channel
- Delivery: one logical delivery per `(outbox_id, recipient_email)` attempt chain

See `docs/architecture/idempotency-and-replay.md` and `notification-outbox-and-dlq.md`.
