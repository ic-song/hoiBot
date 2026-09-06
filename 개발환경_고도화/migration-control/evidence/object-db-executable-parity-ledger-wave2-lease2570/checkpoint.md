# Wave2 checkpoint

- After: manifest/ledger `1111/1111`; `DIRECT_PASS=6`, `STATIC_ONLY=553`, `BLOCKED_DYNAMIC=552`, `PARTIAL=0`, `EQUIVALENT_PASS=0`.
- Proven/unproven: `6/1105`; newly proven IDs are the three resolver consumers listed in `audit.md`.
- Registry mismatch remains `8` total and `8` unattributed; unresolved dynamic remains `552` consumers / `790` calls.
- Wave1 three consumers and their five-scenario evidence semantics are retained. Their receipts were re-signed only because the reused runner gained an additive Wave2 row adapter; final validation re-executes all Wave1 receipts against that committed runner.
- This checkpoint does not claim full 1,111 proof, WBS744 completion, Gate7, Gate8, or production readiness.
