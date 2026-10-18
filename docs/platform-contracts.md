# TrackZero and SceneSignal telemetry — schema 1

These are implemented receiver contracts, not a claim that either app is live or connected. Their repositories currently provide product specifications. Source backends must implement the exporters and verification controls before production data can arrive.

The contracts follow [TrackZero's pinned specification](https://github.com/neophilism/TrackZero/blob/db1ff093103dffa09d659b0fc0698407db621ce1/docs/product-specification.md) and [SceneSignal's pinned specification](https://github.com/neophilism/SceneSignal/blob/45db973007327b4ef76dfc9edf97a69f740d37b2/docs/product-specification.md).

## Delivery and authorization

Send `POST /v1/platforms/trackzero/events` or `POST /v1/platforms/scenesignal/events` with `Authorization: Bearer <scoped backend credential>`. The credential requires `ingest` permission for the envelope's label and source. Configure independent `TRACKZERO_WEBHOOK_SECRET` and `SCENESIGNAL_WEBHOOK_SECRET` values of at least 32 random characters. Unconfigured ingestion returns 503.

Every envelope has exactly these fields:

```json
{
  "schemaVersion": 1,
  "deliveryId": "stable-outbox-delivery-id",
  "labelId": "label-a",
  "events": []
}
```

Supply 1–1,000 events, within the 5 MB request bound. Each event has a stable `id`, an event `type`, and ISO `occurredAt`. Unix **seconds**, as a decimal string, go in `x-music-timestamp`. Set `x-music-signature` to `sha256=` followed by lowercase hex of HMAC-SHA256 over `timestamp + '.' + exact UTF-8 request bytes`. Both headers are required; timestamps have a five-minute past/future allowance. Compute a fresh timestamp/signature when retrying an older outbox delivery.

The engine commits delivery reservation, immutable event identities, facts and audit evidence in one database transaction. Identical delivery retries acknowledge zero new facts. An event repeated in a new delivery also adds zero new facts. A reused delivery/event ID with changed content returns 409 and rolls back the entire batch. Delivery IDs retain the same serialized payload on retry; do not create a new ID to conceal a correction. Corrected financial reporting needs a separate adjustment identity. PostgreSQL constraints handle concurrent duplicate deliveries.

Each event belongs to one owning label. Resolve external identities through label-scoped catalog mappings. There is no inference from artist or song titles. A missing mapping returns 422 without consuming its delivery ID. Configure mappings, then retry the same delivery.

## TrackZero event types

| Type | Required fields beyond id/type/occurredAt | Reported behavior |
| --- | --- | --- |
| `radio.listen_completed` | `externalTrackId`, `durationMs`, `broadcastOccurrenceId` | One completed listen; ordinary listening duration |
| `speaker.points_vested` | `externalTrackId`, `externalArtistId`, `broadcastOccurrenceId`, `verificationReceiptId`, `policyVersion`, `durationMs`, `verifiedOutputMs`, `outputCount`, `pointsMicrounits`, `route`, `measurementStatus`, `completionStatus` | Vested speaker plays and artist contribution points |
| `reward.redeemed` | `externalArtistId`, `pointsMicrounits`, `rewardId` | A redeemed artist reward and reported points spent |
| `groove.granted` | `externalTrackId`, `opportunityId` | A free Groove grant, independent of speaker contribution |
| `album.sale` / `album.refund` | `externalReleaseId`, `quantity`, `amountMinor`, `currency`, `productKind` | Complete-album commerce, grouped by currency |

`durationMs` is a positive integer of up to 24 hours. `outputCount` counts distinct, independently verified active outputs for this occurrence. `verifiedOutputMs` is positive and no greater than duration × output count. All these values are integers. Point quantities are decimal integer **microunits**, with one point equal to 1,000,000 microunits. Use strings for arbitrary-precision point amounts and numbers only when safely representable. A vested point event requires a positive quantity, `route: "bluetooth_speaker"`, `measurementStatus: "verified"`, and `completionStatus: "closed"`.

The source signs only after completion and the closing identification, calibrated measurement checks, supported-device checks, safety-policy checks, physical-output deduplication, and creator allocation. The engine accepts the resulting **producer attestation**; it does not independently establish acoustic level, hardware calibration, audience reach, or field acceptance. Reuse of the same beneficiary/occurrence/verification receipt cannot multiply credited reporting. A receipt with conflicting quantities, point values or recording identity is rejected.

There is no location requirement, proximity reward, headphone point credit, provisional point credit, or linear sum of decibel readings. Logarithmic acoustic-energy accounting remains the Distributed Radio Engine's responsibility. Ordinary completed listens and Groove grants need no speaker contribution. The source remains responsible for exclusive bonus-recording classification and immutable reward entitlements.

`externalArtistId` resolves the beneficiary. Vested contribution currently requires the recording's mapped primary artist. Collaborator shares and secondary rights-holder attribution need the planned catalog/royalty extension; do not silently credit them to another wallet. The Operations Engine observes rewards and points; it does not issue rewards, mutate listener wallets, or combine artist wallets. Point totals in a label/family report are **observed activity**, not a spendable balance.

`productKind` is always `album`, currency is a three-letter uppercase code, and quantity is positive. Amounts are nonnegative integer minor currency units. Refunds remain separate from sales. No stream count is converted into money, and reported commerce is not automatically a settled payout.

## SceneSignal event types

All events require `sessionId`. Session activity also requires `authorizationStatus` (`permit_verified` or `organizer_attested`) and `authorizationValidUntil` later than event time.

| Type | Additional required fields | Reported behavior |
| --- | --- | --- |
| `session.created` | Authorization fields | One session creation |
| `session.music_played` | `externalTrackId`, `durationMs`, authorization fields | A recording occurrence and music duration |
| `session.attendance` | `quantity`, `reportingMode: "delta"`, authorization fields | Attendance entries reported for a distinct arrival interval |
| `session.speaker_contribution` | `durationMs`, `verifiedOutputMs`, `outputCount`, `measurementStatus: "verified"`, authorization fields | Source-verified speaker contribution intervals |
| `session.reward_redeemed` | `externalArtistId`, `rewardId`, authorization fields | Session reward activity, without radio points or Grooves |
| `album.sale` / `album.refund` | `externalReleaseId`, `quantity`, `amountMinor`, `currency`, `productKind: "album"` | Session-associated complete-album commerce |

The producer enforces the uploaded-permit or specific no-permit-required attestation and its lifetime. Operations receives only status metadata, never the permit or its contents. Commerce may be reported after the physical session authorization expires; it does not reactivate the venue.

Session IDs are globally stable within SceneSignal. A family sees a shared session once even when multiple labels' recordings appeared there. Reused attendance-report and speaker-report IDs must describe the same physical measurement across labels; conflicting copies are rejected atomically. Same-ID copies count once in the combined report but remain visible in each label's association. Attendance is a positive delta, not a zero-entry record or repeated cumulative snapshot. Attendance totals are **entries**, not identified unique people or a claim that the label's music was heard. Speaker totals sum interval contributions, not unique physical devices across the entire reporting period.

## Reports and freshness

`GET /v1/platforms` lists each authorized platform, receiver configuration, record count and latest ingestion/event times in the selected label/period scope. `awaiting-producer` means this selection has no received facts. Receiver configuration is not proof of live producer connectivity.

`GET /v1/platforms/{platform}/summary` accepts the same label, family, selected-label and period filters as `/v1/summary`. The general summary includes both platforms together. `platforms.trackzero` reports completed listens, listening milliseconds, speaker plays, verified output milliseconds, earned/spent point microunits, rewards, Grooves, album quantities and currencies. `platforms.scenesignal` reports associated sessions, music plays/duration, attendance entries, speaker contribution intervals, rewards and commerce.

The same platform metrics appear in `byLabel`, release rows, artist rows, track rows and daily buckets. Shared-event totals are deduplicated, so a family's physical attendance/session totals may be lower than the sum of its label associations. Each accepted transaction is immediately available to the next report request. HTTP clients can refresh their selected view without a scheduled reconciliation job.

## Data boundary

These intentionally disclosed aggregate business fields are available only to authorized label operators. Strict field allowlists reject precise location, listener identity, microphone recordings, permits, private scene controls, encrypted-media keys and arbitrary metadata. Protected media, private telemetry and authorization documents stay with their endpoint-encrypted source systems. The engine stores selected business facts and digests, not raw webhook bodies. Signing secrets remain in server environment configuration.

This is operational reporting and an integration contract. It does not certify independent security review, field measurement verification, entitlement rights, user identity, or production deployment acceptance.
