# Durable jobs and source health

Milestone MOE-03 adds a PostgreSQL-backed control plane for asynchronous ingest and resync work. It does not deploy a worker or imply that a provider is connected.

## Lifecycle

Authorized ingest principals enqueue `ingest` or `resync` jobs with `POST /v1/jobs`. Jobs begin in `queued`, move to `running` when a worker calls `POST /v1/jobs/claim`, and finish as `succeeded`, `retry`, or `dead_letter`. Claims use row locks, carry a five-minute lease, and increment the attempt counter. A later claim recovers an expired lease. Retries must be scheduled within 24 hours and stop at the job's immutable `maxAttempts` value (default 3, maximum 10).

Only the principal that holds a lease can complete or fail that job. Credential label and source allowlists restrict enqueue and claim operations. Job listings omit payloads and remain label scoped; payloads are returned only to the authorized claimant. Payloads are JSON objects capped at 64 KiB and must not contain provider credentials or personal data.

## Endpoints

- `POST /v1/jobs` enqueues a job and returns `202`.
- `POST /v1/jobs/claim` claims up to 100 ready jobs for one source.
- `POST /v1/jobs/{id}/complete` completes the caller's active lease.
- `POST /v1/jobs/{id}/fail` records a stable error code and either schedules a bounded retry or dead-letters the job.
- `GET /v1/jobs` lists status and lifecycle timestamps without payloads.
- `GET /v1/source-health` aggregates backlog, running and dead-letter counts plus last job and success timestamps.

List and health endpoints accept the same `labelId`, `labelIds`, `familyId`, and `source` filters as reports. Operators should alert on backlog age, dead letters and stale `lastSucceededAt`; a null success timestamp means no job has completed for that scoped source.

## Operational boundary

Deploy workers with unique service credentials, short polling intervals, graceful shutdown and metrics. Production still requires worker deployment, queue-depth and lease-expiry alerts, database backup/restore verification, provider-specific idempotency, and runbooks for replaying dead letters. GitHub CI verifies the contract and state transitions but is not evidence of production worker or provider health.
