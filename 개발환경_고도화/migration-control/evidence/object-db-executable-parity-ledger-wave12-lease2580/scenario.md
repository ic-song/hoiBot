# Wave12 시나리오

- 정식 DIRECT 5종: `READ_POSITIVE`, `NEGATIVE_GUARD`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`, `RESTART_CONSISTENCY`
- 별도 실제 위험 cohort: 관리자 거부, 잘못된 방, inbox 중복, 동일 event replay, rollback, transient 1213 재시도
- fingerprint drift: environment/message/actor/channel 각각 fail closed
- DEV/PROD 환경은 같은 독립 oracle로 byte-exact 비교한다.
- source-domain DML은 0이며 허용 DML은 ingress/operation/outbox/audit와 `admin_character_count_stat_executions`에 한정한다.
