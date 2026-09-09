# WBS790 소비자 Gate6~7 검증

- 실행: 오브젝트DB복구-SL-ITEM-STACK-QUANTITY-MUTATION-PARITY-01-20260909131833 / Lease2622
- 소비자: `sql-repository-87ed81931dd7417b` (`changeStackQuantity`) 1개
- 통합: `e8fa943c`를 보존하고 ACK된 provider `a91c2e34`, `736ca972`를 fast-forward로 수신.
- 판정: **해당 소비자 Gate6~7 기술 검증 PASS, 작업반장 최종 ACK 요청. Gate8 미실행.**

## 소비자 관점 독립 실행

`powershell -NoProfile -ExecutionPolicy Bypass -File 개발환경_고도화/runtime/scripts/rehearse-wbs790-consumer-provider.ps1`

공용 fixture/generator를 다시 작성하지 않고, 공용 Wave24 target을 실제 별도 프로세스로 실행했다. expected 값은 producer observation에서 만들지 않고 합성 수량 3, terminal operation 1, ledger 1, 성공 DML4/replay DML0로 고정했다.

- 격리 전용 DB `127.0.0.1:3358/hoibot_wave24_item_stack_quantity_2622`
- 신규 migration478 및 추가 적용0 재실행, 등록119 테이블 존재 확인
- 성공 수량3·operation completed·owner/item·delta3 대사
- duplicate와 payload drift의 시도 DML0/commit0/상태 동일
- 실제 DB PID `15940 → 29424`; consumer Node `27584 → 5364`; target `13444 → 21852` 재시작 후 exact replay DML0
- 실제 공용 target의 `mode=SHADOW`에서 repository mutation 실행, 영향4행 rollback, commit0, 결과 quantity3/replayed=false
- 독립 raw SQL로 canonical player/definition/stack/operation/ledger/head/ordering 7개 테이블의 모든 행을 전후 대사. Shadow rollback 후 모두 동일.
- 앞선 e8fa943c run2의 terminal-fault rollback·동시 root 진입 barrier 근거 승계. 실제 Shadow는 이번 새 근거로만 판정한다.
- own3358 listener 종료. 3306/3347 listener 관찰값 불변.
- provider의 externalNetworkCalls/replyCalls 필드는 상수이며 동적 계측 증거로 사용하지 않는다. 시험 코드와 호출 repository에 reply/외부 HTTP 진입이 없음을 검토했다. DB TCP는 위 격리 loopback만 사용했다.

## 불변성과 공식 receipt

- `before.json`, `after.json`에 공용 target, fixture, ledger, Wave23/24 receipt raw SHA 기록. 실행 전후 byte 불변 확인.
- Wave23 prefix243의 canonical JSON: 970854 bytes, SHA `e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97`.
- Wave24 공식 receipt249, WBS790 DIRECT_PASS, 전체 DIRECT45/STATIC1006/BLOCKED82, residual1088.
- 위 수치는 공식 원장 검산이며 전체 소비처 Gate7 또는 전체 도메인 이관 완료가 아니다.

## 검증 명령·검토

- `node --import tsx --test test/object-db-consumer-executable-parity-wave24.test.ts test/object-db-consumer-mutation-evidence-wave24.test.ts test/object-db-consumer-residual-work-plan.test.ts`: **9/9 PASS, FAIL/SKIP0**. prefix/fixture tampering 및 residual deterministic rebuild 포함. 약124초, 재반복하지 않음.
- `npm.cmd run typecheck`, `npm.cmd run build`: PASS.
- 독립 읽기 전용 검토: 기존 run2와 이번 소비자 근거를 합쳐 Gate6~7 지지, P0/P1=0. P2 drift attempted-DML assertion 누락은 assertion 추가 및 저장된 raw 결과 재검산(`DRIFT_DML_ASSERTION_PASS`)으로 보완.
- 문서화를 위해 Windows PowerShell이 생성한 transcript를 UTF-8로 직렬화했다. raw JSON 의미와 공유 source/fixture hash는 변경하지 않았다.

## 경계

운영 snapshot/운영 DB/feature/prod/Gate8 변경 없음. 공용 schema/migration/ledger/fixture의 로컬 수정 없음. 이 source branch의 승인 전 전체 운영 전환을 수행하지 않는다.
