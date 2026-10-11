# Music Operations Engine

**Complete development plan and cross-account handoff:** [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

Provider-agnostic music-business ingestion and analytics backend. Label branding and the Command Center stay in their separate application repository.

## Run

Requires Node.js 22+, PostgreSQL, and an `ENGINE_API_KEY`. Install with `npm install`, configure the environment using `.env.example`, then run `npm start`. Run `npm test` and `npm run check` before publishing changes.

`GET /health` probes the database. Authenticated endpoints are `GET /v1/summary`, `GET /v1/sources`, and `POST /v1/ingest`. Supply `Authorization: Bearer <ENGINE_API_KEY>` from a trusted server. Keep this ingestion credential on the server.

Ingestion accepts JSON with a `source` and `facts` array. Each fact has `externalId`, `type`, `occurredAt` (or `date`), and optional integer `quantity`, `amountMinor`, `currency`, `artist`, `release`, and `track`. CSV uses those same column names, supplied as a JSON `csv` string.

Every fact belongs to one label. `GET /v1/scopes` supplies a menu of accessible labels, families, and all accessible labels. Filter summaries, source health, and catalog data with `labelId`, `labelIds`, or `familyId`. Combined reports scan every selected record and preserve canonical release, artist, and track attribution.

Amounts remain separated by currency. Label, source, and external ID identify repeat report rows. Exact large integer totals are returned as decimal strings. Financial facts come from authorized reports; stream counts do not imply revenue.

Use scoped server-side credentials for service integrations and administrator-provisioned interactive accounts for people. Read [label/family and catalog contracts](docs/label-scopes.md) and the [remaining roadmap](docs/roadmap.md). `ENGINE_API_KEY` remains a system-wide bootstrap key, with a minimum length of 32 characters.

TrackZero and SceneSignal have independent signed event endpoints and source-specific summaries. Reports include listening, verified speaker contribution, artist rewards, free Grooves, shared sessions, attendance, and complete-album commerce. The [platform contracts](docs/platform-contracts.md) and [producer onboarding](docs/producer-onboarding.md) describe how their backends connect. The producer SDK is available as `music-operations-engine/client`.

Administrator-provisioned interactive accounts and 15-minute bearer sessions are documented in [interactive accounts](docs/interactive-accounts.md). Public signup, recovery, MFA and production rate limiting remain separate gates.

The receiver contracts are implemented; the app repositories still need live telemetry producers. See [implementation evidence and production gaps](docs/implementation-status.md). Provider-specific consumer experiences remain in their own repositories.
