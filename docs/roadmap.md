# PR roadmap — reusable Music Operations Engine

1. Foundational domain contracts, Postgres store, idempotent ingest, summaries, tests (this implementation).
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

Every adapter reports provenance, event time, ingest time and source freshness. Never conflate money across currencies or represent estimated payouts as settled revenue.
