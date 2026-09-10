# WEB-WBS-013B 사용자 세션 회수 UI 준비도 감사

## 증거 식별자

| 항목 | 값 |
|---|---|
| WBS | `WEB-WBS-013B` |
| 후보 슬라이스 | `SL-ACCOUNT-ADMIN-WEB-SESSION-REVOKE-01` |
| Lease | `Lease2656` |
| delta | `SCD-WEB-20260910-15` |
| evidence schema | `web-admin-session-revoke-readiness-v1` |
| 지정 기준 커밋 | `584b24cee6ac58b5faf26e9cd867b60351535a4f` |
| 감사 시점 HEAD | `e0d3c871edacf8e75c976add53d76535ea507984` |
| 실행 프로필 | `MUTATION_TRANSACTIONAL` 준비도 감사 |
| 구현 판정 | **NO-GO — WEB-WBS-013A Gate 7 GO 전 구현 금지** |
| 분류 | **확장(부분 확장)** |

이 문서는 기존 증거를 새 schema로 재라벨링하지 않는다. WBS18, WBS607, WEB-WBS-013A 증거는 각 원래 schema와 커밋을 그대로 인용하고, 이 문서만 `web-admin-session-revoke-readiness-v1`을 사용한다. 지정 기준 이후 HEAD에 추가된 변경은 WEB-WBS-013A 독립 검토 문서뿐이며, 이 감사가 읽은 런타임 소스의 blob은 지정 기준과 같다.

## 결론

WEB-WBS-013B는 **신규 기능 전체 구현**도 **기존 기능 단순 재사용**도 아닌 **부분 확장**이다. 관리자 mutation 공통 골격, 인증·CSRF·사유·확인·idempotency 입력 처리, `user_sessions.revoked_at` DML, `operations`/`command_audit` 원자적 기록 방식은 재사용할 수 있다. 그러나 관리자용 독립 세션 회수 provider, route, 전용 RBAC, 응답 DTO, member-detail UI와 standalone 행위 증거는 존재하지 않아 새로 추가해야 한다.

계정 제한이나 계정 삭제가 세션을 함께 회수하는 현재 동작은 해당 도메인 mutation의 부작용이다. 이를 독립 세션 회수 primitive로 호출하거나 증거로 대체하면 안 된다. 독립 회수는 `player_restrictions`, `players.status`, `user_accounts.status`를 변경하지 않아야 한다.

현재 구현 선행조건은 충족되지 않았다. `web-admin-account-link-ui-20260910/independent-gate7-review.md`는 커밋 `e0d3c871`에서 WEB-WBS-013A를 NO-GO로 판정했다. 내부 account/link/version ID 노출과 service→route→browser 동일 입력 및 실제 오류 UI 증거 부재가 P1이다. 이 두 항목을 수정하고 독립 검토자가 Gate 7 GO를 기록하기 전에는 WEB-WBS-013B 구현 Lease를 열거나 소스·테스트·DB를 변경하지 않는다.

## 선행 WBS 책임과 증거 계보

| 선행 항목 | 확인한 책임 | 커밋·증거 | 013B에서의 의미 |
|---|---|---|---|
| WBS18 `SL-ACCOUNT-PLATFORM-AUTH` | 사이트 계정, 외부 계정 연결, 세션/CSRF, 자기 현재 세션 조회·로그아웃, 탈퇴 유예 시작 때 전체 세션 회수 | 구현·검증 `c4cf8a9`, 인계 `c7d422e`, 후속 API/세션 검증 `744c49d`·`e52a5ac`; 원래 `account-platform-auth/slice.json` | 세션 검증과 `revoked_at` DML 패턴만 재사용한다. 관리자 대상 독립 회수 책임은 없다. Gate 1~7 TRUE, Gate 8 FALSE다. |
| WBS607 `SL-COMMON-ADMIN-WEB-ACCOUNT-ACTIONS-01` | 제한 생성·변경 REST/UI, `account.restrict`, 사유·확인·CSRF·idempotency·audit·rollback | 현 브랜치 통합 구현 `03b9ae01`, 증거 `6aa58e53`; 원 소유 브랜치 구현 `d98cb609`, 증거 `82dc041e`; `admin-web-account-actions/slice.json` | `AdminManagementService.mutate`와 route mutation guard를 재사용한다. 제한 생성 시 세션 회수는 제한 mutation의 부작용이며 standalone provider가 아니다. Gate 1~7 TRUE, Gate 8 FALSE다. |
| WEB-WBS-013A | member detail 계정 연결 조회 UI/API | 구현 `50b5f176`·`f8bf316b`, 대상 HEAD `584b24ce`, 독립 검토 `e0d3c871` | 013B UI의 대상 계정 문맥 선행자다. 현재 Gate 7 NO-GO이므로 구현 차단 조건이다. |

