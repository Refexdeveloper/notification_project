# Notification Outbox and DLQ

## Outbox states

PENDING → CLAIMED → PUBLISHED → PROCESSING → COMPLETED | RETRY_SCHEDULED | DEAD_LETTERED | CANCELLED

## Delivery states

REQUESTED → PROVIDER_ACCEPTED → SENT | FAILED_RETRYABLE | FAILED_FINAL | UNKNOWN_PROVIDER_OUTCOME

## Transaction boundary

Report-ready transaction creates `notification_outbox` row. Provider call happens **outside** the transaction.

## UNKNOWN_PROVIDER_OUTCOME

Timeout after possible SMTP acceptance enters reconciliation — **no blind resend**.

## DLQ

Canonical evidence in PostgreSQL `dead_letter_event`. Operator replay via `replay_request` preserves original failure.

## Retry policy

- Bounded attempts with exponential backoff + jitter
- Abandoned claim recovery via lock timeout
- Terminal failures → DEAD_LETTERED
