# Idempotency and Replay

## Ingestion

- `sync_run.idempotency_key` = hash(source, resource, sync_type, scheduled_window)
- `sync_page` PK = (sync_run_id, page_number)
- Duplicate page payloads: upsert by payload_hash, no duplicate rows
- Watermark advances only after complete success

## Report execution

- `report_run.idempotency_key` = hash(schedule_id, definition_version, period_start, period_end)
- DB unique constraint prevents duplicate runs from concurrent scheduler overlap

## Rendering

- Unique (report_run_id, content_hash, renderer_version) on `rendered_artifact`
- Same inputs → same checksum

## Notification

- One outbox event per (report_run, artifact, channel)
- Provider retries update `delivery_attempt` — never second logical delivery without new outbox event

## Replay

- `replay_request` references immutable `dead_letter_event`
- Original failure evidence is never mutated
