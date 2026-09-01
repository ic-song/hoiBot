# 길드 해산·삭제 고도화

`/길드삭제`, `/길드해산`, `/길드해지`를 하나의 관리자 전용 소비자로 통합한다.

- 길드명은 입력용이며, 정리 작업은 잠긴 `guilds.id`로만 수행한다.
- `guilds` 행과 과거 ledger/event는 삭제하지 않고 `disbanded` tombstone으로 보존한다.
- 현재 `guild_members`, `guild_name_registry`, 대기 가입, 활성 영지·균열·성주 projection만 원자 정리한다.
- `operations`, `guild_disband_runs`, `command_executions`, `command_audit`, `outbox_messages`를 같은 transaction에 기록한다.
- 동일 event 재실행은 저장 결과를 반환하고, 실패 시 모든 변경을 rollback한다.
- Gate8, 운영 DB, `feature/prod`, legacy `main.js/data`는 이 슬라이스 범위가 아니다.
