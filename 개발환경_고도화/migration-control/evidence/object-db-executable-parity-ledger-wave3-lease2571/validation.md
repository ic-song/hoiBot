# Wave3 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `3e4e95269e05fc26437a1990a3a657501414115b5e24aa1b9033f78485dc8bae`.
- Direct Wave3 harness: `5/5 PASS`.
- Artifact canonical SHA-256: ledger `5fab3527358ebb9c412eea43741a61e27ff322f673991d1e0357782b9607bd9e`; receipts `b240c1d386b2ab644967c62aeffa18bba154058def383ca85579b9bd25953913`; fixture `982404acd026928b00c3e965d4f7b6bd0fe52d3320bc306d4abf5f46fb5495b0`; runner `88ca07e44a884401b63b07c75e020970f3a678e654375bb9c017e91c5a304e87`; target `ba0af2eaac32ab1d15900945ac0f68c1a621385b4512738463638dc211a437cf`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span attestation PASS).
- Focused ledger/Wave1/Wave2/Wave3/runner tests: `16/16 PASS`; typecheck, build, and object-data contract (`103` registered targets) PASS.
- Prior Wave1+2 receipt comparison: `30/30 PASS`; only additive runner `sourceSha256` and its dependent `receiptSha256` changed.
- Full suite/T3 remains deferred by lease instruction.
