# Wave8 validation

- Direct Wave8 harness: `2/2 PASS`; four consumers, `24` receipt scenarios and `11` risk scenarios execute through actual service chains.
- Retry review: DataStatus/ServerStats deadlock and ServerStats operation-INSERT duplicate success/exhaustion prove attempt-local DML, rollback, final commit or exhaustion, and no committed partial DML.
- Deterministic ledger build: PASS; entry-set SHA-256 `c19beddff9201dc23242e985a0bf7228025fc6791e90b041b4f14cbbc3262236`.
- Artifact canonical SHA-256: ledger `07671ce78446133603ab8f7762f96832f04f130ad9e6eb96ebf8ce5aea9d7487`; receipts `a81cfd067707cb17c4c178a6ffdd9f2ce2df852fe08bcb8051809bbfb8beaf56`; fixture `3f1961f3adcdc2fc975d0100cf391f8cad2981a75736b7ca746e3ea3e855e6db`; Wave8 runner `6ad5f027d539479ddd3eb79a3fe58562ba8750c7cc31d7839bb291cc1e1ebb7a`; target `acf1c53420045c21232f8b64fc3fd10da8528117e5730ada8418a52577fe791e`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; evidence commit ancestry/blob, frozen/current spans, exact queries/DML/locks/transactions and restart UUID attestation PASS).
- Focused Wave0 ledger unit: `8/8 PASS`. Focused Wave1~8: `18/18 PASS`. Typecheck, build, object-data contract (`103` registered targets) PASS; final diff check remains.
- Prior Wave1~7 compatibility: the first combined focused run exposed a shared-runner hash regression. Wave8 was split to a self-contained allowlisted runner; prior `70/70` receipts are now preserved byte-for-byte, semantic drift `0`.
- Independent latest-diff review: `P0=0`, `P1=0`, `P2=0` PASS; prior70 immutability, dedicated Wave8 runner boundary, retry-attempt evidence and artifact hashes were rechecked.
- Full suite/T3 remains deferred by lease instruction.
