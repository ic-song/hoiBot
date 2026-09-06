# Wave7 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `461e09ceb26c929bceb169895d88f3d218981b907f6b99c5e75450c6e49e6736`.
- Direct Wave7 harness: `15/15 PASS`; actual app-dispatch-faithful Handler → Service → Repository/provider → reply queue execution, exact query and mutation SQL/parameters/order/rows/result, UUID/outbox linkage, duplicate no-call/no-query/DML0, replay READ_ONLY, commit and restart asserted. Restart operation UUIDs are both UUIDv4 and directly unequal; `distinctOperationKeys=true` is receipt-fingerprinted.
- Artifact canonical SHA-256: ledger `afcf24674a5ebd0c32a5f988cb6d2daf0c7bc4f973f4b100b726b9f64376ff34`; receipts `dbcf4ad0f4b031c82c40c12d5182f835261dc9780dee5273b4901955b15c9b94`; fixture `1d582b0e41ab310c1c9b94157b853747e1191a66a76a3c6a55493f2936797d40`; runner `1f6d63bb5029b3f650b879f5c809c93e059d40ebf8eaa5dd1bcf73ac095b04a6`; target `1d27dfb7da43a01350d4e62ee717e37e264fc90ce7baa8a1f0d8e247f7d70570`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span/chain, exact ordered-query and mutation-trace attestation PASS).
- Focused ledger/Wave1~7 tests: `24/24 PASS`; typecheck, build, object-data contract (`103` registered targets), and `git diff --check` PASS.
- Prior Wave1~6 receipt comparison: `55/55 PASS`; semantic drift `0`, only runner hash and dependent receipt hash refreshed.
- Full suite/T3 remains deferred by lease instruction.