WBS607과 WBS18의 Gate 8 미완료는 운영 반영 완료 증거가 없다는 뜻이다. 013B는 이 증거를 자체 schema로 승격하거나 대신 완료 처리하지 않는다.

## 현재 primitive·계약 감사

### 재사용할 수 있는 요소

1. `runtime/src/admin/management-service.ts`의 private `mutate`는 `operations`의 `(idempotency_scope, idempotency_key)`를 `FOR UPDATE`로 확인하고, 동일 키의 완료 결과를 재생하며, 업무 DML·`command_audit`·operation 완료를 한 트랜잭션에 묶는다. 독립 회수 public method가 이 envelope를 사용할 수 있다. 다만 완료 row replay만 현재 코드로 확인됐으며, 아직 없는 key의 동시 INSERT loser가 최초 결과를 다시 읽는 계약과 `replayed` 표시는 013B에서 보강·검증해야 한다.
2. `runtime/src/admin/routes.ts`의 `readMutation`은 `Idempotency-Key`, 비어 있지 않은 `reason`, `confirmed=true`를 강제한다. 관리자 cookie 인증과 mutation CSRF 검증도 이미 있다.
3. `runtime/src/user-auth/user-auth-service.ts`의 `logout`은 현재 로그인한 본인 세션 하나를 `revoked_at=UTC_TIMESTAMP(3)`로 바꾼다. `requestDeletion`은 해당 계정의 활성 세션 전부를 바꾼다. 후자의 DML 형태만 참고하며 탈퇴 transaction을 호출하지 않는다.
4. `runtime/src/admin/web-shell-assets.ts`의 member detail 제한 UI는 permission 기반 표시, 사유·확인, mutation 요청, 오류/성공 갱신 패턴을 제공한다.

### standalone으로 재사용할 수 없는 요소

| 현재 동작 | 실제 소유 행위 | standalone으로 볼 수 없는 이유 |
|---|---|---|
| `AdminManagementService.createRestriction` | 제한 생성, account suspended 전환, 활성 세션 회수 | 제한·계정 상태 변경과 결합되어 있고 action/audit도 restriction 의미다. |
| `AdminAccountSuspensionService.activate` | Iris 관리자 정지, player/account suspended, 세션 회수, outbox | 웹 route가 아니며 정지 실행의 부작용이다. |
| `UserAuthService.logout` + `DELETE /api/v1/sessions/current` | 현재 로그인한 본인의 현재 세션 종료 | 관리자 대상 지정, 관리자 RBAC, 관리자 audit/idempotency가 없다. |
| `UserAuthService.requestDeletion` | 탈퇴 유예 전환과 전체 세션 회수 | 계정 lifecycle 변경과 결합되어 있고 되돌림 의미도 탈퇴 도메인이다. |

### 현재 없는 계약

- 관리자 대상 standalone 세션 회수 service method/provider
- 관리자용 session-revocation route
- `account.session.revoke`처럼 restriction과 분리된 최소 권한
- 회수 건수·동일 키 replay·audit 식별자를 담는 외부 응답 DTO
- member detail의 세션 회수 버튼, 사유/확인 dialog, 진행·성공·실패·재시도 상태
- no linked account, no active session, missing player, stale UI race의 명시적 응답 계약
- standalone 회수의 same-key replay, concurrent different-key, audit failure rollback, 재시작 후 replay 통합 증거

