# 스케줄 운영자 안내 제거

- 작업 키: schedule-guide
- 상태: 작업 완료
- 체크포인트 버전: 3
- 마지막 갱신: 2026-11-02
- 경로: C:/Users/user/.codex/worktrees/hoiBot-schedule-guide
- 브랜치: feature/schedule-guide
- 기준: feature/prod 26fbc44e/ver_2.764
- 요청: 공개 일일 순위보상 안내에서 오픈채팅봇/MASTER 전용 내용 표시 금지.
- 범위: /스케줄의 일일·영지 순위보상 구획에서 운영자용 지급 명령/권한/일괄 지급 절차 안내 제거. 보상 시간·내용·일반 조회 및 참여 명령 유지. 실제 지급 명령·권한 검사·저장 흐름 불변.
- 참조: 기존 인덱스의 원문 https://app.notion.com/1e1393bdd7aa82f29e7c811bb9deda06 확인, 사용자 지시로 공개 안내에서 운영자 정보를 제거. 원문 본문은 보존.
- 검증: 실제 buildDailyScheduleMessage로 일반/프리미엄×추가 회차 유무4출력 비교. 운영자 안내 두 구획만 제거되고 나머지 시간/보상/일반 명령/전체보기 동일. 지급 권한 함수 원문 동일 확인. Node 구문·버전2.765/개발자노트·diff 검사 통과. 인라인 검증으로 임시/영구 테스트 파일 생성 없음.
- 영속화: source ebb0aaa8965c34349497891f121153cbdf377476 푸시 후 PR https://github.com/ic-song/hoiBot/pull/224 병합. origin/feature/prod=2c64e07ae83b981cc859fe550d72818dc8d7730e/ver_2.765의 검증 소스·버전·개발자노트 일치 확인. 원래 feature/prod ff 갱신, 다른 작업 미추적 체크포인트 보존.
- 알림: PlayMCP 나에게 보내기 정확히 ver_2.765 전송 성공1회. 원문 본문·로컬 스킬 변경 없음.
- 다음 작업: 요청한 공개 안내 정리·검증·Git 운영반영 완료. 실기기 업로드·컴파일은 운영자 담당.
