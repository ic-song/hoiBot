# WBS797 Wave30 checkpoint

- executionId: 타이틀조회DB-SL-PLAYER-TITLE-READ-RUNTIME-DISPATCH-PARITY-01-20260910080709
- slice: SL-PLAYER-TITLE-READ-RUNTIME-DISPATCH-PARITY-01
- lease: Lease2638
- profile: READ_UI / T1
- foundationCommit: d099b358352cfa3f22829b9d597f4d48959097d9
- scope: receipt-only; app.ts, player-title provider, projection, DB, migration and operational data unchanged.
- route: candidate → normalized alias → MODERN → exact handlerKey → PlayerTitleReadService.read.
- result: two DIRECT consumers, five receipts each; source-domain DML is zero and trace is READ_ONLY with empty lock order.
- restart: two different Node child PIDs and module execution IDs are asserted by the Wave30 harness.
- prerequisite: PORT_ONLY canonical target is hash-linked to WBS645/648 planning evidence; it is not canonical SQL execution evidence.
- correction: the synthetic projection initially treated the fallback NOT EXISTS subquery as an instance query; the matcher now only accepts the instance SELECT and target player 11 gets the one expected title.
- gates: Gate1-Gate6 evidence prepared; Gate7=PENDING; Gate8=FALSE.
- WBS: canonical Google Sheets was not edited. Latest CONTROL/Lease state is owned by the foreman.
- final validation: typecheck PASS; build PASS; strict AJV2020 ledger and receipt-schema validator PASS.
- focused tests: Wave30 3 + residual plan 4 + player-title read 3 = 10/10 PASS.
- final counts: receipts=372, DIRECT=52, EQUIVALENT=12, STATIC=987, BLOCKED=82, proven=64, residual=1069.
- final hashes: receipts=94f85c72463940775b77052b76527f1e92fa3f1a476e05c6702817fef9ac463a; ledger=62af567bd5715e2ccd154e7bd98c6acc14fc7306359b358269224a91bdbc6d35; residual=9320e6c19bbfd78227b94c161768ae21c5a910a6de777b17fbc2ecb7ea93f1b4; entrySet=e29c4a35a575aaa8ed0d665c2514dddfe03000a721b8b476e1f5003e2c773f24.
