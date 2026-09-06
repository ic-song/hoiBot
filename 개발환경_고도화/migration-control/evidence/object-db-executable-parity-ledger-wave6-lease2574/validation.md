# Wave6 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `b9edd06eb86afee6981e24280f7457d32586ba78c97b99ff2d4453bc8333e651`.
- Direct Wave6 harness: `10/10 PASS`; exact query SQL/parameters/order/row count, invalid no-query, DML0/READ_ONLY and restart fresh child/module evidence asserted.
- Artifact canonical SHA-256: ledger `31da451d325a54c4a516f1c30dae31154e0672e41eac867170f8ca4493e8f712`; receipts `407fad57134711fbfe249ee46d5a90192f8d442d8bb7bc3e2ab0572d1a9957dc`; fixture `a2c0fe6c75f151b276c41c5340edcc263a180db219df7b0745d97f3bf82a1ec2`; runner `10d7ac30780af9bca4e1800424e01b5af67ae2ef7c7936ef12b7dbf29331c3d0`; target `89b2dc414b5ff956f1167ec20a4a9eb4b3befdf52412d2ce380eefb9fec9cb4a`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span and exact Wave6 query-trace attestation PASS).
- Focused ledger/Wave1~6/runner tests: `24/24 PASS`; typecheck, build, and object-data contract (`103` registered targets) PASS.
- Prior Wave1~5 receipt comparison: `45/45 PASS`; semantic drift `0`, only runner hash and dependent receipt hash refreshed.
- `git diff --check`: PASS. Full suite/T3 remains deferred by lease instruction.

