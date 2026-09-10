# WEB-WBS-013A correction Gate 7 독립 재검토

- 판정: **GO**
- 검토 대상: `WEB-WBS-013A` / `SL-ACCOUNT-ADMIN-WEB-LINK-READ-01` / correction `Lease2657` / review `Lease2659`
- 독립성: 책임 owner `/root/web_wbs013a_api`, 구현자 `/root/web_wbs013a_correction`, backend/UI/correction evidence 작성자와 이전 reviewer가 아닌 새 검토자가 수행했다.
- 지정 검토 baseline과 account-link source/evidence HEAD: `d4dc4050edd5d127a6dcdbf0150fbf20aea83391`
- commit 직전 원격 HEAD: `7eaafef5044e2036a107f80bed1632e4e924293f` (별도 typed 가방 분류 준비도 문서 3건만 추가됐고, 이 검토의 구현·테스트·evidence hash는 변하지 않았다.)
- 이전 NO-GO: `e0d3c871edacf8e75c976add53d76535ea507984`
- 기준: `SC-20260902-1` / `SCD-WEB-20260910-11` / `web-admin-account-link-correction-v1` / `READ_UI` / `T1`
- Gate 8: `FALSE`. `feature/prod`, 운영 DB/data, migration은 접근하거나 변경하지 않았다.

## Findings

### P0

없음.

### P1

없음. 이전 NO-GO의 P1 두 건은 correction과 독립 재실행으로 해소됐다.

### P2

없음.

## 이전 P1 재검증

### 1. 내부 식별자 노출

- `AdminAccountLinkReadModel`과 service 반환 매핑은 `portalAccountId`, `portalGameAccountLinkId`, `selectionVersion`을 포함하지 않는다.
- 실제 route 200 payload의 account-link exact key는 다음 9개뿐이다.

```text
contextType,linkStatus,maskedExternalUserKey,maskedLoginId,platformCode,playerId,playerRole,portalAccountStatus,selectionStatus
```

- 세 금지 key의 exact 존재 수는 0이다.
- account-link SQL의 SELECT projection은 역할·상태·마스킹 전 원본 로그인/외부 키에 필요한 열만 읽으며, `portal.portal_account_id`, `link.portal_game_account_link_id`, `selection.selection_version`을 projection하지 않는다. 세 열 이름은 관계 연결과 정렬을 위해 JOIN/ORDER BY에만 남아 있다.
- route payload에서 raw login ID, raw external user key, synthetic portal/link identifier와 경계 player ID 문자열의 누출은 0건이다.
- focused test도 전체 응답 객체와 세 금지 exact key 부재를 함께 검증한다.

### 2. 실제 service → route → shell → Chrome 동일 입력

- 독립 재실행한 `correction-shadow.mjs`는 실제 `AdminAccountLinkReadService`, 실제 `registerAdminAccountLinkReadRoutes`, 실제 `registerAdminWebShellRoutes`를 한 Fastify 앱에 등록한다.
- raw `operator-login-secret`, `kakao-external-secret`이 DB adapter의 단일 account-link row로 들어가 service에서 마스킹되고, 같은 route payload를 실제 admin shell client가 Chrome에서 소비한다.
- 별도 수동 account-link DTO 또는 preview account-link route로 우회하지 않는다.
- 재실행 결과: `pass=true`, browser scenarios `9/9`, actual route responses `9`, SQL queries `13`.
- 독립 임시 실행의 `raw-results.json` SHA-256은 제출 evidence와 정확히 일치했다.

## 보안·조회 계약

- route는 `GET /api/v1/admin/players/:playerId/account-links` 하나이며 session cookie 인증 후 `player.read`를 요구한다.
- 권한이 없으면 403이고 reader 호출은 0회다. 세션이 없거나 만료되면 401이다.
- read 요청은 CSRF token 없이 session token 하나만 authenticator에 전달한다. 독립 route probe는 `authenticateArgs=["session-only"]`, status 200을 재현했다. mutation에만 CSRF가 필요한 기존 의미와 일치한다.
- player ID는 decimal uint64로 lossless 처리하며 소수·범위 초과는 422, 없는 player는 404, 연결이 없는 기존 player는 200 empty array다.
- 독립 Chrome 실행에서 모든 DB adapter query가 `SELECT`로 시작했다. query 13건, DML 0건이다.
- 실제 account-link HTTP 요청은 모두 GET이며 mutation HTTP request 0건이다.

## UI·접근성·상태 검증

- success 375×812, 768×1024, 1024×900, 1440×1000 모두 카드 1건, `account-link-title` focus, row target 44px, `overflowX=0`, mutation control 0, raw/internal identifier 0이었다.
- empty는 카드 0, 별도 빈 상태, `account-link-title` focus, row target 44px, overflow 0이었다.
- 401은 민감 상세를 지우고 로그인 화면으로 전환하며 `login-id`로 focus를 옮겼다.
- 403/404/500은 각각 권한 없음/회원 없음/일반 서버 오류 문구와 동일 GET 재시도 버튼 1개를 표시했다. mutation CTA는 없다.
- native row button에는 44px 최소 높이와 visible `:focus-visible` outline이 있고, 긴 식별자는 `overflow-wrap:anywhere`, 640px 이하 계정 필드는 1열로 전환된다.
- 독립적으로 success 375/1440, 401, 500 캡처를 열어 상태·레이아웃을 시각 확인했다.
- 적용한 UI 검토 기준은 visible keyboard focus, route 이동 후 focus, 최소 조작 영역, 작은 화면 수평 overflow 0, 긴 token wrapping이다.

