# 계삭 후 재가입 퀘스트 기록 충돌 수정

- 작업 키: quest-rejoin-fix
- 작업 상태: 검증 완료
- 정리 후보: 아니요
- 체크포인트 버전: 2
- 마지막 갱신: 2026-11-12 Asia/Seoul
- 최신 요청: 스탯트리 운영 반영/Notion 갱신 작업 중 사용자가 달빛 남 계삭 후 /모험가퀘스트 오류를 보고함. 긴급 원인 확인·최소 수정 후 원래 스탯 운영 반영을 계속한다.
- 위치: C:/Users/user/.codex/worktrees/hoiBot-quest-rejoin-fix, 새 local feature/bugFix, 기준8421e078/ver_2.827.
- Git 보호: origin/feature/bugFix=b45affeb는 기존 미반영 작업이며 local backup/feature-bugFix-unreflected-20261107와 일치한다. 이 원격 브랜치는 변경/삭제하지 않는다. 이번 수정은 local feature/bugFix에서 개발하고 별도 remote feature/quest-rejoin-fix로 공유한다.
- 범위: main.js, ERROR_FIX_LOG.md, COMMAND_INDEX.md, data/hoiBotChangeLog.json, 본 체크포인트. 필요 검증은 사용자 TEMP/hoibot-quest-rejoin-oF6hcd에서만 수행. 운영 데이터/다른 작업 파일 보존.
- 재현: 기존 퀘스트가 분리된 회원 삭제 명령에서 초반에 __adventureRecordContext를 붙이지만 모든 슬래시 입력의 계정정지 검사에서 data=loadJsonFile로 덮어 문맥 소실. 기록은 남고 새 회원으로 /모험가퀘스트 시 실제 attachAdventureRecordStore가 '회원 백업보다 새로운 퀘스트 기록이 있습니다.' 오류를 냄. 실제 함수와 합성 원문으로 재현 확인.
- 확인 대기: 사용자에게 실제 오류 원문/줄번호·봇 버전·재가입/펫 등록 여부를 질문함. 아직 실제 운영 로그/데이터 대사는 안 됨.
- 수정/검증: 기존 기록 정리 문맥을 최종 공통 회원 로드 뒤에 이동. Node/Rhino 각각476 assert(두 명령·공개/개인톡·완료0~16단계·다른회원 보존·권한·손상·백업 보호), 전체 Rhino 컴파일·Node 구문·UTF-8·diff 검사 통과. 기존 저장 순서/복구 로직은 변경하지 않았으며 실패 IO 모의는 이번 변경 범위가 아님. ver_2.828 개발자노트 추가.
- 다음 행동: source를 remote feature/quest-rejoin-fix에 push→prod 반영/원격 확인 후 스탯트리 반영 재개. 원래 remote feature/bugFix는 미반영 사용자 작업이라 보존한다. 기존 재가입 계정의 남은 옛 기록은 안전 근거 없이 자동 삭제하지 않는다.
- 원래 작업: feature/adventurer-stat-tree=2be3f309, source 개발/4751 assert 검증·push 및 draft PR275 완료. 사용자 운영반영 승인됨. 아직 prod/Notion 갱신 전이며 이 수정 후 이어서 완료해야 한다.
- 제한: Android/LDPlayer 연결·업로드·컴파일 금지. 원격 source/prod 반영만 수행하며 노션 본문은 보존한다.
