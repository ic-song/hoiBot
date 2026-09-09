# Wave12 검증

- Wave12 focused: 4/4 PASS, 실제 HTTP 5 DIRECT와 6 risk 실행
- receipt generation: prior 144 hash/prefix 보존, added 5, total 149 PASS
- strict ledger build: 1,111/1,111, proven/direct 29, unproven 1,082 PASS
- strict149 validate: AJV 2020-12 ledger/receipt schema PASS
- entrySetSha256: `993b466d630dca111b16047ef241eba789651c96f766c12b1a123bd0e0898fcd`
- TypeScript typecheck: PASS
- object data model contract: 등록 대상 103개 PASS
- build / diff check: PASS
- combined Wave0~12 최초 실행: 13 suites, 42/52 PASS. Wave7~11 독립 테스트의 9건은 현재 소스에서 이동 전 고정 span을 직접 읽어 실패했다. 이는 역사적 영수증 진위 실패가 아니라 현재-source 회귀 테스트의 locator 노후화이며 이번 범위에서는 수정하지 않았다.
- 최초 combined의 나머지 Wave0 실패 1건은 과거 receipt의 expected/actual과 receipt hash를 함께 바꾸면 재실행 생략 경계에서 수용되는 실제 validator 결함이었다. Wave11 완성본 root commit `bfa3a1b868b88676cd4ea82b44a6bd22f280ca62`, 내부 evidenceCommit `28a04f25af5d29f1abe957b8b9886746bb1481f9`, 144건 compact byte 587,926, SHA-256 `5988f41608a9d5024f8ff11538b6cb9f7460bce76cb511607d104f5e0142b639` 및 개별 receipt 원문을 고정해 보정했다. 해당 Wave0 음성 테스트는 focused 재실행 PASS다.
- 보정 후 combined 전체는 재실행하지 않았다. 알려진 잔여 실패는 위 stale locator 9건이며 정식 strict149와 Wave12 4/4는 각각 재실행 PASS다.
- 첫 누적 strict 시도는 후속 소스 이동을 Wave7 현재 span에 잘못 대입해 실패했고, 역사적 evidenceCommit 검증으로 보정했다. 운영/소스 mutation은 없었다.
- 다음 strict 시도는 `INSERT IGNORE` allowlist 파싱과 restart operation key 검증 범위를 보정했다. 허용 범위 밖 DML은 계속 fail closed다.
- full suite/T3, Gate8, 운영 DB/운영 데이터는 실행하지 않았다.
