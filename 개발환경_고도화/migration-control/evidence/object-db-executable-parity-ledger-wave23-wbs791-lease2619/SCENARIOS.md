# Wave23 시나리오 계약

세 소비자 각각 아래 6개 시나리오를 동일한 generic harness로 검증합니다.

1. `MUTATION_SUCCESS`
2. `DOMAIN_FAILURE_ROLLBACK`
3. `DUPLICATE_REPLAY_DML_ZERO`
4. `PAYLOAD_DRIFT_FAIL_CLOSED`
5. `RESTART_REPLAY`
6. `CONCURRENCY_SINGLE_WRITER`

재시작은 서로 다른 Node child PID와 module execution ID를 요구합니다. 동시성은 정확히 한 writer만 commit하고 나머지 호출은 committed replay DML0이어야 합니다. locator는 원본 복합키의 DB projection으로 검증합니다.
