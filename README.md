# Music Operations Engine

Provider-agnostic music-business ingestion and analytics backend. Label branding and the Command Center stay in their separate application repository.

## Run

Requires Node.js 22+, PostgreSQL, and an `ENGINE_API_KEY`. Install with `npm install`, configure the environment using `.env.example`, then run `npm start`. Run `npm test` and `npm run check` before publishing changes.

`GET /health` probes the database. Authenticated endpoints are `GET /v1/summary`, `GET /v1/sources`, and `POST /v1/ingest`. Supply `Authorization: Bearer <ENGINE_API_KEY>` from a trusted server. Keep this ingestion credential on the server.

Ingestion accepts JSON with a `source` and `facts` array. Each fact has `externalId`, `type`, `occurredAt` (or `date`), and optional integer `quantity`, `amountMinor`, `currency`, `artist`, `release`, and `track`. CSV uses those same column names, supplied as a JSON `csv` string.

Every fact belongs to one label. `GET /v1/scopes` supplies a menu of accessible labels, families, and all accessible labels. Filter summaries, source health, and catalog data with `labelId`, `labelIds`, or `familyId`. Combined reports scan every selected record and preserve canonical release, artist, and track attribution.

Amounts remain separated by currency. Label, source, and external ID identify repeat report rows. Exact large integer totals are returned as decimal strings. Financial facts come from authorized reports; stream counts do not imply revenue.

Use scoped server-side credentials for readers and ingestion services. Read [label/family and catalog contracts](docs/label-scopes.md) and the [remaining roadmap](docs/roadmap.md). `ENGINE_API_KEY` remains a system-wide bootstrap key, with a minimum length of 32 characters. Interactive account authentication remains on the roadmap.
