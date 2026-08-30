# Admin Web Account Actions Slice

## 범위

- Slice: `SL-COMMON-ADMIN-WEB-ACCOUNT-ACTIONS-01`
- Execution: `개발자-SL-COMMON-ADMIN-WEB-ACCOUNT-ACTIONS-01-202608300637`
- Baseline: `65f84c6e`
- 대상: 기존 관리자 웹 셸의 회원 상세와 기존 계정 제재 REST/API provider 연결
- Gate: Gate 1~7
- Gate 8: 의도적으로 미완료

이 슬라이스는 기존 `POST /api/v1/admin/players/:playerId/restrictions`, `PATCH /api/v1/admin/restrictions/:restrictionId`, `AdminManagementService`를 소비한다. MariaDB schema·migration·provider를 추가하거나 변경하지 않고, 운영 데이터·legacy Rhino·`feature/prod`에도 접근하지 않는다.

## Gate 1 현행 조사

- `GET /api/v1/admin/players/:playerId`는 기존 `listRestrictions` 결과를 회원 상세에 합친다.
- 신규 정지는 `account.restrict` 권한, 세션 쿠키, `X-CSRF-Token`, `Idempotency-Key`, 비어 있지 않은 `reason`, `confirmed=true`를 요구한다.
- 기간 정지는 `endsAt`이 필수이며, 영구 정지는 `endsAt=null`로 저장한다.
- 제재 생성은 `player_restrictions` 추가, `user_accounts.status=suspended`, 활성 `user_sessions` 폐기, `operations` 완료, `command_audit` 기록을 한 `AdminManagementService.mutate` transaction에 묶는다.
- 제재 해제는 활성 제재를 `FOR UPDATE`로 조회하며 없으면 404를 반환한다. 다른 활성 제재가 없을 때만 계정을 `active`로 되돌린다.
- 동일 scope/key의 완료 operation은 저장된 `result_json`을 재생하며 두 번째 제재·감사 기록을 만들지 않는다.
- 현재 제재 provider에는 `outbox_messages` 기록이 없다. 이 부재는 이번 소비자에서 숨기거나 보완하지 않고 별도 dependency GAP으로 유지한다.
- 회원 상세 조회는 기존 계약대로 만료된 기간 제재를 `expired`로 갱신한다. 읽기/유지보수 분리는 별도 provider 슬라이스 대상이다.

## Gate 2 웹 소비자 계약

| 사용자 흐름 | 권한 | 기존 API | 필수 입력 |
|---|---|---|---|
| 제재 이력 확인 | `player.read` | `GET /api/v1/admin/players/:playerId` | 회원 ID |
| 기간 정지 | `account.restrict` | `POST /api/v1/admin/players/:playerId/restrictions` | 종료 시각, 사유, 확인, CSRF, idempotency key |
| 영구 정지 | `account.restrict` | 같은 POST | 사유, 확인, CSRF, idempotency key |
| 활성 제재 해제 | `account.restrict` | `PATCH /api/v1/admin/restrictions/:restrictionId` | `status=revoked`, 사유, 확인, CSRF, idempotency key |

- 별도 관리 메뉴나 새 경로를 만들지 않고, 대상을 확인할 수 있는 기존 회원 상세에 조치 폼을 둔다.
- `account.restrict`가 없으면 모든 조치 폼을 렌더링하지 않는다.
- 같은 입력의 실패 재시도는 같은 idempotency key를 사용하고 성공한 뒤에만 key를 폐기한다.
- 조치가 감사 기록에 남지만 별도 알림은 발송되지 않는다는 문구를 조치 폼 바로 위에 표시한다.
- 재화·보상·패스·운영자·삭제·카탈로그·백업/복구 UI와 API는 포함하지 않는다.

## Gate 3~5 합성·통합 검증

- 운영 데이터 없이 기간 정지, 영구 정지, 해제, not-found, 권한 거부, CSRF 누락, 종료 시각 누락, 동일 key 재생을 합성 API에서 검증한다.
- 실제 `registerAdminRoutes`와 `AdminManagementService`를 transaction-aware 합성 DB에 연결한다.
- 실제 서비스 코드가 계정 suspended, 세션 폐기, 제재 생성·해제, operation 완료, command_audit를 처리하는지 검증한다.
- command_audit 삽입을 강제로 실패시켜 제재·계정·세션·operation 전체가 이전 상태로 롤백되는지 검증한다.
- 현재 서비스가 outbox를 만들지 않는 점을 명시적으로 검증하고 GAP으로 유지한다.

## Gate 6~7 검증 결과

- focused parity: 14/14 PASS
- account-actions focused only: 10/10 PASS
- typecheck: PASS
- build: PASS
- full regression: 1,163 tests / 1,156 PASS / 0 FAIL / 7 SKIP
- desktop Shadow: 로그인, 회원 상세, 기간 정지, 영구 정지, 제재 해제, 성공 toast PASS
- mobile Shadow: 390×844, 회원 상세·조치 폼·이력·메뉴 PASS, 수평 overflow 없음
- browser console warning/error: 0
- 운영 데이터 접촉: false
- MariaDB schema/migration/provider 변경: false
- `feature/prod` 변경: false
- Gate 8: false

## 남은 dependency

`AdminManagementService.createRestriction/updateRestriction`는 command_audit까지만 기록하고 별도 outbox·운영 알림을 생성하지 않는다. 운영 알림 또는 이벤트 발행이 필요하면 provider/outbox 소유 슬라이스에서 schema·재생·rollback·전송 실패 정책과 함께 독립적으로 승인받아야 한다.
