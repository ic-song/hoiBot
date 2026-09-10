# WEB-WBS-013A backend + 관리자 UI Gate 7 독립 검토

- 판정: **NO-GO**
- 검토 대상: `WEB-WBS-013A` / `SL-ACCOUNT-ADMIN-WEB-LINK-READ-01` / `Lease2655`
- 독립성: 책임 소유자 `/root/web_wbs013a_api`, UI 구현자 `/root/web_wbs013a_ui`, 기존 backend/UI evidence 작성자가 아닌 검토자가 수행했다.
- backend 구현 commit: `50b5f1764a8595766b58e661612ce54365d379c3`
- UI 구현 commit: `f8bf316b009bc2d7f78318dbbc96a0726bac077d`
- 지정 검토 HEAD: `584b24cee6ac58b5faf26e9cd867b60351535a4f`
- commit 직전 원격 HEAD: `0b5ac42a61d97dd2f40068ed258c97800a840a99` (지정 HEAD 이후 별도 가구 가방 Gate 7 리뷰 파일 1건만 추가됐고, 이 검토의 구현·테스트·evidence hash는 변하지 않았다.)
- 기준: `SC-20260902-1` / `SCD-WEB-20260910-11` / `READ_UI` / `T1`
- Gate 8: `FALSE`. 운영 DB/data, migration, `feature/prod`는 접근하거나 변경하지 않았다.

## Findings

### P0

없음.

### P1

1. **backend 응답이 UI에 필요하지 않은 내부 식별자를 노출한다.** `AdminAccountLinkReadModel`과 매핑은 `portalAccountId`, `portalGameAccountLinkId`, `selectionVersion`을 포함하고 route는 이를 그대로 `accountLinks` 응답에 넣는다. 관리자 UI가 세 필드를 DOM에 렌더링하지 않는 점은 확인했지만, 응답 수준의 `masked identifiers only`와 `raw/internal IDs leak0` 조건은 충족하지 않는다. UI 소비 계약에 필요한 마스킹 값과 상태 필드만 반환하도록 DTO를 줄이고, route 응답에서 세 내부 값을 찾을 수 없다는 회귀 검증이 필요하다.

2. **제출된 same-input parity 근거가 실제 backend service→browser 연계를 증명하지 않는다.** backend focused test는 `sensitive-login-id`와 `sensitive-external-user-key`를 service에 넣어 `s********d` 계열을 검증한다. UI fixture는 별도 수동 DTO인 `s******r`, `k********y`를 사용하고, 합성 preview route가 `AdminAccountLinkReadService`를 거치지 않고 그 DTO를 바로 반환한다. 따라서 UI `summary.json`의 Gate 3 `one masked account-link fixture shared by API replay and UI Shadow`와 Gate 6 `same-input fixture parity` 문구는 실행 경로와 일치하지 않는다. 또한 committed 401/403/404/500 검증은 API `inject` 응답 상태만 확인하고 실제 client 오류 화면을 구동하지 않는다. 이번 독립 검토에서 브라우저 응답 주입으로 화면 동작 자체는 재현했지만, 제출 evidence의 service→route→browser 동일 입력 연결 부재는 남는다.

### P2

없음.

## 독립 검증

### backend·RBAC·조회 계약

- `GET /api/v1/admin/players/:playerId/account-links`는 기존 관리자 session 인증 뒤 `player.read`를 요구하며 권한 실패 시 reader를 호출하지 않는다.
- decimal `uint64`는 `BigInt`로 lossless 처리하고 소수·초과값은 422, 없는 player는 404, 연결 없는 기존 player는 200 empty array다.
- service는 player 존재 확인과 연결 조회의 `SELECT` 두 건만 실행한다. source와 focused test에서 DML 0을 확인했다.
- 로그인 ID와 외부 사용자 키 원문은 마스킹된다. 다만 P1-1의 세 내부 필드는 API JSON에 남아 있다.

### 관리자 UI·상태·접근성

- `/admin/players/:playerId/account-links` 직접 진입과 새로고침이 같은 player를 복원한다. `pushState`, `popstate` 뒤에도 선택 상세를 다시 렌더링한다.
- success panel은 `maskedLoginId`, `maskedExternalUserKey`, 플랫폼·문맥·역할·상태만 렌더링한다. portal/link ID, selection version과 원문 식별자는 DOM에서 0건이었다.
- success panel의 mutation form/button은 0건이다. 실패 시 동일 GET 재시도 버튼 한 개만 제공한다.
- 독립 브라우저 응답 주입 결과: empty는 별도 빈 상태, 403은 권한 안내와 retry, 404는 회원 없음과 retry, 500은 일반 실패와 retry, 401은 민감 화면을 비우고 만료 안내가 있는 로그인 화면과 `login-id` 포커스로 전환됐다.
- 선택 행은 native button이며 44px 높이와 `:focus-visible` outline을 가진다. 상세 로드 후 `account-link-title`로 포커스가 이동한다.
- 375×812, 768×1024, 1024×900, 1440×1000 fresh browser replay 모두 path 유지, panel/card 1건, `account-link-title` 포커스, row target 44px, `overflowX=0`, DOM 내부 ID 0, mutation control 0이었다.
- UI/UX 검토 기준은 keyboard focus visible, focus on route change, 44px target, long-token wrapping, no horizontal scroll이다. 현행 account-link UI는 이 항목을 충족했다.

