# WEB-WBS-011D 현재 사용자 분류 가방 UI 검증

- 실행 ID: `WEB-WBS-011D-current-player-bag-category-ui-20260910`
- Lease / slice: `Lease2652` / `SL-ITEM-USER-WEB-BAG-CATEGORY-UI-01`
- catalog delta / evidence schema: `SCD-WEB-20260910-13` / `web-current-player-bag-category-ui-v1`
- execution profile / tier: `READ_UI` / `T1`
- 기준 HEAD: `512db10f`

## 구현 계약

`/account/inventory`는 `일반 가방`과 `가구가방` 탭을 제공하고 각각 `category=general`, `category=furniture`를 명시적으로 요청한다. 일반 행은 기존 이름·수량 계약을 유지하며 가구 행은 provider가 공개한 이름·등급·매력도·수량 1만 `textContent`로 표시한다. 선택 탭과 typed 응답이 일치하지 않으면 오류로 표시하고 이름 기반 분류나 내부 ID 노출은 하지 않는다.

탭 전환은 offset을 0으로 초기화하고, loading/empty/error/pagination과 live 안내에 현재 분류 이름을 반영한다. `401`은 기존 `showLogin`과 민감 DOM 정리 흐름으로 두 가방, 페이지 정보와 상단 잔액을 모두 지운다. 포인트·다이아는 기존 profile 문자열을 그대로 유지한다.

## 검증 결과

2026-09-10에 다음을 통과했다.

1. `node --import tsx --test test/user-shell.test.ts test/site-web-app-wiring.test.ts` — 19/19 통과, 실패·skip 0.
2. `npm.cmd run typecheck` — 통과.
3. `npm.cmd run build` — 통과.
4. `git diff --check` — 통과.
5. `node --import tsx 개발환경_고도화/migration-control/evidence/web-current-player-bag-category-ui-20260910/responsive-shadow.mjs` — 실제 `CurrentPlayerBagService`에 동일 furniture fixture를 입력하고 Chrome에서 UI까지 소비했다.

Chrome CDP 실측은 375×812, 768×900, 1024×900, 1440×900 모두 `scrollWidth === innerWidth`, horizontal overflow 0이었다. 네 폭 모두 탭 높이 44px, 선택 상태, 제목 focus, 일반 회귀 항목, 가구 이름·등급·uint64 매력도·수량 1, 포인트·다이아 문자열 보존, 내부 ID 미노출을 확인했다. 원시 값은 `responsive-results.json`, 화면은 `furniture-<width>.png`에 기록했다.

## Gate 1~6

- Gate 1: 기존 일반 가방 화면·회귀 테스트와 provider delta `SCD-WEB-20260910-12`의 WEB-WBS-011C category 계약을 읽기 전용으로 재확인했다. 이 UI evidence의 delta는 `SCD-WEB-20260910-13`이다.
- Gate 2: 세션 현재 player 범위, category enum, 공개 필드, discriminant, pagination과 401 clear 계약을 확정했다.
- Gate 3: 일반 회귀, 가구 정상·빈·페이지·mismatch·세션 만료 합성 fixture를 추가했다.
- Gate 4: 탭, 분류별 렌더링, keyboard/focus, 44px target과 stale request 차단을 구현했다.
- Gate 5: 실제 category provider 서비스와 같은 furniture fixture 입력을 UI browser Shadow에 연결했다.
- Gate 6: focused 19 tests, typecheck, build, diff-check와 375/768/1024/1440 overflow 0을 확인했다.

Gate 7은 독립 검토가 필요해 `FALSE`이며 Gate 8은 범위 밖으로 `FALSE`다.

## Source hashes

- `runtime/src/site-web/user-shell-assets.ts`: `12287ff775c15d0c217d1c76fc9c01ffd811b92773a502df005daf246a599348`
- `runtime/src/site-web/user-shell.ts` (unchanged route input): `ac5175c51ff0da97bf870eeb5316e4e8b6e39cfd36e3a696702510bfa6e00cbe`
- `runtime/test/user-shell.test.ts`: `f958b25b7a0d4bef96e1a50f93faffdc9bbf7300d8aedd02f0aa689b98a6eeae`
- `responsive-results.json`: `a81c680d7c06ebce0127082410da562e07edbc1fbd102e10c272fd7ef5c4dad7`
