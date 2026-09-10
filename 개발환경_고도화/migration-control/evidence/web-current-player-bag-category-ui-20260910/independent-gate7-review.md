# WEB-WBS-011C provider + 011D UI 독립 Gate 7 검토

- 판정: **GO**
- 검토 대상: `WEB-WBS-011C` / `SL-ITEM-USER-WEB-BAG-CATEGORY-READ-01`, `WEB-WBS-011D` / `SL-ITEM-USER-WEB-BAG-CATEGORY-UI-01`
- 독립 검토 Lease: `Lease2654`
- 검토자 독립성: 구현, 기능 ownership, 제출 evidence 작성에 참여하지 않은 검토자가 수행했다.
- provider 구현 commit: `eb542f2f140b7a8875cd6886de5756d6b066f2cb`
- provider evidence commit: `512db10fff923f5d731bbc6d0ae4ca9c240c798c`
- UI 구현·evidence commit: `584b24cee6ac58b5faf26e9cd867b60351535a4f`
- 검토 시 원격 기준: `HEAD == origin/feature/web-portal == 584b24cee6ac58b5faf26e9cd867b60351535a4f`
- catalog delta / evidence schema: `SCD-WEB-20260910-12` / `web-current-player-bag-category-provider-v1`, `SCD-WEB-20260910-13` / `web-current-player-bag-category-ui-v1`
- execution profile / tier: `SHARED_PROVIDER / T2`, `READ_UI / T1`
- Gate 8: `FALSE`. 운영 DB/data, migration, `feature/prod`는 검토·변경 범위 밖이다.

## 독립 검토 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| no-category / general parity | PASS | route 통합 test가 동적 `requestId`만 분리한 뒤 두 응답을 deep-equal로 비교하고 두 응답 모두 category 필드를 추가하지 않음을 확인한다. service의 general 경로는 기존 comparator, 필터, pagination 코드를 그대로 공유한다. |
| self scope / active owner | PASS | route 입력의 player ID는 refresh된 session에서만 가져온다. repository는 `players.id = ?`, `status = 'active'`, `deleted_at IS NULL`과 profile join을 먼저 만족한 player만 furniture query에 전달한다. public target-player 입력은 없다. |
| furniture status / order | PASS | furniture query는 `instance.player_id = ? AND instance.status = 'bag'`이며 `charm_snapshot DESC`, display name collation, stable instance ID 순으로 정렬한다. first·middle·last와 `placed`·`sold` 제외 fixture가 통과했다. |
| lossless / minimized response | PASS | uint64 최대 charm은 decimal string으로 유지된다. furniture item은 `displayName`, string `quantity`, string `charm`, `gradeDisplayName`만 반환하며 player·instance·definition ID를 노출하지 않는다. |
| unknown category | PASS | `general`·`furniture` 외 `Furniture`, `pet`, `가구`, 공백 suffix가 모두 `BAG_CATEGORY_INVALID` HTTP 422로 끝나고 DB query는 0회다. |
| DML 0 | PASS | 대상 source의 DML·transaction·outbox 정적 검사가 통과했다. scripted database는 `execute`와 `withTransaction`을 실패시키며, focused route 실행에서 기록된 SQL은 전부 `SELECT`였다. |
| UI discriminant / field rendering | PASS | furniture 선택 시 `category: "furniture"`를 요구하고 다른 typed 응답을 오류로 처리한다. 이름·등급·매력도·수량 1은 `textContent`로만 표시하며 내부 ID와 이름 기반 category 추론이 없다. |
| stale request | PASS | request sequence와 requested category를 모두 비교한다. 독립 headless Chrome에서 지연 furniture 응답 뒤 빠른 general 전환을 실행해 최종 `최신 일반`만 남고 `지연 가구`는 표시되지 않음을 확인했다. |
| session clear / top balances | PASS | 401은 `showLogin`→`clearSensitiveView`로 가방 목록·pagination·category·상단 point/diamond를 지운다. unit replay와 독립 browser replay에서 잔액 문자열 보존을 확인했다. |
| keyboard / focus / target | PASS | tab은 roving tabindex와 Left·Right·Home·End 처리를 가진다. 독립 Chrome replay에서 ArrowRight/Left 후 선택 탭과 `document.activeElement`가 일치했고 tab 높이는 44px였다. 공통 `:focus-visible` 3px outline도 유지된다. |
| responsive / overflow | PASS | committed PNG를 직접 열어 확인하고 `responsive-results.json`을 독립 assertion으로 재검산했다. 375×812, 768×900, 1024×900, 1440×900 모두 image dimension과 viewport가 일치하고 `scrollWidth === innerWidth`, overflow 0, tab 44px, field·balance string 보존이었다. |
| wiring | PASS | `/account/inventory` shell과 `registerCurrentPlayerBagWebRoutes`가 `app.ts`에서 각각 한 번 등록되고 API는 같은 `UserAuthService`와 `MariaBagRepository`를 사용한다. focused wiring test가 통과했다. |
| 범위 | PASS | 세 target commit을 각각 검사했다. `584b24ce`의 부모에 있는 병행 admin commit `f8bf316b`는 이번 판정에서 제외했다. target에는 migration, DB/data, bot source, `feature/prod`, Gate 8 변경이 없다. |

## 독립 재실행

