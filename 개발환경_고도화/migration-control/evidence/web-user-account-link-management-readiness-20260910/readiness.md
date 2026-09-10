# WEB-WBS-009A 사용자 계정 연결 관리 readiness

- 실행 단위: `WEB-WBS-009A` / `SL-ACCOUNT-USER-WEB-LINK-MANAGEMENT-01`
- Lease: `Lease2662`
- catalog_version: `SC-20260902-1`
- delta_id: `SCD-WEB-20260910-19`
- evidence_schema_version: `web-user-account-link-management-readiness-v1`
- execution_profile: `MUTATION_TRANSACTIONAL`
- validation_tier: `T2`
- 기준 Git: `0e36833bc250e7dd857181f9cb7731d9aa087072`
- 범위: 기존 코드·DB 계약과 UI를 읽어 연결 목록, 연결용 1회용 인증번호, 연결 해제 구현 경계를 확정한다.
- 변경 제한: source/test/DB/migration은 수정하지 않는다. 운영 DB·운영 데이터·`feature/prod`·Gate 8은 그대로 둔다.

## 판정

`PARTIAL EXTENSION`이다. `/account/links` 셸은 존재하지만 현재 세션과 현재 프로필만 표시하며, 실제 플랫폼 연결 목록 API·연결 인증번호 발급 API·연결 해제 mutation은 없다. 현재 1회용 인증 challenge와 account-platform writer는 상당 부분 재사용할 수 있으나, 로그인한 포털계정에 플랫폼 identity만 추가하는 purpose, 안전한 공개 link handle, soft unlink·재연결 계약은 추가해야 한다.

현재 실제 인증 ingress는 KakaoTalk의 정확한 `/인증 [8자리]` 명령만 `app.ts`에서 `ProviderVerificationService`로 전달한다. 따라서 v1의 발급 가능한 플랫폼은 `KAKAO` 하나로 고정한다. `DISCORD`는 DB enum에는 있지만 인증 소비 ingress가 없어 UI에서 선택 가능하게 노출하지 않는다.

## 현재 코드 증거와 재사용 범위

| 영역 | 코드 증거 | 판정 |
|---|---|---|
| 이용자 셸 | `site-web/user-shell.ts:30-31`이 `/account/links`를 셸에 연결하고, `user-shell-assets.ts:150-200`은 마스킹한 로그인 ID·시스템 계정·현재 프로필만 표시한다. 같은 파일 200행은 연결 해제를 준비 중으로 명시한다. | 경로·레이아웃·세션 만료 UX 재사용, 데이터 기능은 신규 |
| 세션/CSRF | `user-auth/user-auth-service.ts:324-370`은 HttpOnly cookie token과 선택적 CSRF를 검증하고 idle을 갱신한다. `user-auth/routes.ts:25-28`은 mutation용 `x-csrf-token`을 강제한다. | 목록은 cookie, 발급·해제는 cookie+CSRF 재사용 |
| 재인증 | 로그인/복구가 Argon2 `verify(password_hash, password)`와 실패 잠금 누적을 사용한다. 연결 해제는 기존 계정 탈퇴보다 좁지만 플랫폼 접근권을 끊으므로 비밀번호 재확인을 요구한다. | 공통 자격 검증 로직을 추출 또는 같은 정책으로 재사용 |
| 1회용 코드 | `account-platform-challenge-service.ts`는 8자리 난수, pepper HMAC, 30분 만료, 5회 실패, 동일 계정·플랫폼·context pending supersede, `FOR UPDATE`, 소비 request key 재생을 제공한다. `policy.ts:6,54-55`는 30분과 정확한 KakaoTalk 명령을 정의한다. | 생성·저장·소비 원자성 재사용 |
| 발급 rate limit | `RequestRateLimiter`는 원문을 HMAC scope로 바꾸고 15분 window를 제공하며 가입/재발급/로그인 라우트가 계정·network 이중 제한을 사용한다. | 로그인 계정 5회/15분, network 20회/15분 적용 |
| account-platform 연결 | `MariaAccountPlatformRepository.linkVerifiedGameAccount`는 전역 account-authority lock, receipt replay, 포털 소유권, identity/membership/selection, operations·command_audit를 한 transaction으로 처리한다. | 전역 lock·receipt·audit 패턴 재사용 |
| DB 상태 모델 | identity는 `ACTIVE/SUSPENDED/REVOKED`, membership은 `ACTIVE/SUSPENDED/LEFT`, selection은 `ACTIVE/SUSPENDED/CLEARED`를 이미 허용한다. | 물리 삭제 없이 상태 전이 가능 |
| 식별자 보호 | 관리자 조회도 로그인·외부 사용자 key를 마스킹하고 내부 portal/link/selection ID를 DTO에서 제외한다. | 사용자 DTO도 내부 CUID, player/account/context key 미노출 |
| 재연결 | `ensureIdentity`와 `ensureMembership`은 기존 행을 반환하지만 `REVOKED/LEFT`를 `ACTIVE`로 복구하지 않는다. identity 자연키는 unique다. | unlink 후 동일 identity 재연결 지원을 위해 provider 보완 필요 |
| receipt schema | `account_platform_operation_receipts.operation_kind` check는 `VERIFY_GAME_ACCOUNT`, `SWITCH_ACTIVE_PLAYER`, `OBSERVE_NICKNAME`만 허용한다. | `LINK_PLATFORM_ACCOUNT`, `UNLINK_PLATFORM_ACCOUNT`와 identity 공개 handle 계약을 migration으로 확장 |

