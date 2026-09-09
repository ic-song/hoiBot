# Lease2553 `/정령정보` canonical elemental grade consumer 검증

검증일: 2026-09-05

## 범위

- `/정령정보` exact 명령을 기존 partial dispatch의 MODERN 후보로 연결
- `player_pet_elementals.grade_code`는 migration119의 `grade_order` 탐색에만 사용
- `canonical_elemental_grade_definition_bridges.equipment_grade_definition_id` CUID FK로 `canonical_equipment_grade_definitions`의 경험치 수치를 조회
- 표시 이름/alias를 식별자로 사용하지 않음
- canonical item 정의 25건 및 전체 manifest parity는 이 검증 범위가 아님

## 정적·집중 검증

```text
npm ci --no-audit --no-fund
npm run typecheck
npm run build
npm run object-data:validate
node --import tsx --test test/spirit-info.test.ts test/spirit-info-canonical-consumer.test.ts test/spirit-info-canonical-consumer-mariadb.integration.test.ts
```

결과:

- 의존성 동기화 후 추적 파일 추가 변경 0
- typecheck PASS
- build PASS
- object-data validator PASS: 등록 대상 98개
- focused command/ingress/unit: 8/8 PASS
- 기본 실행에서 명시 opt-in Maria suite는 SKIP; 아래 격리 실검증에서 별도 실행

집중 검증 항목:

- exact `/정령정보`만 허용하고 기존 `spirit_info_read` MODERN handler 유지
- 브리지의 `elemental_grade_order`와 canonical definition CUID FK 조인
- canonical item/name/alias identity 조인 부재
- Unicode와 JSON 속성 순서를 포함한 기존 2회 응답 일치
- 신뢰된 이벤트 표시명으로 운영자를 검사하고 profile 표시명 불일치에는 의존하지 않음
- 비운영자 silent 및 service operation/outbox/source-domain DML 0
- 동일 event replay에서 caller actor·payload fingerprint·outbox ID/순서/provider/destination/message type/payload receipt를 먼저 검증하고 operation/outbox 추가 0
- untrusted provenance 및 replay actor/payload/outbox metadata drift fail-close
- 감사 실패 시 operation/outbox 전체 롤백

## MariaDB 격리 실검증

격리 대상:

- container: `hoibot-modernization-mariadb-1`
- schema: `hoibot_rehearsal_spirit_info_2553`
- account: `lease2553_test` (해당 rehearsal schema로 권한 제한)
- migration: `001~477`, 파일 기준 465개 적용
- 운영 JSON/DB/채팅방 미사용

```text
RUN_SPIRIT_INFO_CANONICAL_MARIADB_INTEGRATION=true
node --import tsx --test test/spirit-info-canonical-consumer-mariadb.integration.test.ts
```

결과: `1/1 PASS`

- migration477 적용을 확인
- 브리지 누락 시 DML 전 fail-close
- canonical CUID 브리지 연결 후 legacy와 동일한 두 응답 및 순서 확인
- 성공 commit 뒤 DB client close/open, profile 변경, bridge 제거, definition 비활성 상태에서도 같은 두 outbox/result를 exact replay하고 operation/outbox 증가 0
- 비운영자 silent, service operation/outbox/source-domain DML 증가 0 (전체 DB DML 0 주장이 아님)
- replay payload drift와 caller actor drift fail-close
- persisted outbox provider, destination, message type을 각각 변조하면 `SPIRIT_INFO_REPLAY_OUTBOX_DRIFT`로 fail-close하고 service operation/outbox/source-domain DML 0
- outbox 제약 실패를 실제 savepoint로 강제하여 operation/outbox 롤백 확인
- 외부 fixture transaction을 sentinel rollback하고 시작 전 row count로 복귀 확인
- DB client close/reopen 뒤에도 시작 전 row count 유지 확인

## 제한 및 위험

- 운영 배포, Gate8, feature/prod 반영은 수행하지 않음
- canonical 61행 생성 provider 자체의 migration/rollback 검증은 Lease2554 증거 범위이며 여기서는 소비 경로만 검증
- 명시 opt-in이 없는 일반 focused 실행에서는 Maria suite가 의도적으로 SKIP됨
