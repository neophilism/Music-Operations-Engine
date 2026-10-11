# Connector manifests and credentials

MOE-04 defines a provider-neutral server-side contract without enabling any live provider.

A connector manifest is scoped to one label and source and records:

- a display name and versioned adapter identifier;
- supported operations: `poll`, `webhook`, `full_backfill`, or `incremental_backfill`;
- an explicit provider-to-canonical field mapping; and
- an opaque, resumable backfill cursor.

The store never returns credential ciphertext with manifest listings. Credentials are encrypted before database persistence with AES-256-GCM, a random 96-bit nonce, authenticated context, and a deployment-provided `CONNECTOR_MASTER_KEY`. The key must be exactly 32 random bytes encoded as base64 and must live in the deployment secret manager, never in the database or repository. Credential reads are intended only for scoped workers and create an audit event.

Generate a key with an approved secret-management tool or `openssl rand -base64 32`. Rotation requires decrypting with the old key and writing a new envelope under the new key; the stored non-secret key fingerprint identifies the envelope version. Losing the key makes credentials intentionally unrecoverable, so recovery procedures must protect the secret-manager value.

This boundary does not connect TooLost, Spotify, Apple, YouTube, TrackZero, SceneSignal, Stems, or any other service. A provider is live only after its approved API/export contract, credentials, field mapping, backfill reconciliation, rate-limit behavior, permission scope, and production monitoring have separate evidence.