## 확정 정책

### 본인 scope와 최소 공개 정보

- 모든 query/mutation은 cookie 세션의 `accountId`로 `canonical_portal_accounts.legacy_user_account_id`를 찾고, 그 portal에 속한 identity만 읽고 잠근다. 요청 body와 URL의 account/player/portal ID는 신뢰하거나 받지 않는다.
- 목록은 identity 1개당 1행이다. context나 membership 원문을 나열하지 않고 활성 context 개수만 반환한다.
- `platform_identity_id`, `portal_account_id`, `portal_game_account_link_id`, `user_account_id`, `player_id`, `external_user_key`, `identity_scope_key`, `external_context_key`, membership/selection ID·version을 API에 내보내지 않는다.
- 연결 해제 대상 지정에는 migration이 추가하는 무작위 UUID `public_link_id`만 사용한다. 내부 CHAR(8) CUID를 공개 handle로 재사용하지 않는다.
- 목록 DTO는 아래 필드로 제한한다.

```ts
type PlatformLinkDto = {
  platformLinkId: string;        // public UUID
  platformCode: "KAKAO";
  platformLabel: "카카오톡";
  status: "ACTIVE";
  connectedAt: string;           // ISO-8601
  activeContextCount: number;
};
```

외부 사용자 ID와 방 이름을 표시하지 않아도 사용자는 플랫폼 종류와 연결 수를 구분할 수 있다. v1에서 같은 플랫폼 identity가 여러 개면 연결 시각과 활성 context 수로 행을 구분한다.

### 인증번호 발급·소비

- `POST /api/v1/account-platform-link-challenges`는 cookie 세션, 현재 CSRF, 현재 비밀번호 재인증을 모두 요구한다.
- body는 `{ platformCode: "KAKAO", password: string }`만 허용한다. 세션의 계정/대표 player를 서버가 결정한다.
- 로그인 계정당 5회/15분, network당 20회/15분으로 제한한다. 제한 시 기존 `AUTH_RATE_LIMITED` 429와 `retryAfterSeconds`를 사용한다.
- response는 `201 { ok, challenge: { challengeId, platformCode, verificationCode, verificationCommand, expiresAt }, requestId }`다. account/player/internal IDs는 없다.
- challenge purpose에 `PLATFORM_ACCOUNT_LINK`를 추가한다. 코드는 8자리, DB에는 HMAC과 4자리 hint만 저장하며 30분 뒤 만료되고 5회 실패 시 폐기한다. 같은 웹 계정·플랫폼의 기존 pending `PLATFORM_ACCOUNT_LINK`는 새 발급 transaction에서 `superseded` 처리한다.
- KakaoTalk에서 `/인증 CODE`를 입력하면 현재 stable external user와 실제 ROOM context에 identity/membership을 묶고 현재 portal의 대표 player를 active selection으로 설정한다. 로그인 상태에서 비밀번호까지 재확인해 발급했으므로 신규 가입용 닉네임 동일성 검사는 적용하지 않고 관측 닉네임만 이력으로 남긴다.
- 같은 request key 재전달만 성공 결과를 replay한다. 다른 request key로 이미 소비한 코드는 `VERIFICATION_CODE_CONSUMED` 409다.
- UI는 만료 시각과 복사 가능한 전체 `/인증 CODE` 명령을 표시하고 복사를 차단하지 않는다. 새 발급 때 이전 코드는 즉시 무효라고 알린다.

### 연결 해제

