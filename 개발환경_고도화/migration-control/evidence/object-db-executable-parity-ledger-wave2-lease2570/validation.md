# Wave2 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `e60cff4e3a177321842defab587f1ed4d5dfb74662e01ce9f662217c9b483943`.
- Strict validator: PASS; ledger and receipt schemas `AJV2020_STRICT_PASS`; Git provenance attestation PASS.
- Focused ledger, Wave1/Wave2, and runner defense tests: `14/14 PASS`.
- Wave2 direct harness executions before ledger build: `15/15 PASS`.
- Wave1 receipt semantic comparison: `15/15 PASS`; only `harness.sourceSha256` and its dependent `receiptSha256` changed.
- `npm run typecheck -- --pretty false`: PASS.
- `npm run build -- --pretty false`: PASS.
- Artifact SHA-256: ledger `54c6cb4ae65c084a6efbd0fd236853539edbdff30b5fc974367935f1df2e3480`; combined receipts `920aec2597dcd09d2de1c399873cdf8fb628e2c5ebf87a97ebd74e51080b8d5c`; Wave2 fixture `2295237baa1f19a402325c55154977d8bde35bd69e786d4819f15e650f01a954`; canonical runner `186b0fe1eaa7d8a247051dbf6abb30a402d18f2a101917d7d9913eb780eb0086`; Wave2 target `d72664cf17821ed2a84b7540929ee6cf7363a6eeb81f73340c2f87c2ebe525ba`.
- Full suite/T3 was not run by lease instruction.
