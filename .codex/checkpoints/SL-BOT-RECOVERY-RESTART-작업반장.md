# SL-BOT-RECOVERY-RESTART 체크포인트

- 실행 ID: `작업반장-SL-BOT-RECOVERY-RESTART-20260901T042736`
- 브랜치: `codex/modernization-bot-recovery-set-v2438-20260901`
- 기준 커밋: `3885b3022ee8b79a6784dfa8861a7f4f87867ca8`
- WBS: 545
- 현재 Gate: Gate1~2 TRUE, Gate3~8 FALSE
- 구현: `/봇살리기` exact consumer, 동일 backup1 세대 필수 3개·선택 1개 사전검증, 원자 복구, snapshot·audit·outbox·idempotency
- migration: `421_bot_recovery_set.sql`
- 통과: focused 2/2, typecheck PASS, build PASS
- 중단: 잘못 넓게 실행된 전체 단위 테스트는 신규 focused 통과 확인 후 안전 중단
- 잔여: fresh MariaDB migration421, rollback/replay/reconnect/restart/Shadow, 전체 회귀, 최종 커밋·푸시, WBS·VAL·Lease·REPORT Gate1~7 마감
- 금지 범위 보존: Gate8, feature/prod, 운영 DB, legacy main.js/data 변경 없음
