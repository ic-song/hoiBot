# Admin Web Reward Currency Slice

## 범위

- Slice: `SL-COMMON-ADMIN-WEB-REWARD-CURRENCY-01`
- Execution: `개발자-SL-COMMON-ADMIN-WEB-REWARD-CURRENCY-01-20260830162101`
- Baseline: `82dc041e`
- 대상: 기존 관리자 웹 셸에서 회원별 재화 잔액·version 조회와 기존 `CurrencyService.adjust` 증감 연결
- Gate: Gate 1~7
- Gate 8: 의도적으로 미완료

이 슬라이스는 기존 재화 계정, 원장, operation, command audit, 내부 outbox transaction을 웹 소비자에서 재사용한다. 신규 MariaDB schema·migration·provider·outbox를 추가하지 않고, 운영 데이터·legacy Rhino·`feature/prod`에 접근하지 않는다. generic grant와 Iris destination은 별도 provider dependency 경계로 유지한다.

## Gate 1 현행 조사

- `CurrencyService.adjust`는 `playerId`, `currencyCode`, 문자열 `delta`, `expectedVersion`, 사유, idempotency key, actor, source를 받는다.
- 서비스는 재화 계정을 `FOR UPDATE`로 읽고 version 충돌과 음수 잔액을 거부한다.
- 성공 transaction은 `currency_accounts` balance/version, `currency_ledger`, `operations`, `command_audit`, 내부 `outbox_messages`를 함께 반영한다.
- 같은 player/currency scope와 idempotency key의 완료 operation은 원래 balance/version/audit 식별자를 재생하며 mutation을 반복하지 않는다.
- 관리자 웹 권한은 기존 `game.currency.change`만 사용한다.
- 기존 회원 프로필은 재화 balance map만 반환하므로, 호환 map을 유지하면서 `currencyAccounts[{code,balance,version}]` 읽기 모델을 추가한다.

## Gate 2 웹 소비자 계약

| 사용자 흐름 | 권한 | API | 필수 입력 |
|---|---|---|---|
| 현재 잔액·version 조회 | `player.read` | `GET /api/v1/admin/players/:playerId` | 회원 ID |
| 재화 증가 | `game.currency.change` | `POST /api/v1/admin/players/:playerId/currencies/:currencyCode/adjustments` | 양수 delta, expectedVersion, 사유, 확인, CSRF, idempotency key |
| 재화 차감 | `game.currency.change` | 같은 POST | 음수 delta, expectedVersion, 사유, 확인, CSRF, idempotency key |

- DB mapping: `DB1883 ADMIN_WEB_CURRENCY_VERSION_READ`, `DB1884 ADMIN_WEB_CURRENCY_ADJUST`.
- 회원 상세의 현재 재화 카드에서 잔액과 version을 함께 확인한 뒤 증가·차감을 실행한다.
- `game.currency.change`가 없거나 version을 읽을 수 없으면 조정 폼을 렌더링하지 않는다.
- 실패 재시도는 같은 입력 scope의 idempotency key를 유지하고 성공한 뒤에만 폐기한다.
- 계정 제재, 일반 보상 지급, 카탈로그 편집, 백업·복구 UI는 이 슬라이스에 포함하지 않는다.

## Gate 3~5 합성·통합 검증

- 비식별 회원 `#40001`에 diamond `350 / v4`, point `1,200,000 / v9` 합성 계정을 사용한다.
- 증가, 차감, 0 delta, 잔액 부족, version conflict, 회원 not-found, 권한 거부, CSRF 누락, 동일 key replay를 검증한다.
- 실제 `registerAdminRoutes`와 실제 `CurrencyService`를 transaction-aware 합성 DB에 연결한다.
- 성공 시 account balance/version, ledger 1건, command audit 1건, 내부 outbox 1건을 검증한다.
- command audit 또는 outbox 삽입을 강제로 실패시켜 account, ledger, operation, audit, outbox 전체 롤백을 검증한다.
- 실제 `MariaProfileRepository`가 기존 balance map과 정렬된 version 배열을 함께 반환하는지 검증한다.

## Gate 6~7 검증 결과

- focused parity: 18/18 PASS
- typecheck: PASS
- build: PASS
- full regression: 1,168 tests / 1,161 PASS / 0 FAIL / 7 SKIP
- desktop Shadow: diamond 증가 `350→375, v4→v5`, point 차감 `1,200,000→1,199,900, v9→v10` PASS
- mobile Shadow: 390×844, 재화 카드 2개·단일 열 조정 폼 PASS, 수평 overflow 없음
- browser console warning/error: 0
- Shadow 중 발견한 `String.raw` 숫자 정규식 이중 escaping을 수정하고 계약 테스트를 추가
- 운영 데이터 접촉: false
- MariaDB schema/migration/provider 변경: false
- `feature/prod` 변경: false
- Gate 8: false

## 남은 dependency

이 소비자는 기존 `CurrencyService.adjust`의 내부 outbox까지만 사용한다. generic reward grant, 외부 Iris destination, 보상 대상 선정, 대량 지급, 재처리·보상 정책은 이번 API에 섞지 않으며 별도 provider/소비자 슬라이스에서 권한·감사·재생·롤백 계약을 승인받아야 한다.
