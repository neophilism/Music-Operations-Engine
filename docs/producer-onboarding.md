# Connect a producer backend

1. Register the owning label and any families using the administrator API. Register its artists, releases and recordings. For each relevant item, add the producer's `trackzero` or `scenesignal` external identity to its catalog mappings.
2. Provision a distinct server credential with `ingest` permission, explicit label IDs, and the relevant source allowlist. Give the Command Center a different credential with `read` permission for its labels. Keep both secrets off the client and out of source control.
3. Configure a random webhook signing secret for the source on both endpoints. Sign backend events after the source has applied its verification, authorization and entitlement rules. Do not accept listener-supplied point numbers as producer evidence.
4. Store a stable delivery envelope in the producer's durable outbox before transmission. After successful acknowledgement, mark the outbox entry delivered. Keep rejected entries available for mapping or data repair. No cron service is needed to observe an event that the producer pushes successfully.
5. Read the label-scoped report and source freshness endpoint to confirm the event's recorded identity, quantity and currency. A receiver configured with no data is still waiting for its producer.

## Producer helper

`src/client.js` exports `sendPlatformEvents`. It posts the exact serialized envelope with a fresh timestamp and HMAC, verifies the acknowledgement identity, and retries transient network/429/5xx responses with the same delivery ID and bytes. It uses HTTPS except for explicit local testing, refuses redirect following, bounds attempts and request time, and accepts an abort signal. A 4xx validation, authorization, or identity conflict requires source repair rather than an automatic retry.

```js
import {sendPlatformEvents} from 'music-operations-engine/client';

await sendPlatformEvents({
  url: process.env.MUSIC_OPERATIONS_URL,
  platform: 'trackzero',
  apiKey: process.env.MUSIC_OPERATIONS_INGEST_KEY,
  webhookSecret: process.env.MUSIC_OPERATIONS_SIGNING_SECRET,
  batch: durableOutboxEnvelope,
  signal: shutdownSignal
});
```

This helper is not the durable outbox itself. The source must retain the envelope across process restarts, handle reporting corrections and supply trustworthy measurements. Async queue administration, source polling and reconciliation remain separate roadmap work.

## Response handling

| Status | Action |
| --- | --- |
| 200 | Commit local acknowledgement; inspect `accepted`, `duplicates`, `duplicateDelivery` |
| 400 / 422 | Repair JSON, schema, recording mapping, measurement or authorization metadata |
| 401 / 403 | Repair the backend key, allowed label/source, signature or source clock |
| 409 | Investigate changed content under an existing identity or conflicting shared physical report |
| 429 / 5xx | Keep the outbox entry and retry within bounded backoff; receiver may be unconfigured |

The current app repositories do not contain these producers yet. Connecting live TrackZero and SceneSignal data is a later app/backend integration step, rather than a claim of a completed connection in this engine PR.