## 권장 API·권한·응답 계약

### API

`POST /api/v1/admin/players/:playerId/session-revocations`

요청 조건은 관리자 session cookie, CSRF header, `Idempotency-Key`, JSON body `{ "reason": "...", "confirmed": true }`다. `playerId`를 경로 식별자로 쓰고 portal account/link ID, session ID, token hash를 브라우저가 보내지 않게 한다.

권한은 새 `account.session.revoke`를 사용한다. restriction 소유 권한인 `account.restrict`를 공유하면 제한 권한 보유자가 별도 검토 없이 인증 세션까지 끊을 수 있으므로 최소 권한 분리가 필요하다. 초기 grant는 `super_admin`으로 제한하고 다른 역할 부여는 별도 운영 승인으로 다룬다.

권장 성공 응답은 다음 외부 필드만 제공한다.

```json
{
  "ok": true,
  "requestId": "request-id",
  "sessionRevocation": {
    "playerId": 123,
    "revokedSessionCount": 2,
    "replayed": false,
    "auditId": "audit-id"
  }
}
```

동일 idempotency key의 재요청은 최초 HTTP status와 업무 결과를 보존하고 `replayed=true`로만 전달 경로를 구분한다. response와 audit에는 session ID, session/token hash, 내부 portal account/link ID를 넣지 않는다. 존재하지 않는 player는 `404`; 존재하는 player에 연결 계정이 없거나 활성 세션이 없으면 race-safe한 `200` 성공 no-op과 `revokedSessionCount=0`을 반환하고 audit summary에서 `no_linked_account` 또는 `no_active_session`을 구분한다. UI는 013A 조회 결과에 연결 계정이 없으면 버튼을 숨기거나 disabled 처리하지만 backend no-op은 동시성 안전망으로 유지한다.

## 동시성·idempotency·audit·rollback

권장 idempotency scope는 `admin.user_session_revoke:<playerId>`다. 한 트랜잭션에서 operation key를 먼저 확인하고, 대상 player와 연결된 `user_accounts`를 `FOR UPDATE`로 잠근 뒤 활성 `user_sessions`만 회수한다. 현재 `mutate`의 completed-row replay를 유지하되, 같은 새 key가 동시에 들어올 때 unique-key 충돌 loser가 실패 응답으로 끝나지 않고 winner commit 뒤 저장 결과를 다시 읽도록 구현해야 한다.

- 같은 key 동시/재시도: 최초 결과와 audit ID를 재생하며 두 번째 UPDATE와 audit INSERT를 만들지 않는다.
- 다른 key 동시 요청: account row lock으로 직렬화한다. 최초 요청은 N건, 다음 요청은 정상 no-op 0건으로 각각 감사된다.
- UI의 응답 유실/네트워크 오류: 성공 여부가 불명확하면 같은 key로 재시도한다. 사용자가 새 회수 동작을 명시적으로 시작할 때만 새 key를 발급한다.
- audit: 물리 테이블 `command_audit`에 action code `admin.user_sessions.revoked`, actor admin ID, target type `player`, target player ID, reason, 회수 건수와 no-op 사유를 기록한다. token/session/internal account 식별자는 기록하지 않는다.
- commit 전 실패: session UPDATE, audit INSERT, operation 완료를 모두 rollback한다. audit 또는 operation 완료 실패 후 세션만 회수된 상태가 남아서는 안 된다.
- commit 후 의미: 회수된 인증 비밀을 안전하게 원복하는 `unrevoke`는 제공하지 않는다. DB rollback이나 보상 UPDATE가 아니라 동일 key 결과 재확인과 사용자 재로그인이 복구 절차다. restriction/account/player 상태는 애초에 변경하지 않는다.

