# Wave24 시나리오 계약

WBS790 소비자에 아래 6개 공식 mutation 시나리오를 연결합니다.

1. `MUTATION_SUCCESS`
2. `DOMAIN_FAILURE_ROLLBACK`
3. `DUPLICATE_REPLAY_DML_ZERO`
4. `PAYLOAD_DRIFT_FAIL_CLOSED`
5. `RESTART_REPLAY`
6. `CONCURRENCY_SINGLE_WRITER`

성공 writer는 operations, owned stack, ledger entry를 한 트랜잭션에서 4 affected rows로 완료합니다. 재시작은 서로 다른 Node child PID와 module execution ID를 요구하고, 동시성은 정확히 한 writer만 commit해야 합니다. 재생은 committed DML0, drift와 주입 실패는 rollback을 요구합니다. Shadow는 실제 메서드 결과를 얻은 뒤 강제 rollback하며 전후 DB 해시 동일, 외부 네트워크와 reply 0을 요구합니다.
