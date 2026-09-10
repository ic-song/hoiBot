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
