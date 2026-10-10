# Labels, families, and catalog identity

Every fact belongs to exactly one label. Labels can be members of multiple named families. The engine has no label branding or application UI; it supplies the data and permissions for a label selector in any client.

Create families with `POST /v1/families` (`id`, `name`), then labels with `POST /v1/labels` (`id`, `name`, `familyIds`). These administrative operations require a credential with `manage` permission and explicit system-wide label authority. Registry and ingestion mutations write an audit record.

## Menu and reports

`GET /v1/scopes` returns `labels`, `families`, and an `all` choice. Each family contains only its caller-accessible `labelIds`. A caller who can access one child label cannot see other labels in its family. No data is public.

Report examples:

| View | Request |
| --- | --- |
| One label | `/v1/summary?labelId=label-a` |
| Selected labels | `/v1/summary?labelIds=label-a,label-b` |
| Family | `/v1/summary?familyId=family-a` |
| All accessible labels | `/v1/summary` |
| Period and source | `/v1/summary?familyId=family-a&source=trackzero&from=2026-10-01&to=2026-11-01` |

The same scope selectors apply to `/v1/sources` and `/v1/catalog`. Choose one selector per request. `from` is inclusive and `to` is exclusive. All dates are ISO timestamps with timezone, or UTC calendar dates. Unauthorized explicit label selections fail rather than silently returning other data.

Combined reports select each fact once, including when families overlap. `byLabel`, canonical `byRelease`, `artists`, and `tracks` preserve attribution. Release keys are label-qualified; consumers display each entry's `title` and label name rather than its internal map key. Artist and recording titles are display text, not cross-label identity.

Reports scan the entire authorized selection in keyset pages inside one PostgreSQL repeatable-read snapshot. There is no 10,000-row reporting cutoff. This is accurate bootstrap reporting; materialized rollups remain a later performance milestone. Integer totals use numbers while safely representable, and decimal strings above JavaScript's safe-integer range. Currency totals remain separate.

## Credentials

`ENGINE_CREDENTIALS` is a JSON array of credentials with `id`, a random `key` of at least 32 characters, `labels`, and `permissions`. Permissions are `read`, `ingest`, and `manage`. Optional `sources` restrict both ingestion and reports. `labels: ["*"]` is reserved for explicitly configured system-wide authority. Labels never gain access by sharing a family name.

The compatibility `ENGINE_API_KEY` is a system-wide bootstrap administrator credential. Keep it on trusted servers, and use a `read` credential restricted to the desired labels for Command Center data. Existing root keys shorter than 32 characters must be replaced before startup. This PR does not implement interactive user accounts or short-lived tokens; those remain milestone 2.

## Canonical catalog

`POST /v1/catalog` registers a label-scoped `artist`, `release`, or `track` with stable `id` and display `name`. Releases name their primary `artistId`; tracks name their primary `artistId` and `releaseId`. Optional ISRC and UPC fields are validated. `externalIds` is an array of `{source, externalId}` mappings for provider identities. A mapping cannot silently move to a different catalog item.

Provider events resolve these mappings within their authorized label. They never guess a recording from a title or silently attribute an unmapped recording to another label. Primary-artist identity is the current catalog model; collaborator splits remain part of the future royalty/catalog work.

The schema migrates older facts into a visible `default` label named **Unassigned legacy facts**. It does not guess their owner. The label/source/external-ID unique key preserves idempotency when older rows are reimported with the new key format.

Run `npm test` for local PostgreSQL-engine checks through PGlite. CI also runs the same migrations, HTTP requests, catalog operations, legacy migration, and 10,001-record report against the hosted runner’s PostgreSQL service.
