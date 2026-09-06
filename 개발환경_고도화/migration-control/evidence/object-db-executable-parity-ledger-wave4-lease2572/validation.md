# Wave4 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `f39a4f0a88aa95eb5773880061ee11447bb6fc55ce262998448d0f8a174bb02a`.
- Direct Wave4 harness: `5/5 PASS`.
- Artifact canonical SHA-256: ledger `07afafa7e87614ea93da22ad2cbcab62075f9a5dd610c31595a04dd517ac0862`; receipts `3fef14365dc5b9aab4f4c9c9bbf884a57948149e1ff7a8e65b74f5041c2be0f6`; fixture `bfe53eba349bf34d82da8904a944a8e6aa4319dad7df0928e30e5d762e727434`; runner `c35e7becc496978aa683e5dbe2fab85d59f2e2d7eea642d220b49e9cf2c0e6c3`; target `ba2fbfd9cba70a152d044d81b74bee15dc5665530e091c313eb8c497f5606193`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span attestation PASS).
- Focused ledger/Wave1/Wave2/Wave3/Wave4/runner tests: `19/19 PASS`; typecheck, build, and object-data contract (`103` registered targets) PASS.
- Prior Wave1~3 receipt comparison: `35/35 PASS`; only additive runner `sourceSha256` and its dependent `receiptSha256` changed.
- Full suite/T3 remains deferred by lease instruction.