현재 저장소에는 `admin_audit_events`와 `idempotency_records`라는 물리 테이블·migration·provider가 없다. 현재 물리 대응물은 각각 `command_audit`와 `operations`다. 이 이름 차이를 숨기지 않는다. 제품이 전자의 정확한 논리/물리 이름을 요구한다면 별도 DATA_MIGRATION/provider 선행 작업으로 분리해야 하며, 최소 013B 구현은 기존 물리 테이블을 사용한다.

## 최소 DB DML

기능 구현 자체에는 새 session table이나 column이 필요 없다. 다만 최소 권한을 위해 migration sequence를 claim한 뒤 `admin_permissions`에 `account.session.revoke`를 추가하고 `admin_role_permissions`에서 `super_admin`에만 grant하는 DML이 필요하다.

업무 트랜잭션의 최소 DML은 다음과 같다.

1. `operations`: scope/key `SELECT ... FOR UPDATE`, 없으면 시작 row `INSERT`.
2. `players` 및 연결 `user_accounts`: 대상 확인과 직렬화를 위한 `SELECT ... FOR UPDATE`.
3. `user_sessions`: `UPDATE ... SET revoked_at=UTC_TIMESTAMP(3) WHERE user_account_id=? AND revoked_at IS NULL`.
4. `command_audit`: 사유와 비민감 결과 summary `INSERT`.
5. `operations`: 결과 JSON과 audit ID를 포함해 completed `UPDATE`.

`user_accounts`는 읽기·lock만 하며 status를 UPDATE하지 않는다. `player_restrictions`, `players.status`, outbox에는 DML하지 않는다.

## Lease 자원

### Lease2656 감사에서 사용한 정확한 R/W

R:

- `R:FILE:hoibot/개발환경_고도화/runtime/src/admin/management-service.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/admin/routes.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/admin/admin-account-suspension-service.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/user-auth/user-auth-service.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/user-auth/routes.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/admin/web-shell-assets.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/app.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/migrations/002_event_processing.sql`
- `R:FILE:hoibot/개발환경_고도화/runtime/migrations/016_site_signup_auth.sql`
- `R:FILE:hoibot/개발환경_고도화/runtime/migrations/017_admin_authorization_lifecycle.sql`
- `R:FILE:hoibot/개발환경_고도화/runtime/migrations/346_admin_account_suspension.sql`
- `R:EVIDENCE:hoibot/SL-ACCOUNT-PLATFORM-AUTH`
- `R:EVIDENCE:hoibot/SL-COMMON-ADMIN-WEB-ACCOUNT-ACTIONS-01`
- `R:EVIDENCE:hoibot/WEB-WBS-013A`
- `R:DB:hoibot/user_sessions`
- `R:DB:hoibot/user_accounts`
- `R:DB:hoibot/admin_audit_events` — 물리 객체 없음 확인
- `R:DB:hoibot/idempotency_records` — 물리 객체 없음 확인

W:

- `W:FILE:hoibot/개발환경_고도화/migration-control/evidence/web-admin-session-revoke-readiness-20260910/readiness.md`
- `W:WBS:hoibot-web/구축_WBS/WEB-WBS-013B` — 이번 감사에서는 원격 WBS를 변경하지 않고 보고 대상만 한정

### 선행조건 충족 후 권장 구현 Lease

아래 자원은 WEB-WBS-013A Gate 7 GO와 foreman claim 전에는 쓰지 않는다.

R:

- `R:FILE:hoibot/개발환경_고도화/runtime/src/user-auth/user-auth-service.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/user-auth/routes.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/admin/admin-account-suspension-service.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/app.ts`
- `R:DB:hoibot/user_accounts`
- `R:DB:hoibot/players`
- `R:EVIDENCE:hoibot/SL-ACCOUNT-PLATFORM-AUTH`
- `R:EVIDENCE:hoibot/SL-COMMON-ADMIN-WEB-ACCOUNT-ACTIONS-01`
- `R:EVIDENCE:hoibot/WEB-WBS-013A`

W:

