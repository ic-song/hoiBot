# Wave22 시나리오

1. MUTATION_SUCCESS: owned 1 + replay 1, committed DML 2
2. DOMAIN_FAILURE_ROLLBACK: replay PK 충돌 8회 소진, 중간 owned 1행 rollback
3. DUPLICATE_REPLAY_DML_ZERO: terminal replay, DML 0
4. PAYLOAD_DRIFT_FAIL_CLOSED: payload 불일치 rollback, DML 0
5. RESTART_REPLAY: 별도 PID/module에서 replay, DML 0
6. CONCURRENCY_SINGLE_WRITER: writer 1개, zero-DML replay 1개

모든 trace는 시도별 Maria code/errno/errorKind/constraint, 시도별 lock order, 실제 RAW 복합 locator 8필드와 locatorOK, 두 쓰기 테이블 exact rows와 SHA-256을 포함한다.

