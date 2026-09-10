# WEB-WBS-011A Gate 7 독립 검토

- 판정: **GO**
- 검토 범위: `Lease2647`, `SL-ITEM-USER-WEB-BAG-READ-INTEGRATION-01`
- 구현 commit: `b1e6e6986e041e6bdd258da9c27cdb4258dac372`
- 증빙 commit: `62815d229e7247925a92e7f08f0e11be4575f421`
- 기준: `SC-20260902-1` / `SCD-WEB-20260910-9` / `web-current-player-bag-integration-v1`

## 독립 대조

- `app.ts`는 `UserAuthService`를 한 번 생성하고, 기존 계정 route와 `GET /api/v1/inventory/current`에 같은 인스턴스를 전달한다.
- 가방 route는 쿠키 세션을 갱신한 뒤 그 세션의 `playerId`만 `CurrentPlayerBagService`에 전달한다. 공개 query/body player selector가 없고 응답에도 `playerId` 또는 legacy order metadata가 없다.
- first/middle/last page, empty, missing/inactive, expired session, invalid pagination, unsigned 64-bit 최대 수량을 확인했다. expired session은 provider SQL 이전에 401로 끝나고, first/middle/last 결과를 연결한 값은 같은 unsorted fixture의 `compareLegacyBagItems` 결과와 일치한다.
- provider와 Maria repository는 `SELECT` read path만 사용한다. scripted database의 `execute`와 `withTransaction`은 실패하도록 구성되어 있으며, 캡처한 SQL도 모두 `SELECT`로 시작한다. source-domain DML은 0이다.
- 증빙의 네 SHA-256 값은 현재 target 파일과 일치한다: `app.ts` `ff1e66d82614c2164de49298245292b6357a61b44406bf1609279570563964e2`, route `5bf4c2d3af78332df5e3ec1f00766071db199e0c57bbd985c636fdcca400d323`, route test `f8b9e62938dca82b4f9bbcf6e5942c7fa52e6c2ff06e7feb5c7199a62f25391d`, wiring test `34da0a943fde9b75401d3e3dd382358fafa5b4620cdd061ec22434c80e2e031b`.
- 구현 diff는 `app.ts`, 신규 current-player route, route test, wiring test만 변경한다. evidence diff는 checkpoint와 evidence 두 파일만 추가한다. 두 diff 모두 whitespace 오류가 없다.
- 로컬 worktree와 hoiBot root의 체크포인트·evidence에서 `Lease2646` claim record는 발견되지 않았다. Lease2647의 실제 변경 파일은 위 네 파일로 한정되어 있고, 로컬 source/evidence 기준으로 Lease2646과의 교차 write 징후는 없다. canonical WBS 원장 비중첩 확인은 작업반장 검증 범위다.

## 재실행 결과

```text
node --import tsx --test test/current-player-bag.test.ts test/bag-read.test.ts test/current-player-bag-web-routes.test.ts test/user-shell.test.ts test/site-web-app-wiring.test.ts
tests 25, pass 25, fail 0

npm.cmd run typecheck
PASS

npm.cmd run build
PASS

git diff --check 0135d902b19a60a705162abc37fd92005f03c037 b1e6e6986e041e6bdd258da9c27cdb4258dac372
PASS

git diff --check b1e6e6986e041e6bdd258da9c27cdb4258dac372 62815d229e7247925a92e7f08f0e11be4575f421
PASS
```

## Findings

- P0: 없음
- P1: 없음
- P2: 없음

Gate 8 운영 준비와 production reflection은 이 검토 범위 밖이다.
