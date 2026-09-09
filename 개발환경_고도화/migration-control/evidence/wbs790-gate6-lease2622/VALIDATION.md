# WBS790 Lease2622 Gate6 복구 검증

- 실행 ID: 오브젝트DB복구-SL-ITEM-STACK-QUANTITY-MUTATION-PARITY-01-20260909131833
- 기준: `0c3474e2abf0f3c7f53ee716db431a6b3eaece39`
- 브랜치: `codex/object-db-wbs790-gate6-v1-20260909`
- 소비처: `sql-repository-87ed81931dd7417b`, `CanonicalItemInventoryRepository.changeStackQuantity`
- 결과: **Gate6 실제 대사 보조 근거 PASS. 공식 receipt 연결 전 Gate6/7 승격 보류.**

## 실행과 근거

`powershell -NoProfile -ExecutionPolicy Bypass -File 개발환경_고도화/runtime/scripts/rehearse-wbs790-lease2622.ps1`

run2가 독립 검토 보정 후 현재 근거다. 상위 디렉터리 최초 실행 파일은 역사로 보존한다. 최초 출력의 SHADOW_PASS는 실제 Shadow 소비처 검증이 아니므로 Gate7 evidence로 사용하지 않는다.

- 새 Windows MariaDB 12.2, loopback 3358, 전용 합성 DB: migration 478개 적용 및 재실행 추가 적용 0.
- 현행 manifest 등록 테이블 119개 존재 확인. 이 확인은 모든 테이블의 데이터 이관 완료를 뜻하지 않는다.
- 성공: 기존 수량 2 + 3 = 5, absent stack 7. 독립 SQL이 operation terminal, delta, owner/item FK, stack quantity, migration490 ordering/head를 대사.
- exact replay 및 item/delta/reason drift: 실제 repository 호출, execute 계측 0, 관련 8개 테이블 전체 행/감사값 동일.
- 수량 부족: DML 0, 상태 동일.
- 중간 실패: terminal operation UPDATE 직전 오류를 주입하여 stack/operation/ledger/head/ordering 전체 rollback 확인.
- 경합: 두 root transaction 진입 barrier 후 동일 key 실행. 재시도 포함 실제 barrier 진입 3회, 적용 1 + replay 1, terminal ledger 1.
- DB PID `23632 → 29460`, Node PID `19388 → 22060`. DB·프로세스 재시작 뒤 exact replay 0-write 및 전체 상태 동일.
- 읽기 전용 snapshot smoke: 기존 DB read-only capability에서 수량과 전체 상태를 조회. **실제 Shadow consumer 실행 아님. Gate7 미완료.**
- 3306/3347 listener 불변, 자체 3358 listener 종료 확인.
- Wave23 receipt 243개 파일 raw SHA-256 `c29a44052b2f33071a303bf647b69ca0911aeb265fc556ce9c53a00afc59ae91` 전후 동일. 공용 ledger 변경 없음.

## 추가 검증

- `node --import tsx --test test/canonical-item-inventory-repository.test.ts test/app-wiring-mutation-reply.test.ts test/migration-sql-batches.test.ts`: 48 PASS, 0 FAIL/SKIP.
- `npm.cmd run object-data:validate`: 등록119 PASS.
- `npm.cmd run typecheck`, `npm.cmd run build`: PASS.
- 독립 읽기 전용 검토: 최초 Shadow 근거 부족 P1, rollback 시점·동시성 근거 P2를 반영. 보조 근거 범위 재검토 P0/P1/P2=0.

## 공용 변경 요청

현재 Wave23 shared fixture/generator는 3개 소비처, 18개 scenario와 이전225+18=243 receipt로 고정되어 WBS790을 의도적으로 제외한다. 이를 복제·직접 수정하지 않는다.

공용 provider가 다음을 직렬 담당해야 한다.
1. 기존243 prefix를 그대로 유지하며 WBS790 6개 필수 mutation scenario를 공식 receipt 형태로 봉인한다.
2. source span, 독립 expected/actual, transaction/lock/DML trace, restart provenance를 공용 validator와 연결한다. 본 보조 JSON을 공식 receipt라고 취급하지 않는다.
3. shared ledger/residual plan 갱신 후 소비자 담당자가 parity/restart와 실제 Shadow 진입 경로를 검증한다.

Gate1~5를 보존하고 Gate6~8은 FALSE로 유지한다. 운영 DB·운영 snapshot·feature/prod는 변경하지 않았다.
