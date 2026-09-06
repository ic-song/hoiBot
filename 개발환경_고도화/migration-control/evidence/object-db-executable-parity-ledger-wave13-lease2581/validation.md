# Wave13 검증

- Wave13 focused: 3/3 PASS, `/서버통계` 실제 `buildApp.inject` 보정 receipt 5건 실행
- actual HTTP MariaDB: 1/1 PASS. prod/dev 전체 바이트, 활성 역할/deny override, wrong room, inbox duplicate, 동일 이벤트 concurrency, fresh app/client replay, fingerprint drift, rollback, source DML0 및 3개 legacy snapshot table UPDATE 차단을 확인했다.
- receipt generation: prior 149 prefix를 변경하지 않고 Wave13 5건을 추가해 총 154건, 중복 0 PASS
- 과거 Wave8 `/서버통계` 6건은 역사적으로 보존했지만 현재 DIRECT 판정 입력에서는 제외했다. Wave13 corrective 5종이 없으면 해당 consumer가 DIRECT가 되지 않는 음성 테스트가 PASS했다.
- strict154: AJV 2020-12 ledger/receipt schema, evidence provenance, deterministic build PASS
- ledger focused: 10/10 PASS. Wave12 149건 전체를 baseline `b5b2600721526e35ff3f5037c10298bae86058ac`, evidenceCommit `2d1b6a4545d2b8beaaf95d3859b237248c4b648b`, compact 636,158 bytes, SHA-256 `14160ca2c95bee198c04ca6223fc796e9b9295b4cd893b8aee7c4f04d5462f28` 및 개별 receipt 원문으로 고정했다. expected/actual과 receiptSha를 함께 다시 계산한 변조도 거부한다.
- ledger: 1,111/1,111, proven/direct 29, equivalent 0, unproven 1,082 PASS. 기존 Wave8 DIRECT를 Wave13 corrective로 대체했으므로 proven/direct는 순증하지 않는다.
- entrySetSha256: `a2d05ec30a2c4f45d4b7b5969bfada717130984f4c4fcf1fda5fe094a66e87fe`
- evidenceCommit: `971112727e4f68be6a389bd933e68f351a7c25b5`
- TypeScript typecheck, build, object data model contract 등록 대상 103개, diff check: PASS
- combined Wave0~13 (`--test-concurrency=1`): 14 suites, 44/56 PASS. Wave13은 3/3 PASS했다. Wave7~12의 12건은 현대 소스 추가로 이동한 과거 고정 source/callsite span을 현재 소스에 적용해 실패한 locator 노후화이며, 역사 receipt 149건의 진위나 strict154 실패가 아니다. 이 범위에서는 과거 receipt를 다시 쓰거나 해당 검사를 현재 span으로 가장하지 않았다.
- 실수로 실행한 두 broad npm 호출은 npm test glob 동작으로 의존성 범위를 확장했고 증빙에서 제외했다. 관련 수정 전 종료되어 운영/소스 mutation은 0이었다. 이후 검증은 exact test file 또는 명시된 validation/build 명령만 사용했다.
- full suite/T3, Gate8, 운영 DB/운영 데이터, 실제 방/외부 네트워크는 실행하지 않았다.
