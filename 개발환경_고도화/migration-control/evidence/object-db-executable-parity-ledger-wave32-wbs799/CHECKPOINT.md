# WBS799 Wave32 실행 체크포인트

- 작업 키: `object-db-wave32-wbs799`
- 표시 이름: `SL-MEMBER-TITLE-LEGACY-INFO-READ-PARITY-01`
- 실행 프로필/등급: `STANDARD_CONSUMER / T1`
- consumer: `legacy-798257cac0e93e27`
- Lease: `Lease2654`
- branch: `codex/object-db-wave32-member-title-legacy-info-read-parity-v1-20260910`
- base: `3ce2e0cd2c52d863534bb068312637c3e3f4f0cd`
- 운영 자산: 변경 없음
- Gate 8: `FALSE`, 승인 전 변경 금지

## Gate 상태

- Gate 1 현행 조사: 기존 WBS evidence에 따라 `TRUE`
- Gate 2 DB 매핑: 기존 WBS evidence에 따라 `TRUE`
- Gate 3 합성데이터: `FALSE` — 표준 5개 fixture는 작성했지만 P1 해소 후 최종 확정 필요
- Gate 4 구현: `FALSE` — 이번 Lease는 runtime source R-only이며 correction 구현 권한 없음
- Gate 5 통합: `FALSE` — provider guard가 없어 같은 운영 상태 통합 불가
- Gate 6 parity: `FALSE` — castle siege active 입력에서 legacy/modern reply 불일치
- Gate 7 Shadow: 수행·판정하지 않음
- Gate 8 운영 준비: 수행하지 않음

## P1 gap

- committed `main.js`의 `msg.startsWith("/타이틀정보")` 분기는 `if (castleSiegeFlag) return;`으로 siege-active 상태에서 `NO_REPLY`를 반환한다.
- `runtime/src/app.ts`는 `player_title_info_read` 별칭을 MODERN으로 선택한 뒤 `PlayerTitleReadService.read()`를 직접 호출한다.
- `runtime/src/player/player-title-read-service.ts`에는 `guild_territory_wars`, `castle_battle_seasons`, `blocked_by_castle_siege` 또는 같은 의미의 운영 상태 guard가 없다.
- 실제 `buildApp` Iris ingress에서 같은 `/타이틀정보 2`와 siege-active evidence를 사용하면 legacy는 `NO_REPLY`, modern은 상세정보 reply를 생성한다.
- Wave32 generator는 이 mismatch가 존재하는 동안 cumulative receipt387과 ledger/residual을 쓰지 않고 `P1_CASTLE_SIEGE_PARITY_GAP`으로 종료한다.

## 실제 실행 결과

- evidence input commit: `c5203c1b1d9c58925d043823c38967ed297358f5`
- generator: exit `1`, `P1_CASTLE_SIEGE_PARITY_GAP: 1 of 5 Wave32 receipts blocked; cumulative ledger was not generated`
- 일반 시나리오 4개: legacy/modern exact reply parity `PASS`
- siege-active NEGATIVE_GUARD: legacy `NO_REPLY`, modern `player_title_info_read` MODERN route/service 1회 및 상세 reply, parity `FAIL`
- 모든 5개 실행: transaction `COMMIT`, source-domain DML `0`
- restart: child PID 2개와 module UUID 2개가 서로 다르고 reply/result가 동일
- pass candidate는 4개지만 표준 5 receipts가 완결되지 않아 어느 것도 cumulative receipt로 승격하지 않았다.
- Wave32 cumulative receipt 파일: 생성되지 않음

## 파일 SHA-256

- contract: `cbaf8bfc0ef150840d9d6fef7109ec8c9b2db5a3c636eae5a324ee6f0fe2c189`
- harness: `6a6593563766775cb1578b64f7aa7b4aed98c20f656c587df5136395592a155a`
- target: `56478c95c81083030642a93ef7b0b38bdfab9fed41cfc2a07cd9a376c65c8274`
- generator: `5847c2984c71a50a4ed578b58e0107228224615dcab2e3c6ef9fa5f3de4db4db`
- focused test: `3774d6d57de97aca9790ad07c273a06698d027a80774b0425c6a09f989a1b2ab`
- gap observation: `6cbb5d0d3a77480882927cb2542910cc64e01deecc7c0aaa34c2f215e81345fb`

## 최소 correction 제안

- 책임 자원: `개발환경_고도화/runtime/src/player/player-title-read-service.ts`와 기존 siege 상태 provider/DB read contract.
- `PlayerTitleReadService.read()` transaction 선두에서 기존 조회 서비스와 같은 `guild_territory_wars WHERE active=TRUE LIMIT 1` 상태를 읽고 active이면 `null`을 반환해 outbox reply와 title-domain query를 만들지 않는다.
- app.ts 공용 dispatch 변경은 필요하지 않으며, 서비스 경계에서 legacy의 운영 guard를 보존하는 것이 최소 범위다.
- provider correction은 별도 W Lease와 별도 책임자가 수행해야 한다. 해소 후 이 Wave32 5개 scenario를 재실행하고 receipts387, ledger, residual을 생성한다.

## 불변 기준

- Wave31 receipts: `382`
- Wave31 prefix bytes: `1,588,071`
- Wave31 prefix SHA-256: `df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506`
- 과거 prefix 243/324/352/362/372/382는 수정하지 않는다.
- `main.js`, `Info.js`, `app.ts`, player-title service/projection, migration, 운영 DB/data/3306, `feature/prod`는 변경하지 않는다.

## 검증

- Wave32 deterministic blocker focused test: `2/2 PASS`
- Wave31 cumulative regression: `3/3 PASS`
- residual plan + player-title unit regression: `7/7 PASS`, MariaDB integration `SKIP`(외부 DB 미사용)
- current Wave31 strict validator: `PASS`
- AJV2020 ledger schema: `PASS`
- AJV2020 receipt schema: `PASS`
- immutable ledger entry set: `52f95816dbc2a526b392d22ac3030cf92f563e2bb1e391cc061f8945956c2529`
- immutable coverage: manifest/ledger `1133/1133`, DIRECT `54`, EQUIVALENT `12`, proven `66`, residual `1067`
- `npm run typecheck`: `PASS`
- `npm run build`: `PASS`
