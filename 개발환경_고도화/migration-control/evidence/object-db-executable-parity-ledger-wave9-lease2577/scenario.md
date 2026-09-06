# Wave9 시나리오

각 consumer에 다음 5개 receipt를 생성한다.

1. `READ_POSITIVE`
2. `NEGATIVE_GUARD`
3. `EXACT_OUTPUT`
4. `SOURCE_DOMAIN_DML_ZERO`
5. `RESTART_CONSISTENCY`

총 25개이며 SQL, params, raw rows, reply/result bytes, BEGIN/COMMIT, lockOrder, 허용 DML을 직접 비교한다.

추가 위험 검증은 consumer별 다음을 수행한다.

- 중간 3번째 DML 강제 실패 후 rollback 및 persisted effect 0
- 같은 event replay의 DML 0
- app outer gate 거부 시 service/reply DML 0
- 동시 같은 event에서 `operations ... FOR UPDATE` 획득·대기 후 1 writer + 1 replay
- 격리 MariaDB(3330)에서 생산 서비스 5개를 직접 호출하고, 첫 transaction의 audit DML을 유지한 동안 두 번째 호출의 실제 `FOR UPDATE`가 PROCESSLIST에 pending인 상태를 관찰한 뒤 operations/outbox/execution/audit 단일 기록을 확인
- 격리 MariaDB에서 중간 audit DML을 trigger로 실패시키고 operations/outbox/execution/audit persisted snapshot 전후가 모두 0인지 직접 비교
- restart는 새 child process 두 개, 안정 결과, 서로 다른 UUIDv4 operation key
- app span, SQL, params, rows, output 및 canonical consumer/harness/target hash drift fail-close
