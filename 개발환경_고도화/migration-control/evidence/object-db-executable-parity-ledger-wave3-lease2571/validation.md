# Wave3 validation

- Deterministic ledger build: PASS; entry-set SHA-256 `cfe7f0082573d9955b59b5392cbf79cd6481c4ee82d2d991c2a5cb10f4966357`.
- Direct Wave3 harness: `5/5 PASS`.
- Artifact canonical SHA-256: ledger `4fa56e9e842ba228c147d952d088f356dbc691eb0e0ac11558db39e4a48b314d`; receipts `f6a93153f1ba020b3c23a94c2449497261129ff745f94f04f432585b1d35fff1`; fixture `ce356b584f9ad930e6e736b8fab1dcacb7e695fe3d96daf56078ac158584eae6`; runner `88ca07e44a884401b63b07c75e020970f3a678e654375bb9c017e91c5a304e87`; target `ba0af2eaac32ab1d15900945ac0f68c1a621385b4512738463638dc211a437cf`.
- Strict validator: PASS (`AJV2020_STRICT_PASS` for ledger and receipts; ancestry/blob/span attestation PASS).
- Focused ledger/Wave1/Wave2/Wave3/runner tests: `17/17 PASS`; typecheck, build, and object-data contract (`103` registered targets) PASS.
- Prior Wave1+2 receipt comparison: `30/30 PASS`; only additive runner `sourceSha256` and its dependent `receiptSha256` changed.
- Full suite/T3 remains deferred by lease instruction.