```text
node --import tsx --test test/current-player-bag.test.ts test/current-player-bag-web-routes.test.ts
tests 17, pass 17, fail 0, skipped 0

node --import tsx --test test/user-shell.test.ts test/site-web-app-wiring.test.ts
tests 19, pass 19, fail 0, skipped 0

npm.cmd run typecheck
PASS

npm.cmd run build
PASS

git diff eb542f2f^ eb542f2f --check
git diff 512db10f^ 512db10f --check
git diff 584b24ce^ 584b24ce --check
PASS
```

추가 독립 Chrome replay는 375px viewport에서 keyboard focus 이동, 44px tab, point·diamond 원문 문자열, horizontal overflow 0, 지연 furniture 응답 폐기를 함께 확인했다. 결과는 `selectedGeneral=true`, `item=최신 일반`, `staleFurnitureVisible=false`, `activeElement=inventory-general-tab`, `tabHeight=44`, `overflow=false`였다. 이 replay는 제출 evidence를 수정하지 않는 일회성 검증으로 실행했다.

## 직접 재계산한 해시

Git commit 객체를 `git cat-file commit <hash> | git hash-object -t commit --stdin`으로 다시 계산했다.

- `eb542f2f140b7a8875cd6886de5756d6b066f2cb`
- `512db10fff923f5d731bbc6d0ae4ca9c240c798c`
- `584b24cee6ac58b5faf26e9cd867b60351535a4f`

현재 검토 source와 evidence의 SHA-256은 다음과 같다.

- `runtime/src/inventory/current-player-bag-service.ts`: `881bce90ee0165b225f4376a5dba1bf70552b7d22cf881caa0a44b8c48f7ab3c`
- `runtime/src/inventory/current-player-bag-web-routes.ts`: `6ffc101d037117b79f25d6d013284556754ab91b377367cd05cf0f7342c34dd8`
- `runtime/src/inventory/maria-bag-repository.ts`: `38a142151e8c287dc315786486b2992b3eb09dd3f476028996d67d6b7d2d257c`
- `runtime/test/current-player-bag.test.ts`: `f83640358eaadf6c6607ec55cfb68bc670e234b72cb84e9e4a89ead81769a36f`
- `runtime/test/current-player-bag-web-routes.test.ts`: `21707840159a8382f4a086fc76663530f52895a3c668b149b1a16c096c9943e8`
- `runtime/src/site-web/user-shell-assets.ts`: `12287ff775c15d0c217d1c76fc9c01ffd811b92773a502df005daf246a599348`
- `runtime/src/site-web/user-shell.ts`: `ac5175c51ff0da97bf870eeb5316e4e8b6e39cfd36e3a696702510bfa6e00cbe`
- `runtime/test/user-shell.test.ts`: `f958b25b7a0d4bef96e1a50f93faffdc9bbf7300d8aedd02f0aa689b98a6eeae`
- `runtime/test/site-web-app-wiring.test.ts`: `34da0a943fde9b75401d3e3dd382358fafa5b4620cdd061ec22434c80e2e031b`
- `responsive-shadow.mjs`: `6926b1202396d3baf97ecb7a669ad4fe0363856108a2a9a43816f8d2e664f0cc`
- `responsive-results.json`: `a81c680d7c06ebce0127082410da562e07edbc1fbd102e10c272fd7ef5c4dad7`
- `furniture-375.png`: `b32066faf9edce3330ca59c136e25b2029cf93d9f85be1e8995adb4a3356c221`
- `furniture-768.png`: `dc251c33a8fa8b4bdc4e4b53947fc93cb04ad9dfa20fdcc9e380c92b512e6d5e`
- `furniture-1024.png`: `6a739f2dea9d2125f047a55350286d0164b8e82b9065ac1c646396c1f88359ef`
- `furniture-1440.png`: `b88324be2672436959deb9891fc8f29695d2170cabaf3dfd4eddcfa96c3fdeba`

제출된 UI `summary.json`의 source hash 4개는 직접 계산값과 4/4 일치했다.

## Findings

- P0: 없음
- P1: 없음
- P2: 1건

### P2 — browser Shadow는 실제 service와 UI를 잇지만 Fastify·MariaDB까지 한 실행으로 관통하지 않는다

제출된 `responsive-shadow.mjs`는 동일 furniture fixture를 실제 `CurrentPlayerBagService`에 넣고 그 결과를 HTTP로 shell에 전달하므로 same-input consumer Shadow로 유효하다. 다만 HTTP server는 `registerCurrentPlayerBagWebRoutes`와 실제 MariaDB를 거치지 않는다. 별도의 Fastify route integration test가 auth, repository SQL, category, pagination을 검증하고 wiring test가 실제 app 연결을 확인하므로 현재 판정의 P0/P1 결함은 아니다. 다음 staging 또는 Gate 8 smoke에서는 실제 disposable MariaDB→Fastify route→browser를 한 실행으로 잇는 replay를 추가하면 분리된 증거 경계를 없앨 수 있다.

## Gate 7 결론

P0와 P1 결함은 없다. provider의 일반 응답 parity, 현재 active player 자기 범위, bag 상태와 정렬, 최소 string DTO, unknown 422, DML 0과 UI의 category discriminant, stale 응답 차단, session clear, top balances, keyboard/focus, 44px target, 네 breakpoint overflow가 독립 source 검토와 재실행에서 일치했다. WEB-WBS-011C와 WEB-WBS-011D는 **Gate 7 GO**다. P2 end-to-end evidence 보강과 Gate 8 운영 준비는 별도 범위다.
