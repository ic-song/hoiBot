# 모험가 스탯트리 개발

- 작업 키: adventurer-stat-tree
- 작업 상태: 작업 완료
- 정리 후보: 아니요
- 체크포인트 버전: 4
- 마지막 갱신: 2026-11-12 Asia/Seoul
- 목표/승인: READY https://app.notion.com/8f4393bdd7aa8358aa37813f893eb9ed 레거시 스탯트리 개발·검증. 기존 유저의 도입 현재 레벨-1점을 최초 1회, 이후 실제 레벨업당 1점. 교육·평수 효과 수정과 운영 반영은 이번 범위가 아니다.
- 위치: C:/Users/user/.codex/worktrees/hoiBot-adventurer-stat-tree, feature/adventurer-stat-tree. prod 기준8421e078/ver_2.827.
- 선언 범위: main.js, Info.js, COMMAND_INDEX.md, COMMAND_REGISTRY.md, 본 체크포인트. 데이터 스냅샷·다른 작업 체크포인트 보존.
- 현재 확인: 기획 READY/예정26.11.12 재확인, 원문 최종수정2026-11-11T10:26:12.580Z. 300행 표·비용·보상 검산 완료. 초기 잔고 부재는 사용자의 소급 정책으로 해결. 기존 모험가 게시·복구 저장 흐름 재사용 예정.
- 저장 계획: 조회 시 저장하지 않고 미참여자의 레벨-1점을 계산해 보여준다. 최초 레벨 변화 전에 잔고를 확정하고 실제 레벨업분을 더하며, 운영자 레벨 설정/초기화에서도 기존 초기 잔고를 먼저 보존한다. 개인 상태는 잔고1+세 분야 완료/진행6값만 관리한다.
- 임시 검증 공간: 사용자 TEMP의 hoibot-stat-tree-YqFCSe 삭제 완료. 영구 테스트/검증 파일 추가 없음. PR 본문 임시 파일도 삭제 완료.
- 구현: Main 스탯 조회·아이템·1/2 확인·부분/완료 투자·300단계/호칭/축하, 레벨업1점·초기잔고 보존·새 레벨업UI, Main/Info 전투·레벨·진단 보너스 연결. 기존 모험가 게시/복구 단위를 재사용하고 교육/평수 로직은 유지. 명령 인덱스/등록부 동기화.
- 검증 중간: 실제 추출 함수·입력 분기·게시/복구를 Node와 Rhino1.7.15에서 각각4133 assert 통과. 300단계 완성/부분투자·15150점·2290강·UI 원문·환경/방/계정·중복/만료·저장4단계 중단과 복구·실제 Main/Info 계산 대조. 두 전체 source Rhino compileString 통과. 저수준 저장/Android API는 모의이며 실제 runtime 미검증.
- 최종 검증: Node/Rhino에서 실제 함수와 명령·확인 전처리·게시 복구를 각각4751 assert 통과. 300개 단계/15150점/2290강·정확 UI·레벨업1점·안전 정수·중복/환경/방/계정·운영자 반복 초기화·저장4단계 실패·Main/Info 독립 계산 대조. 두 전체소스 Rhino compileString, node --check, UTF-8, git diff --check 통과. 7인자 callback 유지, 새 저수준 IO helper 없음. 전체100단계 상세는4283~5227자이며 카카오 실제 출력 제한/Android callback·파일 IO는 미검증.
- Git 완료: ed080d5af017b65f9e1e4febf3e91c5a82323b6c 개발 커밋이 origin/feature/adventurer-stat-tree와 일치함을 확인. https://github.com/ic-song/hoiBot/pull/275 초안 PR 생성. 본 최종 기록도 같은 source 브랜치에 추가 commit/push한다.
- 다음 행동: 이번 개발 요청의 필수 작업 없음. 운영 반영 요청 시 최신 prod 재대조·개발자노트/버전 추가·source push→prod 원격 검증→Notion DEV/일자/버전을 진행한다. prod/ver_2.827·Notion READY 유지.
- 제한: Android/LDPlayer 연결·업로드·컴파일 없음. HW 개발은 이 채팅에서 하지 않는다. source만 push했으며 prod 반영·Notion 본문/상태/일자/버전 변경·Kakao 알림 없음. 정리 후보는 운영 반영 인계가 남아 아니요로 보존.
