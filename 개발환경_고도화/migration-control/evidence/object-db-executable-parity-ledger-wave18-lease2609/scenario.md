# WBS781 Wave18 시나리오

4개 READ consumer 각각 `READ_POSITIVE`, `NEGATIVE_GUARD`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`, `RESTART_CONSISTENCY`를 실행한다.

- 가방 compare: 정상 경로 10 SELECT, 전체 frozen 결과의 기대 SHA-256 고정
- pet evaluate: 서비스가 read-only snapshot을 정확히 1회 소유
- pet evaluateInSnapshot: 전달받은 participant를 직접 사용하며 snapshot 생성 0회
- readiness inspect: `verifyStartupDatabaseIdentity`가 발급한 frozen DEV 컨텍스트와 `DATABASE()` 일치 확인
- 공통: reply `NO_REPLY`, DML 0, restart는 서로 다른 Node PID와 module execution ID, 결과·query trace 동일
