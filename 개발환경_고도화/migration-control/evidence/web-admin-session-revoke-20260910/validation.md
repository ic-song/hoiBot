# WEB-WBS-013B 사용자 세션 회수 구현·T2 검증

## 기준

- slice: `SL-ACCOUNT-ADMIN-WEB-SESSION-REVOKE-01`
- Lease: `Lease2661`
- catalog / delta / evidence schema: `SC-20260902-1` / `SCD-WEB-20260910-18` / `web-admin-session-revoke-v1`
- profile / tier: `MUTATION_TRANSACTIONAL` / `T2`
- 기준 커밋: `0e36833bc250e7dd857181f9cb7731d9aa087072`
- 선행 증거: WEB-WBS-013A 독립 Gate 7 GO `0e36833b`, WEB-WBS-013B readiness `SCD-WEB-20260910-15`

기존 WBS18, WBS607, WEB-WBS-013A 증거는 원래 schema와 Gate를 유지한다. 이 구현은 새 delta와 schema로만 기록하며 기존 exact-schema evidence를 재라벨링하지 않았다.

## 구현 계약

- `POST /api/v1/admin/players/:playerId/session-revocations`
- 관리자 session cookie, CSRF header, `Idempotency-Key`, 비어 있지 않은 `reason`, `confirmed=true`를 모두 강제한다.
- 신규 permission `account.session.revoke`는 migration 474에서 활성 `super_admin`에만 grant하고, route도 permission과 `super_admin` 역할을 함께 검사한다.
- uint64 player ID는 문자열로 보존하고 0, 선행 0, 음수, 소수, uint64 초과를 422로 거절한다.
- 성공 response는 최상위 `{ sessionRevocation }`만, 내부에는 `playerId`, `revokedSessionCount`, `replayed`, `auditId`만 둔다.
- session ID, token/hash, user/portal account ID, link ID는 response와 audit summary에 넣지 않는다.

## 트랜잭션·멱등성

- 013B만 최초 operation 조회를 비잠금 읽기로 수행해 없는 key에 대한 InnoDB gap-lock 교착을 피한다. 기존 관리자 mutation은 이전 `FOR UPDATE` 조회를 유지한다.
- 같은 새 key의 unique-key 경쟁 loser는 `ER_DUP_ENTRY` 뒤 winner의 completed result를 `SELECT ... FOR UPDATE`로 읽고 `replayed=true`로 반환한다.
- player row와 연결 account row를 `FOR UPDATE`로 잠가 다른 key를 직렬화한다. 최초 요청은 N건, 후속 요청은 0건으로 각각 감사된다.
- 연결 계정 없음은 `no_linked_account`, 활성 세션 없음은 `no_active_session`으로 audit summary에 남기고 둘 다 200 count 0을 반환한다.
- audit insert와 operation complete 실패를 강제했을 때 operations, session revoke, audit 전부 rollback됐다.
- DML은 `operations` insert/complete, `user_sessions` update, `command_audit` insert로 한정됐다. `players.status`, `user_accounts.status`, `player_restrictions`, outbox는 변경하지 않았다.

## UI·브라우저 Shadow

- 회원 상세에서 연결 계정 조회가 성공하고 1개 이상일 때만 세션 회수 form을 활성화한다.
- 미연결은 “연결 계정이 없어 세션을 회수할 수 없습니다.”, 조회 실패는 “연결 계정 상태를 확인하지 못해 세션 회수를 잠갔습니다.”로 분리한다.
- form에는 visible label, 이유, 명시 확인, alert/live region, submitting 상태와 같은-key retry가 있다.
- 실제 Chrome의 `http://127.0.0.1:3312/admin`에서 synthetic super_admin 로그인 → 회원 조회 → 합성회원 → 계정 연결 조회 → 실제 `AdminManagementService` → 실제 admin route → 실제 shell client POST를 실행했다.
- 동일 fixture의 활성 세션 2개가 회수됐고 UI status가 `2개 활성 세션을 회수했습니다.`로 갱신됐다.
- 375/768/1024/1440 px에서 action visible, horizontal overflow 0, submit button 44px를 확인했다. 세부 값은 `browser-shadow.json`에 있다.

## 검증 결과

- 신규 focused 9건 PASS: 인증·CSRF·멱등 header·reason·confirm·permission·role·uint64·exact DTO·RBAC migration·rollback·duplicate loser replay·UI a11y.
- 실제 service-route 합성 통합 4건 PASS: N/restart replay, 다른 key N/0, no-link/no-active audit, 404 무잔류, audit/operation rollback, DML boundary.
- 기존 관리자 회귀를 포함한 선택 실행 34/34 PASS. `focused-and-regression-tests.txt` 참조.
- `npm run typecheck`, `npm run build`, `git diff --check` PASS.
- 현재 환경에는 `DATABASE_INTEGRATION_ENABLED`와 MariaDB 연결 변수가 없어 운영·공유 DB에는 접속하거나 DML하지 않았다. migration 474와 rollback은 정적 계약 및 합성 T2 경계로 검증했다. 이 제한은 Gate 7 독립 검토에서 재평가한다.

## Gate

| Gate | 결과 | 근거 |
|---|---|---|
| 1 현행 조사 | TRUE | readiness와 WEB-WBS-013A 독립 GO 재확인 |
| 2 DB 매핑 | TRUE | 기존 tables + migration474/rollback, 최소 DML 고정 |
| 3 합성데이터 | TRUE | member/account/session/no-link/no-active/failure fixture |
| 4 구현 | TRUE | service, route, RBAC, UI 구현 |
| 5 통합 | TRUE | 실제 service→route→shell→Chrome 동일 입력 |
| 6 parity | TRUE | exact DTO, 멱등·rollback·DML boundary, 관리자 회귀 34/34 |
| 7 독립 검토 | FALSE | 현재 책임자·구현자·evidence 작성자 제외 검토 필요 |
| 8 운영 준비 | FALSE | 사용자 승인·운영 DB·배포·rollback runbook 미수행 |

운영 DB·운영 데이터·`feature/prod`는 변경하지 않았다.
