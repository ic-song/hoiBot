# 관리자 통합 가방 한도 정리

`/글자수전체정리`는 이름과 달리 미니펫, 가구, 펜던트 가방에서 현재 한도를 초과한 자산을 영구 정리하는 관리자 명령이다.

## 보존 계약

- 미니펫: `owned_mini_pets`의 stable `bag_sequence`를 사용하고 장착, 거래 예약, 보호 참조, 장착 확인 대상을 보존한다.
- 가구: `furniture_inventory_instances.status='bag'`만 정리하고 배치·거래 상태를 보존한다.
- 펜던트: `inventory_instances.status='owned'`인 pendant만 등급·이름·instance ID 순으로 정리하고 장착·예약 상태를 보존한다.
- 세 영역은 하나의 MariaDB transaction에서 처리되며 어느 한 단계라도 실패하면 모두 롤백한다.
- 실행 결과는 command execution, audit, outbox와 명령 전용 snapshot 원장에 기록한다.

## 검증 결과

- focused: 2/2
- typecheck/build: PASS
- fresh MariaDB: migrations 430, migration 438 PASS
- mutation parity: 미니펫 3, 가구 2, 펜던트 2 제거
- protected parity: 미니펫 보호 참조, 배치 가구, 예약 펜던트 보존
- idempotency/restart: PASS
- audit failure rollback: PASS
- migration narrow rollback/replay: PASS
- full regression: 1,576 total, 1,568 pass, 0 fail, 8 skip
- rollout: SHADOW, Gate 8 FALSE
