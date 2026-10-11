> **Canonical planned-work registry:** [`registry/roadmap.json`](../registry/roadmap.json). This original detailed plan remains available; update new work and PR links only in the registry file.

# Music Operations Engine — complete recovered development plan and cross-account handoff

**Recovery source:** October 9, 2026 project conversation plus [original PR roadmap](../docs/roadmap.md). The first 15 milestone scopes were preserved, plus approved **item 16** for multi-label/family reporting. Milestone IDs are not GitHub PR numbers. Descriptive scopes/acceptance below supplement the original source, not verbatim quoted chat.

## Product and architecture

Reusable, multi-tenant, provider-agnostic music-business intelligence backend that aggregates sales, distributor statements, streaming/reach, speaker engagement, event attendance, royalties and licenses. Distinct from project-development Engine Room and from the brand-specific Unsealed Records Command Center UI.

## Recovered non-negotiable requirements

- Global label/family/all-authorized-label selection with exact scoping; no family can access unaffiliated label financials.
- Tracks require canonical artist, release, label, ISRC and ownership mapping; preserve source and timestamps.
- Live external data adapters need actual approved credentials/APIs; CSV/import/demo data must be labeled; never imply source-live updates from a mocked receiver.
- No mixing money across currency without explicit FX date/rate; no treating pending payments as settled; no treating estimated speaker points as paid royalties.
- TrackZero provides verified external speaker/playback and artist contribution/reward entries; SceneSignal event/session/contributed-speaker metrics. No fabricated device qualification.

## Original 15 milestones and approved 16th addition

### MOE-01 — Foundation, persistence and idempotent ingest

- **Deliver:** Postgres domain, authenticated raw/normalized events, CSV upload, source provenance, sales/streams/points/event reporting, CI.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-02 — Identity, permissions and short-lived tokens

- **Deliver:** Tenant/label/team/artist roles, read/write scopes, API token expiry and audit.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-03 — Durable jobs, retries and source health

- **Deliver:** Async ingest/resync jobs, dead-letter/poison handling, bounded retries, status and timestamps.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-04 — Connector SDK and secret storage

- **Deliver:** Extensible provider adapter manifest, backfill, idempotency, encrypted credentials and field mapping.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-05 — TooLost/distributor statements

- **Deliver:** Real exported CSV schema, ISRC/release linkage, payout status, invoice and settlement reconciliation.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-06 — Spotify/Apple/YouTube authorized reporting

- **Deliver:** Source-specific authorized API ingestion, permission and freshness limits, source-reported estimates.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-07 — Events, ticketing and offline attendance

- **Deliver:** Events, venue/session, check-in privacy and QR attribution.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-08 — TrackZero contributor/play adapter

- **Deliver:** Trusted speaker-play events, points earned/spent, distinct per-artist wallet, fraud/measurement caveats.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-09 — SceneSignal event adapter

- **Deliver:** Session, contributor, set, album sales, attendee and engagement events with provenance.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-10 — Stems White Label license/sale adapter

- **Deliver:** Orders, gross/net/fees, license type, rights/tax and receipts with provider idempotency.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-11 — Canonical artist and catalog mapping

- **Deliver:** Multiple labels, release identity, tracks and ISRC joins, disputes and identity corrections.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-12 — Aggregate rollups at catalog scale

- **Deliver:** Materialized period summaries and pagination for >10,000 events/tracks, exact totals.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-13 — Royalty accounting and payout ledger

- **Deliver:** Multi-party splits, accrual vs settled, refunds, reserves, chargebacks and audit.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-14 — Signed webhook delivery and replay defense

- **Deliver:** Per-producer scoped keys, verification, deduplication, atomic ingest, retries and operation queues.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-15 — Exports, anomaly alerts and acceptance

- **Deliver:** CSV/JSON exports, budgets and outliers, source freshness, reliable reports, security/restore and monitoring.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

### MOE-16 — Added multi-label and family reporting (approved additional scope)

