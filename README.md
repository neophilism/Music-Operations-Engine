# Music Operations Engine

Provider-agnostic music-business ingestion and analytics backend. Label branding and the Command Center stay in their separate application repository.

## Run

Requires Node.js 22+, PostgreSQL, and an `ENGINE_API_KEY`. Install with `npm install`, configure the environment using `.env.example`, then run `npm start`. Run `npm test` and `npm run check` before publishing changes.

`GET /health` probes the database. Authenticated endpoints are `GET /v1/summary`, `GET /v1/sources`, and `POST /v1/ingest`. Supply `Authorization: Bearer <ENGINE_API_KEY>` from a trusted server. Keep this ingestion credential on the server.

Ingestion accepts JSON with a `source` and `facts` array. Each fact has `externalId`, `type`, `occurredAt` (or `date`), and optional integer `quantity`, `amountMinor`, `currency`, `artist`, `release`, and `track`. CSV uses those same column names, supplied as a JSON `csv` string.

Amounts remain separated by currency. Source and external ID identify repeat report rows. Financial facts come from authorized reports; stream counts do not imply revenue. The foundation endpoint has a 10,000-record ceiling and reports `partial: true` when reached. The roadmap tracks the replacement reporting and authentication contracts.
