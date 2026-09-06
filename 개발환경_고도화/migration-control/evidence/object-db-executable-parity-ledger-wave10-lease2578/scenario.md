# Wave10 시나리오

세 consumer마다 `READ_POSITIVE`, `NEGATIVE_GUARD`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`, `RESTART_CONSISTENCY`를 실행하여 영수증 15개를 만든다.

추가 위험 시나리오는 중간 DML 실패 rollback, 동일 event replay, app inbox duplicate, identity 누락, 비운영 채널, payload/destination drift다.

- 정상: 실제 HTTP ingress 포함 query 7개/evidence DML 14개, source-domain DML 0, processor·service·outbox delivery 각각 `BEGIN→COMMIT`
- 재시작: 독립 child 두 번, 동일 출력, DML 28개, UUIDv4 operation key 두 개가 서로 다름
- `NEGATIVE_GUARD`: 운영 채널의 invalid command가 ingress query 2/DML 6 뒤 종료, service 호출 0, 네 business evidence table 0행
- `APP_INBOX_DUPLICATE`: processor query 3/DML 5 뒤 rollback, service 호출 0, 네 evidence table 전후 각 1행 불변
- `MISSING_IDENTITY`: processor/service read-only 흐름, service 호출 1, 네 evidence table 0행
- `WRONG_OPERATIONAL_CHANNEL`: query/DML 0, service 호출 0, routing/evidence 0행
- rollback: processor commit 뒤 service 중간 DML 오류와 service rollback, 네 evidence table 0행
- 확률: 13종, 합계 정확히 100
