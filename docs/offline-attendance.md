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
