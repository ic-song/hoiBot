# WBS796 Gate 3~6 checkpoint

- Slice: `SL-HOME-BADGE-GACHA-USAGE-PARITY-01`
- WBS: `WBS796`
- Lease: `2635`
- Execution: `홈뱃지사용법DB-SL-HOME-BADGE-GACHA-USAGE-PARITY-01-20260910001611`
- Branch: `codex/object-db-wave29-home-badge-usage-parity-v1-20260910`
- Base: `048fea964ee283e45857602e3b29ff6ce7620420`
- Evidence commit: `83648e269d2c87187b4994a1d46151b43887a1cd`

Gate 3 uses ten synthetic bindings: two consumers times `READ_POSITIVE`, `NEGATIVE_GUARD`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`, and `RESTART_CONSISTENCY`. `AUTH_DENIED` and `WRONG_ROOM_REJECTED` remain frozen as not applicable.

Gate 4 changes only the modern usage formatter for `/홈뱃지오픈2` and `/홈뱃지오픈3`. The formatter includes the actor's current `rank_display` and reproduces the frozen legacy lines exactly. `/홈뱃지오픈3` without an argument remains a valid one-draw command; `/홈뱃지오픈3 안내` exercises usage fallback.

Gate 5 executes the committed target through the committed harness. Restart consistency uses distinct Node child processes and distinct module execution IDs. All paths are read-only and the trace records source-domain DML zero.

Gate 6 preserves the prior 352 receipts exactly and appends ten DIRECT receipts. The ledger becomes DIRECT 50, EQUIVALENT 12, STATIC 989, BLOCKED 82, proven 62, residual 1071 (`C=989`, `D=82`). Gate 7 remains pending independent review.
