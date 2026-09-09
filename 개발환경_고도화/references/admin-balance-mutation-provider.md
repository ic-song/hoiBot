# 관리자 확률·수치 변경 provider

## 범위

- WBS: 638
- DB 매핑: 1916
- Lease: 2419
- 실행 ID: `개발자-SL-COMMON-ADMIN-BALANCE-MUTATION-PROVIDER-01-20260831T0920`
- 기준선: `9f7197b22a40852dcdeb8c231fa49616c17016d1`

## 승인된 변경 도메인

1. 홈뱃지: 현재 shadow 정의 버전을 복제하고 승인된 `criteria_json` 정수 임계값만 새 버전에서 변경합니다.
2. 가구: 현재 active 추첨 카탈로그와 등급 구간을 복제하고 등급 확률을 정확한 scaled weight로 변환해 새 버전을 활성화합니다.
3. 펜던트: 현재 published 정책과 30개 레벨을 복제하고 고정된 타입별 컬럼만 새 정책 버전에서 변경합니다.

공통 provider는 도메인별 SQL을 입력으로 받지 않습니다. 고정된 adapter가 기존 canonical 버전 테이블만 사용하며, rollback도 과거 행을 다시 활성화하지 않고 대상 내용을 복제한 새 버전을 생성합니다.

## Preview·Apply·Rollback 계약

- preview는 `expectedVersion`, 변경 항목, 사유를 검증하고 변경 전후 값과 결정적 confirmation token을 반환합니다.
- apply는 preview와 같은 payload 및 confirmation token을 요구합니다. 실행 직전 현재 버전과 운영자 활성 상태를 다시 확인합니다.
- rollback은 대상 과거 버전의 값을 읽어 현재 버전과 비교한 뒤 새 버전으로 복제합니다.
- 동일 idempotency key와 동일 payload는 저장된 결과를 replay하고, 같은 key에 다른 payload는 거부합니다.

## 원자성 및 기록

한 transaction 안에서 다음 작업을 함께 처리합니다.

- 새 도메인 버전 복제와 활성화
- `configuration_sets` 새 버전 기록
- `configuration_change_log` before/after 및 사유 기록
- `command_audit` 성공 기록
- 기존 admin-web outbox 이벤트 기록
- `operations` 결과 저장

어느 기록이라도 실패하면 도메인 버전, operation, change log, audit, outbox가 모두 rollback됩니다. 재연결 후에도 기존 활성 버전과 값이 유지되는 synthetic 시나리오를 검증합니다.

## 검증 경계

- `reason`: 5~500자
- 버전: 0 이상의 정수 문자열 및 optimistic version 일치
- 값: projection의 `min`, `max`, `step` 준수
- 가구 등급 확률: 동일 `sumGroup` 전체를 제출하고 정확히 100% 유지
- 펜던트: 각 DB 컬럼 정밀도에 맞는 소수 자릿수 유지
- `editable=false`, 알 수 없는 key, 중복 key, 값 미변경 요청은 거부

## 제외 범위

- schema와 migration
- 범용 SQL·테이블·컬럼 편집기
- domain gap 임시 구현
- WBS639 REST route 및 웹 UI
- wallet RNG, luck pouch, 회원 lightningRate, `main.js`
- 운영 DB, `feature/prod`, Gate8