- **Deliver:** UI/API scope selector, combined authorized label views, no data leakage, label identity and catalog ownership.
- **Dependencies:** All upstream domain/API contracts must already pass tests; provider-sensitive screens wait for real adapter data and documented permission.
- **Acceptance:** Isolated, repeatable tests for correct data, wrong tenant/label, absent/late/out-of-order sources, expired token, failure/retry and safe rendering. Check exact large-number handling, source provenance, accessibility where applicable, and no API secret in frontend bundles.

## Original source document, retained here for audit

The following is the verified original checked-in roadmap text, for auditing exact historical scope. The original also remains in docs/roadmap.md.

---

# PR roadmap — reusable Music Operations Engine

1. Foundational domain contracts, Postgres store, idempotent ingest, summaries, tests (PR #1; workflow repaired and checks passing).
2. Role-based accounts and short-lived access tokens; audit trail.
3. Async job system, retry queues, source freshness and error observability.
4. Provider connector SDK, source manifests, secrets encryption.
5. TooLost / distributor CSV mapping and settlement reconciliation.
6. Spotify for Artists / Apple Music / YouTube authorized reporting adapters (based on actual API access).
7. Ticketing and in-person event schema, attendance check-in, privacy limits.
8. TrackZero speaker-play event adapter with anti-fraud and trusted measurements.
9. SceneSignal event sync adapter.
10. Stems White Label sales/license integrations.
11. Artist / release / ISRC canonical catalog mapping.
12. Materialized rollups, pagination and scale beyond 10k records.
13. Revenue recognition, royalty splits, refunds and payout ledger.
14. Signed webhooks, deduplication, replay protection and job queue.
15. Exports, anomaly alerts, budgets and operational acceptance.
16. Added scope: multiple labels, family membership, access-limited label menus, label/catalog identity, and combined reporting (PR #2).

PR #2 also delivers scoped server credentials and an audit trail (part of milestone 2), initial catalog mappings (part of milestone 11), and complete snapshot reporting beyond 10k rows (part of milestone 12). Interactive accounts, collaborator rights, and materialized rollups remain planned; these partial milestones are not marked complete.

PR #3 implements the receiver contracts for milestones 8 and 9, producer SDK support from milestone 4, and signed/duplicate-safe atomic delivery from milestone 14. Source-side field verification, live telemetry producers, polling/reconciliation, secrets-vault infrastructure and async queue administration remain outstanding. Read `platform-contracts.md`, `producer-onboarding.md` and `implementation-status.md` for the boundaries and evidence.

`roadmap.json` preserves the 15-item baseline and the added multi-label milestone. An implemented receiver contract is not a completed live integration.

Every adapter reports provenance, event time, ingest time and source freshness. Never conflate money across currencies or represent estimated payouts as settled revenue.



---

## Cross-account current-state procedure

1. Inspect actual GitHub merged and open PRs, CI, application code, source schemas, migrations, deployed Render/Neon services and Engine Room record. **Do not equate PR number with planned stage or trust stale conversation status.**
2. Verify upstream/downstream boundaries. Unsealed Records Command Center is a separate downstream repo consuming this backend.
3. Maintain stable MOE-01..16 roadmap IDs and map actual PRs + live provider/tenant/deployment evidence independently. Mark planned not complete until tested and merged. Never count mock dashboards or CSV examples as live integrations.
4. Chain routine tested PRs and deploy where access exists. Stop for unavailable provider credentials, privacy/rights decisions, genuine product direction changes, conflicts or failed quality gates.
5. Before calling it production: scoped auth, secrets management, at least one real consumer/provider feed, replay-safe reconciliation, backups, failure alerts, accessibility, and live monitored dashboard/source freshness must all be verified.

## Recovery confidence

The original roadmap source, full 15-item sequence and 16th approved scope are recovered. Additional implementation acceptance language is authored guidance; current live operational status is not implied by documentation.
