# WEB-WBS-011A current-player bag provider validation

- 실행 ID: `가방provider-SL-COMMON-INVENTORY-CURRENT-PLAYER-BAG-READ-01-20260910085543`
- Lease: `Lease2641`
- CONTROL: `슬라이스_보고수신!5670` ACTIVE; Lease2641 유지 및 다른 W claim과 비중첩
- 기준: `SC-20260902-1` / `SCD-WEB-20260910-5` / `web-current-player-bag-provider-v1`
- 실행 profile/tier: `SHARED_PROVIDER` / `T2`
- 배정 기준 commit: `ae7665dc9519bde972f54995e1babbdc454ff2ff`
- 구현 commit: `5c9b0b7f5bf71d515c7c79bc4a2f8385084f083d`
- 검증 HEAD: `32934cdf2540cbd3aa47192a7837bba4b31a2d45`

## 계약 검증

- 서비스 입력에는 인증 세션이 확정한 `currentPlayerId`와 pagination만 있다. 별도 target player 입력은 없다.
- player가 `active`이고 `deleted_at IS NULL`이며 profile이 존재할 때만 가방을 읽는다.
- `limit`은 1~100의 safe integer, `offset`은 0 이상의 safe integer만 허용한다.
- 수량은 MariaDB `bigint`에서 decimal string으로 변환하며 `18446744073709551615` 경계를 검증했다.
- 기존 `compareLegacyBagItems`로 전체 목록을 먼저 정렬한 뒤 page를 잘라 페이지 간 legacy 순서를 유지한다.
- 응답에는 `playerId`와 `legacyBagOrder`를 포함하지 않는다.
- 활성 사용자의 빈 가방은 빈 items page로 반환하고, 누락·inactive player는 `CURRENT_PLAYER_NOT_AVAILABLE` 404로 종료한다.

## 실행 결과

```text
node --test --import tsx test/current-player-bag.test.ts test/bag-read.test.ts
tests 9, pass 9, fail 0

npm.cmd run typecheck
PASS

npm.cmd run build
PASS (clean HEAD 32934cdf에서 provider 구현 5c9b0b7f 포함)

git diff --check
PASS
```

## SQL mutation 0

- scripted `DatabaseClient`는 실행 SQL을 모두 기록하고 `execute` 또는 `withTransaction` 호출 시 즉시 실패한다.
- 정상, 빈 가방, inactive/missing 흐름에서 기록된 SQL은 모두 `SELECT`로 시작한다.
- 서비스와 Maria repository source를 정적으로 검사한 DML token(`INSERT|UPDATE|DELETE|REPLACE|MERGE`) match는 0이다.
- schema, migration, 운영 DB/data를 변경하거나 연결하지 않았다.

## Gate evidence

- Gate 1: 기존 `bag.ts`, `legacy-bag-formatter.ts`, `bag-read.test.ts`와 WEB-WBS-011A 동결 계약 재확인.
- Gate 2: self scope, 활성 player, pagination, string quantity, 비노출 응답 계약 확정.
- Gate 3: large quantity, legacy order, empty bag, missing/inactive, invalid pagination 합성 fixture 검증.
- Gate 4: 전용 service와 MariaDB read-only method 구현.
- Gate 5: concrete repository와 service 결합 focused test 통과. app/API/UI 연결은 별도 consumer Lease 대상.
- Gate 6: 기존 comparator 및 기존 `/가방` 테스트를 함께 실행해 ordering 회귀 0.
- Gate 7: `NO-GO`. 실제 API/UI consumer matrix와 동일 입력 Shadow가 아직 없어 P1을 유지한다.
- Gate 8: 범위 제외.

## T2 consumer handoff

- Lease2642의 `app.ts` R이 해제된 뒤 별도 consumer Lease에서 현재 세션의 player ID만 route에 전달한다.
- public query/body에는 target player ID를 허용하지 않는다.
- first/middle/last page, empty bag, inactive/missing player, expired session, unsigned 64-bit 수량을 실제 API와 UI에서 검증한다.
- 같은 fixture를 provider와 legacy comparator에 입력해 page 순서·수량을 Shadow 비교한다.
- 위 matrix와 Shadow가 모두 PASS한 뒤 독립 검토자가 provider/consumer 결합 Gate 7을 다시 판정한다.