- `DELETE /api/v1/account-platform-links/:platformLinkId`는 cookie 세션, CSRF, `Idempotency-Key`, body `{ password, confirmed: true }`를 요구한다.
- password는 현재 account의 Argon2 hash로 다시 확인한다. 실패 횟수·잠금 정책은 로그인과 동일하게 적용한다. `confirmed !== true`는 422다.
- 전역 `ACCOUNT_AUTHORITY` lock과 대상 identity/하위 membership/selection을 `FOR UPDATE`로 잠근 한 transaction에서 처리한다.
- 상태 전이는 `selection ACTIVE/SUSPENDED → CLEARED`, `membership ACTIVE/SUSPENDED → LEFT`, `identity ACTIVE/SUSPENDED → REVOKED` 순이다. 해당 계정·플랫폼의 pending `PLATFORM_ACCOUNT_LINK` challenge도 `superseded`한다.
- `portal_game_account_links`, `canonical_portal_accounts`, `user_accounts`, `players`, 현재 `user_sessions`는 바꾸지 않는다. 마지막 플랫폼 연결도 해제할 수 있으며 웹 로그인과 게임계정 소유권은 유지된다. 그 플랫폼의 bot 명령 접근은 active identity/membership/selection join에서 즉시 제외된다.
- 결과는 `200 { ok, platformLink: { platformLinkId, platformCode, status: "REVOKED", replayed }, requestId }`로 제한한다. 이미 revoke된 공개 handle에 새 idempotency key가 오면 동일한 200 no-op 결과를 audit하며, 같은 key replay는 두 번째 DML/audit 없이 저장 결과를 반환한다.
- 성공/실패 중간 단계가 생기지 않도록 receipt, operations, command_audit와 상태 전이를 같은 transaction에 둔다. audit/receipt 실패는 전체 rollback한다.
- 동일 identity를 나중에 다시 인증하면 natural-key 기존 행의 소유 portal이 같을 때 identity `ACTIVE`, membership `ACTIVE`, selection `ACTIVE`로 복구한다. 다른 portal 소유면 기존 409를 유지한다.

## 정확한 API 계약

1. `GET /api/v1/account-platform-links`
   - cookie 인증만 요구하며 위 `PlatformLinkDto[]`를 `platformLinks`에 반환한다.
   - 활성 identity만 반환하고 결과가 없으면 `200 []`다.
2. `POST /api/v1/account-platform-link-challenges`
   - cookie+CSRF+password, 발급 rate limit, KAKAO allowlist.
   - 201 challenge DTO만 반환한다.
3. `DELETE /api/v1/account-platform-links/:platformLinkId`
   - cookie+CSRF+password+confirmed+Idempotency-Key.
   - soft revoke와 receipt/audit를 한 transaction으로 처리한다.
4. 기존 KakaoTalk `/인증 [8자리]` ingress
   - `PLATFORM_ACCOUNT_LINK` purpose를 분기해 현재 portal의 기존 대표 player에 platform identity를 추가한다.

## 구현 Lease에 필요한 정확한 자원

### R

- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/user-auth/policy.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/user-auth/request-rate-limiter.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/admin/admin-account-link-read-service.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/site-web/user-shell.ts`
- `repo:hoiBot|DB:canonical_portal_accounts`
- `repo:hoiBot|DB:portal_game_account_links`
- `repo:hoiBot|DB:user_accounts`
- `repo:hoiBot|DB:user_sessions`
- `repo:hoiBot|DB:players`
- `repo:hoiBot|DB:player_profiles`
- `repo:hoiBot|LEDGER:WEB-WBS-009/WEB-WBS-008R`

### W

- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/user-auth/account-link-management-service.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/user-auth/user-auth-service.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/user-auth/routes.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/account-platform/account-platform-challenge-service.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/account-platform/account-platform-service.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/account-platform/maria-account-platform-repository.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/site-web/user-shell-assets.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/src/app.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/test/user-account-link-management.test.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/test/user-account-link-management-mariadb.integration.test.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/test/user-account-link-management-ui.test.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/test/account-platform-challenge.test.ts`
- `repo:hoiBot|FILE:개발환경_고도화/runtime/test/user-shell.test.ts`
- `repo:hoiBot|MIGRATION:개발환경_고도화/runtime/migrations/475_user_account_platform_link_management.sql`
- `repo:hoiBot|MIGRATION:개발환경_고도화/runtime/migrations/rollback/475_user_account_platform_link_management.rollback.sql`
- `repo:hoiBot|DB:user_verification_challenges`
- `repo:hoiBot|DB:account_platform_identities`
- `repo:hoiBot|DB:account_platform_context_memberships`
- `repo:hoiBot|DB:account_platform_active_player_selections`
- `repo:hoiBot|DB:account_platform_operation_receipts`
- `repo:hoiBot|DB:operations`
- `repo:hoiBot|DB:command_audit`
- `repo:hoiBot|DB:outbox_messages`
- `repo:hoiBot|PROVIDER:user-account-platform-link-management`
- `repo:hoiBot|PROVIDER:account-platform-challenge`
- `repo:hoiBot|ROUTE:GET:/api/v1/account-platform-links`
- `repo:hoiBot|ROUTE:POST:/api/v1/account-platform-link-challenges`
- `repo:hoiBot|ROUTE:DELETE:/api/v1/account-platform-links/:platformLinkId`
- `repo:hoiBot|RECEIPT:account-platform-link-management-v1`
- `repo:hoiBot|EVIDENCE:web-user-account-link-management-v1`
- `repo:hoiBot|WBS:WEB-WBS-009A`

