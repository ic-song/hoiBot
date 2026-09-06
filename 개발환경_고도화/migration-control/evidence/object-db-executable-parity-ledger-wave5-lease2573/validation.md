# Wave5 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `a91b04cc520d92cc6ed407b9fc5db206e3269992b735964704034f6cfa3392f3`.
- Direct Wave5 harness: `5/5 PASS`.
- Artifact canonical SHA-256: ledger `1df09677529b1ab5faa3b3b71362f0ce10655fbfcf32738b3a2700d67686b6fb`; receipts `343899ff29bd85a251f44fd05c2a2b6c18f56dfb81ea135fa7158a067984153f`; fixture `3809399a3d8b34597795c71ac283ea14874e92cb4a71ab477e6f3f32124ecef0`; runner `bc1eea0a3d301679faba753c0922e9d7de3e1a67842372e74d545b10784b2ed5`; target `3a661de1cebf30f2b6e3ed1327d610b27c1e9d9d4699e7b613b44ea8a64a4b12`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span attestation PASS).
- Focused ledger/Wave1~5/runner tests: `21/21 PASS`; typecheck, build, and object-data contract (`103` registered targets) PASS.
- Prior Wave1~4 receipt comparison: `40/40 PASS`; only additive runner `sourceSha256` and its dependent `receiptSha256` changed.
- Full suite/T3 remains deferred by lease instruction.
