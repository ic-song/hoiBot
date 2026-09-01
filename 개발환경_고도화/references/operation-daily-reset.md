# SL-OPERATION-DAILY-RESET

- 명령: exact `/리셋`
- 권한: 연결된 활성 관리자 중 표시명이 `오픈채팅봇` 또는 `호이 남`이고 `operation.daily_reset` 권한 보유
- 공용 의존성: `CommonDailyResetProvider`, canonical `ItemProvider`
- 임시 아이템 제거: `자동대깨봇🤖(1일)`, `자동대깨호😝(1일)`, `자동배팅😝🤖(1일)`의 stable item code
- 응답: 현재방 `출첵시작! 리셋 완료`, 설정된 운영방에 출석 시작 공지
- 재실행: provider와 command operation을 각각 idempotent하게 기록하며, provider 완료 후 소비자 단계 실패 시 같은 event 재실행으로 복구
- 배포 경계: command registry는 `SHADOW`; Gate8, feature/prod, 운영 DB, legacy `main.js`/`data` 변경 없음