`475`는 감사 시점에 Lease2661이 `474_admin_user_session_revoke_rbac.sql`을 쓰는 것을 확인해 산정했다. 실제 구현 Lease 발급 직전 migration 목록과 충돌을 다시 읽고 번호를 확정해야 한다.

## 구현 순서

1. migration에서 `public_link_id`, challenge purpose/receipt operation kind 계약과 rollback을 추가하고 schema test를 작성한다.
2. account-platform provider에 `PLATFORM_ACCOUNT_LINK` verify 및 같은 portal의 revoked identity/membership 재활성화를 추가한다.
3. user account-link management service에 본인 목록·발급·soft unlink transaction을 구현한다.
4. user route에 cookie/CSRF/password/confirmed/idempotency/rate-limit boundary를 추가한다.
5. `/account/links`를 플랫폼 목록, 발급 카드, 행별 연결 해제로 구성한다.
6. focused unit → MariaDB transaction/race/replay/rollback → 실제 service→route→shell Shadow를 수행한다.
7. 책임 소유자/구현자/evidence 작성자가 아닌 독립 검토자가 Gate 7을 확인한다. Gate 8은 사용자 승인 전 FALSE다.

## Acceptance

- 다른 계정의 `platformLinkId`는 존재 여부를 구분하지 않는 404로 끝나고 어떤 DML도 하지 않는다.
- API/body/HTML/스크립트/로그에 내부 ID·외부 사용자 key·context key·code hash·비밀번호·cookie/CSRF가 노출되지 않는다.
- KAKAO 발급은 8자리·30분·5회 실패·계정/network rate limit·이전 pending supersede를 지킨다.
- 발급 API와 unlink API는 cookie+CSRF+비밀번호 재인증을 모두 검증하고, unlink는 confirmed와 idempotency key도 검증한다.
- 같은 idempotency key는 한 번의 상태 변경·receipt·audit만 만든다. 서로 다른 key의 동시 해제는 전역 lock으로 직렬화되고 결과는 1 changed + 1 no-op이다.
- receipt/audit/상태 update 중 하나가 실패하면 identity/membership/selection/challenge가 모두 원상태다.
- 마지막 플랫폼 연결 해제 후에도 웹 세션, 포털계정, 게임계정 link, player status는 유지되며 해당 플랫폼의 active-player resolver만 더 이상 접근하지 못한다.
- 동일 플랫폼 사용자가 같은 portal로 재인증하면 soft-revoked 행을 안전하게 재활성화하며 새 중복 identity를 만들지 않는다.
- `/account/links`는 loading/empty/error/success/expired/rate-limited/reauth-failed/unlink-confirm/success 상태를 제공하고, destructive action 전 확인·성공 안내·실패 원인·focus 이동을 제공한다.
- 모든 버튼은 최소 44px, 키보드로 조작 가능하고 focus ring이 보인다. 인증 명령은 복사 가능하며 paste를 차단하지 않는다.
- 375/768/1024/1440px에서 가로 overflow 0이고 긴 만료 시각·오류 문구·플랫폼 목록도 잘리지 않는다. html-tailwind stack 검색은 두 번 모두 결과가 없어 이 반응형 항목은 ui-ux-pro-max 기본 기준을 적용한다.
- `typecheck`, `build`, focused tests, migration apply/rollback/apply, MariaDB restart/replay, actual service→route→browser Shadow가 PASS한다.

## Gate 상태

| Gate | 상태 | 근거 |
|---|---|---|
| Gate 1 현행 조사 | TRUE | 셸·인증·challenge·provider·DB·관리자 masking 코드 대조 |
| Gate 2 DB/계약 매핑 | TRUE | 공개 UUID, 상태 전이, receipt/check 확장, R/W 자원과 API DTO 확정 |
| Gate 3 합성 데이터 | FALSE | 구현 Lease에서 작성 |
| Gate 4 구현 | FALSE | source 변경 없음 |
| Gate 5 통합 | FALSE | 구현 전 |
| Gate 6 parity | FALSE | 구현 전 |
| Gate 7 Shadow/독립 검토 | FALSE | 구현 전 |
| Gate 8 운영 준비 | FALSE | 사용자 승인 전 |

제품 blocker는 남기지 않는다. 사용자의 “연결된 플랫폼 리스트 확인 및 삭제”는 platform identity soft unlink로 해석하고, 기존 코드가 platform 활성 상태를 identity/membership/selection join으로 판정하므로 마지막 연결 해제 시 웹·게임 소유권을 보존하고 플랫폼 접근만 끊는 정책을 적용할 수 있다.