### 재실행 결과

```text
node --import tsx --test test/admin-account-link-read.test.ts test/admin-web-shell.test.ts
tests 18, pass 18, fail 0, skipped 0

npm run typecheck
PASS

npm run build
PASS

git diff --check 50b5f176^..f8bf316b
PASS

git diff --check 50b5f176^..584b24cee6ac58b5faf26e9cd867b60351535a4f
PASS
```

`50b5f176`과 `f8bf316b`은 모두 지정 검토 HEAD의 조상이다. 검토 시작 시 `HEAD`, local `feature/web-portal`, `origin/feature/web-portal`은 모두 `584b24ce`였고, commit 직전 원격을 재확인했을 때 별도 리뷰 commit `0b5ac42a`가 추가되어 있었다. 해당 commit은 이 검토의 대상 구현·테스트·evidence를 변경하지 않았으며 그 리뷰 파일에도 손대지 않았다.

## 직접 계산한 SHA-256

### 구현·테스트

- `runtime/src/admin/admin-account-link-read-routes.ts`: `65d6c6e4cb0cef79963299a4fe7790af5c2e299453f6bb0810b76602cf83d04e`
- `runtime/src/admin/admin-account-link-read-service.ts`: `462f1682fc17d6f799f0b07bfc96f4325502890391aaa810076d983d645ce126`
- `runtime/src/app.ts`: `601618a26adf0749374ca50b2c4fe883701a9ad2685608ad5c3bedb866c22454`
- `runtime/src/admin/web-shell-assets.ts`: `8b19b309f93b8c43858c9da6bebb38fe12446d9871f87ed876ca2e200d2499cf`
- `runtime/src/admin/web-shell.ts`: `31aaa5eeea60b8e60018ab0b41f6dd1d70e2bac4a149e304dc2dfe7e58cff55f`
- `runtime/test/admin-account-link-read.test.ts`: `f27f3eb62e060b35f4ed5c97ab2de55a26132e0d412f5ba22cd62356bfd42dae`
- `runtime/test/admin-web-shell.test.ts`: `4a771743280339bb61371ecf4ac4a093ba91e631ec55e1d7703f1e35dfd1062e`
- `runtime/test/fixtures/admin-web-shell.ts`: `eae4ff7523ce54049d3025393b910e6756a4e99c8e0915afa260f00ae249a195`
- `runtime/test/support/admin-web-shell-preview.ts`: `68d6c7fa257c0f0de85257eb0c2b3eb198cb9be52dd2a856de8effdf87499317`

### 제출 evidence

- backend `summary.json`: `4923974d50db1733b65e40c68f3827b985f4325da16e0444e57f289786ce1b67`
- backend `validation.md`: `254c1148977d068584ac4380075eec87df788c6be0d94561dbfa279d11743ec2`
- UI `summary.json`: `5692a9f3ed8388439972aa174cd771c2f1c5077fb8cc175f2a898ae6b81b4c9b`
- UI `validation.md`: `d24dc4c706d9baf8df9f401b58e709de6ae5b209e5f04a6acfee8904d5b894fd`
- UI `responsive-audit.mjs`: `357ebfc4589f11eb947e7b7e4cea402db655e0fae88e5b6053be98378970b24b`
- UI `responsive-results.json`: `88f4d45572cc3e1ad28092ff1b6ffa2368b107b7357398c41b1a57c2e8edfe7e`

제출된 네 screenshot SHA-256은 `summary.json` 선언값과 모두 일치했다.

- 375: `580ff6733ced21904820e0bb6ce4cc4ff6bb481a3877756569a2e28320bd0889`
- 768: `39c075cb66be22714d6f91729e391f7071832bfcff6084fa67427e8e3ddb17ba`
- 1024: `3bb2aef9cc6e57c41ca322854d11abe668cdb37ba5093df145e818bd4094a9e1`
- 1440: `d7e9799612acceac892670b39cf5283587bde69bbb3b71edf84d70ef1ce208e4`

## Gate 7 결론

RBAC, uint64/404/empty, DML 0, deep-link/popstate/refresh, 상태별 UI 동작, keyboard/focus/44px와 네 viewport overflow는 독립 검증에서 통과했다. 그러나 API 응답의 내부 식별자 노출과 실제 backend service를 거치지 않는 same-input evidence는 Gate 7의 보안·parity 조건을 만족하지 못한다. P1 두 건이 해소되고 동일 입력의 service→route→browser 회귀 근거가 재작성되기 전까지 **Gate 7 NO-GO**다.
