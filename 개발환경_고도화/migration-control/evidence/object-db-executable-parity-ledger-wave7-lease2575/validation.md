# Wave7 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `a41c1b3b91a82c375bfa1a8c71fb3ee6aadce7a481a8e79917d72ad16debf063`.
- Direct Wave7 harness: `15/15 PASS`; actual Handler → Service → Repository/provider execution, exact query SQL/parameters/order/rows/result, invalid no-query, DML0/READ_ONLY and restart fresh child/module asserted.
- Artifact canonical SHA-256: ledger `83c5452d7ac6976a93fd8c58fe428ed09e0cdf14dab55da65c75f5ae03877b0d`; receipts `f010e1213f4bc6f428c431fa6a51a8a391568a4268afb5402646db22eb089834`; fixture `e1320ac1e76d4326d6146f28825b20a1d564fd5c4386acf2bd7e89ba664b7e73`; runner `47012241eb4bf0a42a8021f62f4232102da81bbc9eb39c4a98b5de74fb9968cb`; target `e531a8eb76253a5e83393de1b268e5c706047e05f0326e7ab4fadf59d0c30b43`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span/chain and exact ordered-query trace attestation PASS).
- Focused ledger/Wave1~7 tests: `24/24 PASS`; typecheck, build, object-data contract (`103` registered targets), and `git diff --check` PASS.
- Prior Wave1~6 receipt comparison: `55/55 PASS`; semantic drift `0`, only runner hash and dependent receipt hash refreshed.
- Full suite/T3 remains deferred by lease instruction.
