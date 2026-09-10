# WEB-WBS-013A 관리자 계정 연결 조회 correction 검증

- Lease: `Lease2657`; 책임 소유자: `/root/web_wbs013a_api`; correction 구현자: `/root/web_wbs013a_correction`.
- 실행 profile/tier: `READ_UI` / `T1`.
- 배정 기준선: `e0d3c871edacf8e75c976add53d76535ea507984`.
- 경로: `GET /api/v1/admin/players/:playerId/account-links` → `/admin/players/:playerId/account-links`.
- 기존 `web-admin-account-link-read-20260910`, `web-admin-account-link-ui-20260910`, Lease2656 Gate 7 audit는 수정하거나 재라벨링하지 않았다.

## Gate 1~6 correction evidence

1. 실제 관리자 셸은 `playerId`, `playerRole`, `linkStatus`, `portalAccountStatus`, `maskedLoginId`, `platformCode`, `contextType`, `selectionStatus`, `maskedExternalUserKey`만 소비함을 재확인했다.
2. `AdminAccountLinkReadModel`, SQL SELECT projection, DTO mapping에서 UI 비소비 내부 필드 `portalAccountId`, `portalGameAccountLinkId`, `selectionVersion`을 제거했다.
3. 합성 원문 `operator-login-secret`, `kakao-external-secret`을 scripted read-only DB가 실제 `AdminAccountLinkReadService`에 제공한다.
4. 실제 `registerAdminAccountLinkReadRoutes`가 서비스 결과를 JSON으로 직렬화하고, 실제 `registerAdminWebShellRoutes`의 HTML/CSS/JS를 Chrome이 소비한다.
5. 같은 service→route→browser 경로로 success, empty, 401, 403, 404, 500을 재현했다. 실제 API raw response와 실행 SQL은 `raw-results.json`에 기록했다.
6. 375×812, 768×1024, 1024×900, 1440×1000에서 success 화면의 `overflowX=0`, `account-link-title` focus, 회원 행 44px, account-link mutation control 0을 확인했다. 401은 `login-id`로 focus가 이동하고, 403/404/500에는 같은 GET 재시도만 제공된다.

## 검증 결과

- Focused backend + admin shell: `node --import tsx --test test/admin-account-link-read.test.ts test/admin-web-shell.test.ts` — 18 passed, 0 failed, 0 skipped.
- Actual-path Chrome: `node --import tsx ../migration-control/evidence/web-admin-account-link-correction-20260910/correction-shadow.mjs` — 9/9 scenarios PASS.
- Typecheck: `npm run typecheck` — PASS.
- Build: `npm run build` — PASS.
- `git diff --check` — PASS.
- SQL: 13/13 statements are SELECT; forbidden projection count 0; DML 0.
- HTTP: account-link route mutation request count 0.
- JSON/DOM: raw login ID, raw external user key, synthetic portal/link identifiers, synthetic selection version leak count 0.
- Exact response regression test checks the nine allowed DTO keys and directly checks all three removed keys are absent.

## Source SHA-256

- `runtime/src/admin/admin-account-link-read-service.ts`: `671f86081b6675f7f691e51b2f1301adc0ecc4f9068c74262e3c2edc2a48c69a`
- `runtime/src/admin/admin-account-link-read-routes.ts`: `65d6c6e4cb0cef79963299a4fe7790af5c2e299453f6bb0810b76602cf83d04e`
- `runtime/src/admin/web-shell.ts`: `31aaa5eeea60b8e60018ab0b41f6dd1d70e2bac4a149e304dc2dfe7e58cff55f`
- `runtime/src/admin/web-shell-assets.ts`: `8b19b309f93b8c43858c9da6bebb38fe12446d9871f87ed876ca2e200d2499cf`
- `runtime/test/admin-account-link-read.test.ts`: `18481ef499befe0dffcb516b9e5370c81b34d0508abb74b5bc448f35c7e10651`
- `correction-shadow.mjs`: `0517706283f5ea9db8c20906d6c4e4e516b32a50138df7e197890c529eccb79a`
- `raw-results.json`: `b1094a3c3b9b99507a175024e5360a6f83fdbfa1a109716e8dc4a0755d5bc8fb`

## 남은 Gate

이 correction은 Gate 1~6 근거만 작성한다. Gate 7은 책임 소유자와 기존·correction 구현/evidence 작성자가 아닌 독립 검수자가 새 구현과 새 evidence를 검토해야 한다. Gate 8 운영 준비는 Lease2657 범위가 아니다.
