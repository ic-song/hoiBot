# WEB-WBS-013B 독립 Gate 7 검토

## 판정

- 검토 Lease: `Lease2666`
- 구현 기준: `3dc59c41b8a0f8e5959d5f7c5cdb474a182b72c5`
- catalog / delta / evidence schema: `SC-20260902-1` / `SCD-WEB-20260910-18` / `web-admin-session-revoke-v1`
- profile / tier: `MUTATION_TRANSACTIONAL` / `T2`
- 결과: **GO**
- 심각도: `P0 0 / P1 0 / P2 1`
- Gate 7: **TRUE**
- Gate 8: **FALSE**

구현 책임자·구현자·제출 evidence 작성자와 분리된 검토자로서 source, test, 기존 evidence를 수정하지 않고 동일 커밋을 재검증했다. 제출 checkpoint와 evidence에 남은 `Lease2661`은 구현 실행 이력으로 보존하며, 이 독립 리뷰의 쓰기 권한은 중앙 재발급 `Lease2666`과 이 파일 하나에만 적용했다.

## 계약 검증

- API는 `POST /api/v1/admin/players/:playerId/session-revocations` 한 경로이며 관리자 cookie, CSRF, `Idempotency-Key`, 비어 있지 않은 `reason`, `confirmed=true`를 강제한다.
- `account.session.revoke` permission과 `super_admin` 역할을 모두 확인하고, uint64 player ID를 문자열로 유지한다.
- 성공 응답은 최상위 `sessionRevocation` 한 키이며 하위 필드는 `playerId`, `revokedSessionCount`, `replayed`, `auditId` 네 개뿐이다. session/token/user account/portal/link 내부 식별자 노출은 0건이다.
- 같은 key 재실행은 기존 완료 result를 `replayed=true`로 반환하고 추가 session UPDATE·audit을 만들지 않는다. unique-key loser도 winner 완료 결과를 잠금 재조회한다.
- 다른 key는 player와 연결 account row를 `FOR UPDATE`로 잠가 첫 요청 N건, 후속 요청 0건이 되도록 직렬화한다.
- 연결 계정 없음과 활성 세션 없음은 각각 `no_linked_account`, `no_active_session` 감사 결과와 200/count0으로 처리한다.
- audit insert 또는 operation complete 실패 시 operation, session revoke, audit이 함께 rollback된다.
- 허용 DML은 `operations`, `user_sessions`, `command_audit`뿐이다. `players`, `user_accounts`, `player_restrictions`, outbox 변경은 없다.
- migration474는 활성 `super_admin`에만 신규 permission을 grant하고, rollback은 해당 role binding과 permission만 제거한다. table drop·truncate는 없다.

## 독립 실행 결과

- focused 및 기존 관리자 회귀: **34/34 PASS**
- `npm run typecheck`: **PASS**
- `npm run build`: **PASS**
- `git diff --check 0e36833b..3dc59c41`: **PASS**
- 기준 commit ancestry와 `origin/feature/web-portal`: **PASS**
- 제출 source/test/migration SHA-256 7개: **모두 일치**

실제 `AdminManagementService`와 실제 Fastify admin route, 실제 admin shell을 합성 DB 경계에 연결해 별도 Chrome 포트에서 독립 재실행했다. 깨끗한 host 세션에서 합성 `super_admin` 로그인 → 회원 목록 → 회원 상세 → 계정 연결 조회 → 사유·명시 확인 → 세션 회수 POST를 수행했고 화면에 `2개 활성 세션을 회수했습니다.`가 표시됐다.

| viewport | horizontal overflow | action visible | submit height | 결과 |
|---:|---:|---|---:|---|
| 375 | 0 | TRUE | 44px | PASS |
| 768 | 0 | TRUE | 44px | PASS |
| 1024 | 0 | TRUE | 44px | PASS |
| 1440 | 0 | TRUE | 44px | PASS |

## P2와 남은 조건

`P2-1`: 현재 실행 환경에는 `DATABASE_INTEGRATION_ENABLED`, DB 연결 변수와 `.env`가 없어 live MariaDB를 사용하지 않았다. 따라서 migration474의 실제 apply/rollback과 InnoDB unique-key 경합·row-lock 동작은 source 계약 및 합성 transaction 경계로만 확인됐다. 구현 경계, rollback, 멱등 result, DML 제한과 실제 service→route→shell Chrome 연결은 독립 재실행으로 확인되어 Gate 7을 막지는 않지만, Gate 8 전 격리된 staging MariaDB에서 apply→동시 요청→restart replay→rollback rehearsal을 수행해야 한다.

운영 DB·운영 데이터·`feature/prod`는 변경하지 않았고 Gate 8은 진행하지 않았다.