## 독립 실행 결과

```text
node --import tsx --test test/admin-account-link-read.test.ts test/admin-web-shell.test.ts
tests 18, pass 18, fail 0, skipped 0

node --import ./node_modules/tsx/dist/loader.mjs <repo 밖 임시 경로>/correction-shadow.mjs
{"pass":true,"scenarios":9,"routeResponses":9,"queries":13}

npm run typecheck
PASS

npm run build
PASS

git diff --check d4dc4050^..d4dc4050
PASS

git diff --check 50b5f176^..d4dc4050
PASS

git merge-base --is-ancestor f8bf316b d4dc4050
PASS

git merge-base --is-ancestor e0d3c871 d4dc4050
PASS
```

Chrome harness는 repository 밖 임시 evidence 경로에서 실행해 기존 evidence와 checkpoint를 수정하지 않았다. 캡처에는 현재 업데이트 시각이 표시되므로 독립 재실행 PNG의 byte hash는 제출 캡처와 다를 수 있다. 동작 수치와 route/query 원문을 담는 `raw-results.json`은 byte-for-byte 동일했다.

## 직접 계산한 SHA-256

### 구현·테스트

- `runtime/src/admin/admin-account-link-read-service.ts`: `671f86081b6675f7f691e51b2f1301adc0ecc4f9068c74262e3c2edc2a48c69a`
- `runtime/src/admin/admin-account-link-read-routes.ts`: `65d6c6e4cb0cef79963299a4fe7790af5c2e299453f6bb0810b76602cf83d04e`
- `runtime/src/admin/web-shell.ts`: `31aaa5eeea60b8e60018ab0b41f6dd1d70e2bac4a149e304dc2dfe7e58cff55f`
- `runtime/src/admin/web-shell-assets.ts`: `8b19b309f93b8c43858c9da6bebb38fe12446d9871f87ed876ca2e200d2499cf`
- `runtime/src/app.ts`: `601618a26adf0749374ca50b2c4fe883701a9ad2685608ad5c3bedb866c22454`
- `runtime/test/admin-account-link-read.test.ts`: `18481ef499befe0dffcb516b9e5370c81b34d0508abb74b5bc448f35c7e10651`
- `runtime/test/admin-web-shell.test.ts`: `4a771743280339bb61371ecf4ac4a093ba91e631ec55e1d7703f1e35dfd1062e`
- `runtime/test/fixtures/admin-web-shell.ts`: `eae4ff7523ce54049d3025393b910e6756a4e99c8e0915afa260f00ae249a195`

### correction evidence

- `correction-shadow.mjs`: `0517706283f5ea9db8c20906d6c4e4e516b32a50138df7e197890c529eccb79a`
- `summary.json`: `166c15d8a9992d73a1e30d3cf2164adf25ecaebd08c1cbcb11ebcf5ae38c7574`
- `validation.md`: `49d7a2567c541f7b59ba9b33f15a3cc791d1dcb8b2868bfb125a3208a0599049`
- `raw-results.json`: `b1094a3c3b9b99507a175024e5360a6f83fdbfa1a109716e8dc4a0755d5bc8fb`

### 독립 Chrome 재실행 산출물

- `raw-results.json`: `b1094a3c3b9b99507a175024e5360a6f83fdbfa1a109716e8dc4a0755d5bc8fb`
- `success-375.png`: `e15ef15e300f96bf3062c8326e475e8c7a4dd321661beeb53a570b55d41efd03`
- `success-768.png`: `f9a167f75d41751bfa8ef500a9a4903edc721fd396eee29bc91622f37e75ccda`
- `success-1024.png`: `45d18f5c0e6247adb2ee13fc3199160e6ec63a82947ad33379f21257bf4735be`
- `success-1440.png`: `d680c5033f50b849bf2fb37f56b21ffe0a13f23da333e2543e1fc52e1c4f6658`
- `empty.png`: `14bfa529fbe89626ea0de0632c1307eb5dd244344c9cfd12067d120f0556e790`
- `unauthorized-401.png`: `a13924beb1c9d5c51f62e7ef2aafcd15e538dbdc094f8d90e59f45210350c520`
- `forbidden-403.png`: `dc1f954bddb79a1532eb98dc1a292a832abcaf962b753d0fd8cf7fe68d63f232`
- `not-found-404.png`: `5adc59bab4ea2da90412d2f74a0d9d3b9cead357376db7e68b964f0cec890e48`
- `server-error-500.png`: `82230bd1c20564bc142fca4afe15e81d8e14a1482072a318ef93d0fcb1218498`

## Gate 7 결론

이전 NO-GO의 내부 식별자 응답 노출과 우회된 same-input evidence 문제가 모두 해소됐다. actual service→actual route→actual shell→Chrome 경로에서 RBAC, read-only/CSRF 의미, exact key와 raw leak 0, success·empty·401·403·404·500, 네 viewport, focus·44px·overflow 0, mutation CTA/HTTP/DML 0을 독립 재현했다. **Gate 7 GO**로 판정한다. Gate 8은 별도 운영 준비 wave로 남긴다.
