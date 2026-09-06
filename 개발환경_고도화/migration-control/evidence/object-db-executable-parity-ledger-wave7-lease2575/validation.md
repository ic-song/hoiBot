# Wave7 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `877d24c6147427cef51a81c9356d99a3c405ba09d07a580570e80c48c1502827`.
- Direct Wave7 harness: `15/15 PASS`; actual app-dispatch-faithful Handler → Service → Repository/provider → reply queue execution, exact query and mutation SQL/parameters/order/rows/result, UUID/outbox linkage, duplicate no-call/no-query/DML0, replay READ_ONLY, commit and restart asserted.
- Artifact canonical SHA-256: ledger `9320da8426a72e944da0a060f6eb662a8485ee312d002c0d62553dec905ee5d5`; receipts `67e782282a8f3e39cfeb1c1bd7dd0ce5be8a688de789ee6edf810d3acbeab416`; fixture `1d582b0e41ab310c1c9b94157b853747e1191a66a76a3c6a55493f2936797d40`; runner `7b868dbf565f5d113fa22e39e3cf1fff5ca89b524faa5db419601eafd6548dcf`; target `1d27dfb7da43a01350d4e62ee717e37e264fc90ce7baa8a1f0d8e247f7d70570`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span/chain, exact ordered-query and mutation-trace attestation PASS).
- Focused ledger/Wave1~7 tests: `24/24 PASS`; typecheck, build, object-data contract (`103` registered targets), and `git diff --check` PASS.
- Prior Wave1~6 receipt comparison: `55/55 PASS`; semantic drift `0`, only runner hash and dependent receipt hash refreshed.
- Full suite/T3 remains deferred by lease instruction.
