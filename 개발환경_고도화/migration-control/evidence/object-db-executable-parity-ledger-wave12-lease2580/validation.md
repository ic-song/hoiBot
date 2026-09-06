# Wave12 검증

- Wave12 focused: 4/4 PASS, 실제 HTTP 5 DIRECT와 6 risk 실행
- receipt generation: prior 144 hash/prefix 보존, added 5, total 149 PASS
- strict ledger build: 1,111/1,111, proven/direct 29, unproven 1,082 PASS
- strict149 validate: AJV 2020-12 ledger/receipt schema PASS
- entrySetSha256: `993b466d630dca111b16047ef241eba789651c96f766c12b1a123bd0e0898fcd`
- TypeScript typecheck: PASS
- object data model contract: 등록 대상 103개 PASS
- build / diff check: PASS
- combined Wave0~12: 13 suites, 42/52 PASS. Wave12는 4/4 PASS했으나 Wave7~11의 독립 테스트가 현재 소스의 이동 전 고정 span을 직접 읽어 9건 실패했고, Wave0 drift 테스트 1건은 누적 영수증을 역사적 provenance로 검증하도록 바뀐 계약과 기대가 달라 실패했다. 정식 strict149는 각 원래 evidenceCommit을 검증하여 PASS했다.
- 첫 누적 strict 시도는 후속 소스 이동을 Wave7 현재 span에 잘못 대입해 실패했고, 역사적 evidenceCommit 검증으로 보정했다. 운영/소스 mutation은 없었다.
- 다음 strict 시도는 `INSERT IGNORE` allowlist 파싱과 restart operation key 검증 범위를 보정했다. 허용 범위 밖 DML은 계속 fail closed다.
- full suite/T3, Gate8, 운영 DB/운영 데이터는 실행하지 않았다.