- `W:FILE:hoibot/개발환경_고도화/runtime/src/admin/management-service.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/src/admin/routes.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/src/admin/web-shell-assets.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/admin-web-session-revoke.test.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/admin-web-session-revoke.integration.test.ts`
- `W:PROVIDER:hoibot/admin-user-session-revoke`
- `W:ROUTE:hoibot/POST:/api/v1/admin/players/:playerId/session-revocations`
- `W:DB:hoibot/user_sessions`
- `W:DB:hoibot/operations`
- `W:DB:hoibot/command_audit`
- `W:DB:hoibot/admin_permissions`
- `W:DB:hoibot/admin_role_permissions`
- `W:MIGRATION:hoibot/admin-user-session-revoke-rbac-v1` — 실제 번호는 migration sequence claim 때 확정
- `W:EVIDENCE:hoibot/web-admin-session-revoke-v1`
- `W:WBS:hoibot-web/구축_WBS/WEB-WBS-013B`

기존 `AdminManagementService`와 `registerAdminRoutes` 안에서 확장하면 `runtime/src/app.ts`는 W가 아니다. 별도 provider/route registrar를 선택할 때만 별도 W Lease를 다시 받아야 한다.

## T0~T3 검증 계획

| Tier | 목적 | 필수 검증 |
|---|---|---|
| T0 | 계약·소유권 고정 | WEB-WBS-013A 독립 Gate 7 GO, delta `SCD-WEB-20260910-15`, provider/route/DB/migration Lease, WBS607 restriction 부작용과 standalone 책임 분리, 후속 구현용 신규 evidence schema 별도 할당. 기존 evidence 재라벨링 금지. |
| T1 | 빠른 계약·UI 검증 | route/service 단위 테스트로 RBAC, CSRF, reason, confirm, idempotency header, missing player, no linked account, no active session, response masking을 검증한다. member detail은 permission별 표시, dialog, double-submit, 같은-key retry, 400/401/403/404/409/5xx 상태와 성공 후 갱신을 실제 client path에서 검증한다. keyboard/focus/live-region과 360/768/1024/1440 viewport도 포함한다. |
| T2 | `MUTATION_TRANSACTIONAL` 통합 검증 | 실제 service→route→browser 동일 fixture로 N건 회수와 즉시 인증 실패를 검증한다. same-key lost-response/restart replay는 한 UPDATE·한 audit만 남아야 한다. different-key 동시 요청은 N/0으로 직렬화한다. audit INSERT·operation complete 강제 실패 때 모든 DML rollback, commit 후 same-key 재조회, no status/restriction/outbox side effect, MariaDB synthetic DML 경계를 검증한다. 013B의 개발 완료 최소 tier다. |
| T3 | staging·운영 준비 | 실제 배포형 환경에서 권한 grant, CSRF/session cookie, 다중 브라우저 세션, 관측 로그·audit 조회, 백업/복구 절차와 재로그인 안내를 점검한다. Gate 8은 사용자 승인, staging/Shadow, backup·restore·cutover·rollback runbook이 모두 확인된 뒤에만 완료한다. |

## 감사 무결성

- 소스, 테스트, migration, DB를 수정하지 않았다.
- 실제 DB DML이나 운영/Shadow 실행을 하지 않았다.
- 현재 파일 blob 확인값: `management-service.ts` `d8f38c5f...`, `admin/routes.ts` `2b2ff66c...`, `admin-account-suspension-service.ts` `9244e338...`, `user-auth-service.ts` `1b4695a1...`, `user-auth/routes.ts` `b9933ef8...`, `web-shell-assets.ts` `1f30f4aa...`, `app.ts` `672fa01f...`.
- `admin_audit_events`와 `idempotency_records`는 저장소 검색 결과 물리 객체가 없었으며, 이 문서는 이를 기존 `command_audit`와 `operations`로 임의 재명명하지 않았다.
- 이 감사 결과는 구현 승인이나 Gate 완료 증거가 아니다. 현재 상태는 선행조건 미충족 NO-GO다.
