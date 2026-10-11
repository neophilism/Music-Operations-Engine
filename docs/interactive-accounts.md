# Interactive accounts and short-lived sessions

MOE-02 supports administrator-provisioned interactive accounts without weakening the existing server credential boundary. A system-wide `manage` credential creates an account through `POST /v1/accounts`; there is no public signup route. Email addresses are normalized, passwords are scrypt-derived with independent random salts, and neither passwords nor session bearer values are stored.

Roles derive fixed permissions:

- `tenant_admin`: system-wide read, ingest and management
- `label_manager`: read and ingest for explicitly assigned labels
- `team_member`: read for explicitly assigned labels
- `artist`: read for explicitly assigned labels

`POST /v1/auth/token` issues a random bearer token that expires after 15 minutes. The database stores only its SHA-256 domain-separated digest. Disabled accounts, expired sessions and revoked sessions fail closed. `POST /v1/auth/revoke` revokes only the caller's current interactive session. Account creation, session issuance and revocation are written to the existing audit ledger without credential material.

Production ingress must rate-limit token requests and provide account recovery, identity verification and administrative disablement workflows before interactive access is advertised. This change does not create public self-registration, federated identity, MFA or a production acceptance claim.
