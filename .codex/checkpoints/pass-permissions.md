# 패스 관리 MASTER 권한

- 작업 키: pass-permissions
- 상태: 검증 완료
- 체크포인트 버전: 2
- 마지막 갱신: 2026-11-02
- 경로: C:/Users/user/.codex/worktrees/hoiBot-pass-permissions
- 브랜치: feature/pass-permissions
- 기준: feature/prod 186b1ab5/ver_2.762
- 요청: 벨라 여·라면 남을 비롯한 MASTER의 패스 관리 명령 활성화.
- 확인: 로컬 회원 스냅샷에서 두 명 모두 master. 실제 운영 명단은 기존 runtime Master를 사용. 원인은 프리미엄·일반 패스 진입 조건의 호이 남 단독 제한. 기존 isMaster(sender)만 두 곳에 추가, 명단/관리방/저장 로직은 변경하지 않음.
- 참조: https://app.notion.com/3ad393bdd7aa803ebab6dbd1ce46099f / https://app.notion.com/372393bdd7aa801581ceeda70924da49 (모두 LIVE, 본문 보존, 새 페이지 없음).
- 검증: 실제 isMaster/isHoiPassPremiumAdminCommandMessage와 실제 두 진입 조건을 추출해 17명령 × 사용자/관리방/일반방/봇·MASTER 제거·인수 누락 매트릭스258개 통과. Node main.js 구문·diff 검사·버전2.763/개발자노트 일치 통과. 저장·회수 함수 변경 없음. 자체 임시 검증 파일 및 폴더 삭제.
- 다음 작업: source push, 검토 PR 및 운영반영, 원격 검증, 기존 LIVE 기획 속성/카카오 버전 알림. 명단 파일·운영 데이터·실기기 수정 없음.
