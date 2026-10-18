# Distributor CSV settlement import (MOE-005)

This is a **manual exported-file normalization** contract, not a live TooLost connection. The provider's exact export schema must be verified against a real authorized export before supplying explicit column mappings. Imported rows are not automatically recognized revenue, paid royalties, or ledger disbursements.

Call `parseDistributorStatement(csv,{labelId,source,mapping})` with explicit header names for transaction identifier, date, ISRC, currency, gross, fees, net and payout status. A settled row also requires a settlement-reference column. Exact decimal strings become integer minor-unit strings without floating-point rounding, grouped by their original currencies.

The importer fails closed on duplicate transaction IDs, missing headers, invalid ISRC/date/amount, inconsistent gross/fee/net, and unsupported payment states. It produces stable per-label/source/transaction identities, provenance `imported_csv`, and `isLive:false`. Downstream catalog resolution, bank/invoice settlement reconciliation, transactional persistence, reversals, and signed authorized provider feeds remain required for full MOE-005 acceptance. Currency minor-unit exponent is two in this initial schema; only use it with known two-decimal currencies, never JPY or three-decimal currencies.
