# Offline attendance aggregate boundary (MOE-007 increment)

`prepareOfflineAttendance` accepts a single manually attested aggregate scoped to
one label, event, session and source receipt. It rejects any other fields,
including raw QR codes, ticket codes, names, email, hidden and symbol keys.
Counts remain exact decimal strings. The same source receipt has a stable ID;
changed contents have a different hash so a future durable ingest must reject
conflicting replays.

This is not a ticketing-provider feed, a verified individual check-in, a live
attendance counter, or a financial settlement. It stores nothing and does not
itself authorize the attestor. Integrate only behind authenticated label-scoped
writes and a durable uniqueness/conflict transaction. Provider-specific mapping,
QR attribution, consent and retention, out-of-order/failure retry, and the
full acceptance criteria remain pending.

Check: `node --test tests/event-attendance.test.js`.


## Durable aggregate API (MOE-007, implementation in progress)

`POST /v1/attendance` requires authenticated `ingest`, the exact report label and
`manual-attendance` source access. Only the six documented aggregate fields are
accepted. `GET /v1/attendance?labelId=...` requires `read` and the same label/source
scope; optional event/session filters and a bounded limit never widen access.

Migration 6 stores immutable manual delta reports and a transactional audit entry.
An identical receipt retry returns its original report; changed content returns
409. Concurrent inserts converge without overwriting counts. Event time orders
late arrivals independently of receive time. Counts are returned as decimal strings.
The store repeats authorization checks for direct callers. Customer identities,
raw ticket/QR payloads and caller assertions of provider verification are rejected.
These reports are manual attestations, are not added to provider measurements, and
never imply a live ticketing feed. Aggregate reads use `no-store` responses.

Focused tests cover persistence across store recreation, concurrency, conflicts,
audit-outage rollback/retry, wrong label/source/permission, malformed input and
out-of-order delivery. Event/venue integration, QR campaign attribution, retention
and approved provider mappings remain unfinished; PR12 remains draft.
