# Wave14 독립 기대값 교정 검증

- 이 문서는 `validation.md`의 교정 전 receipt SHA-256 `7e38daff...`와 entrySetSha256 `8bc76d03...`을 대체한다. 기존 문서는 최초 실행 이력으로 보존한다.
- 독립 expected fixture commit: `3f3416d4ec843db8856540078f9df19ffd5c055d`
- generator는 위 commit의 fixture Git blob에서 expected reply/result/DML/lock/transaction을 읽고, harness actual artifact와 각각 일치할 때만 receipt를 생성한다.
- receipt: prior 155 + Wave14 5 = 160, 중복 0
- compact receipt 배열: 740,925 bytes, SHA-256 `2d1803d6d217fc60c0357b4aa7a2d7e0b3993233ba571063315c4493ee910975`
- ledger entrySetSha256: `64c457291fad83a2e0ff18cdd62b4f70034613f85ee9b0a1367b3354d0ad229e`
- strict160/AJV/deterministic build: PASS
- recomputed Wave14 output 및 committed import-chain tamper focused: 1/1 PASS
- TypeScript typecheck/build/diff check: PASS
