# Deployment and Cutover Plan

1. Deploy new components **without scheduler activation**
2. Shadow ingestion (read-only compare counts)
3. Compare report checksums against combined pipeline
4. Deliver to **test recipients only**
5. Validate idempotency + DLQ
6. Pause old Cloud Scheduler
7. Activate new scheduler (explicit release step)
8. Observe 7+ days
9. Retain rollback path
10. Decommission old full-pipeline service only after agreed stability period

**Do not delete** `aasik-refex-report-itsm-a00-svcreq-a00-full-pipeline` during this work.

Rollback: re-enable old scheduler, disable new schedule activation, revert Cloud Run traffic to previous revision tags (commit SHA — never `latest`).
