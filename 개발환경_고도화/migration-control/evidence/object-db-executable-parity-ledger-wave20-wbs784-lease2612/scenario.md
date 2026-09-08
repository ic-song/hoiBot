# WBS784 / Lease2612 실제 MariaDB 시나리오

격리 DB는 `127.0.0.1:3342/hoibot_wave20_package_import_2612`이고 운영 3306 listener 소유자 집합은 전후 동일합니다. 외부 network/reply 호출은 모든 trace에서 0입니다.

| 시나리오 | PID | 결과 | attempted statements | succeeded rows | committed rows | rolled-back rows |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| MUTATION_SUCCESS | 17164 | COMMIT, replay=false | 26 | 26 | 26 | 0 |
| DOMAIN_FAILURE_ROLLBACK | 24776 | ROLLBACK, `CANONICAL_PACKAGE_ITEM_TARGET_NOT_FOUND` | 13 | 13 | 0 | 13 |
| DUPLICATE_REPLAY_DML_ZERO | seed 11024 / replay 6940 | replay COMMIT | 0 | 0 | 0 | 0 |
| PAYLOAD_DRIFT_FAIL_CLOSED | seed 4116 / primary 27600 | ROLLBACK, `CANONICAL_PACKAGE_REQUEST_PAYLOAD_CONFLICT` | 0 | 0 | 0 | 0 |
| RESTART_REPLAY | seed 3940 / replay 13248 | distinct child PID·module, replay COMMIT | 0 | 0 | 0 | 0 |
| CONCURRENCY_SINGLE_WRITER | writer 22444 / replay 18276 | 정확히 writer 1, replay 1; replay는 deadlock 후 2차 transaction 성공 | writer 26 / replay 0 | 26 / 0 | 26 / 0 | 0 / 0 |

성공 최종 graph는 identities 8, crosswalks 8, definitions 1, imports 1, groups 1, entries 3, item reward 1, nested reward 1, quarantine 1, replay 1입니다. 실패 시나리오는 before/after delta 0입니다. 동시성 두 trace의 최종 graph는 동일하고 nonzero committed writer는 정확히 하나입니다.

repository-local bounded backoff와 최종 read-only replay reconciliation 적용 후 매 실행마다 새 DB를 만든 fresh rehearsal을 5회 연속 통과했습니다.
