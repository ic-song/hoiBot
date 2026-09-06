# Wave10 시나리오

세 consumer마다 `READ_POSITIVE`, `NEGATIVE_GUARD`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`, `RESTART_CONSISTENCY`를 실행하여 영수증 15개를 만든다.

추가 위험 시나리오는 중간 DML 실패 rollback, 동일 event replay, app inbox duplicate, identity 누락, 비운영 채널, payload/destination drift다.

- 정상: evidence DML 5개, source-domain DML 0, `BEGIN→COMMIT`
- 재시작: 독립 child 두 번, 동일 출력, UUIDv4 operation key 두 개가 서로 다름
- guard/app 거절: query/DML 0 또는 routing query만 수행하고 reply 없음
- rollback: 세 번째 DML 오류 후 persisted 0
- 확률: 13종, 합계 정확히 100
