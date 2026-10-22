# 글자수 전체 정리 직접 명령 유지

- 작업 키: text-cleanup-direct
- 작업 상태: 작업 완료
- 정리 후보: 예
- 체크포인트 버전: 3
- 마지막 갱신: 2026-10-23 Asia/Seoul
- 사용자 승인: `/글자수전체정리`는 확인 없이 직접 실행하고 `/초기화`의 기존 메뉴 경로도 함께 유지. 후속 사용자 '바로운영반영해줘' 요청으로 운영 Git 반영까지 승인됨.
- 작업 위치: C:/Users/user/.codex/worktrees/text-cleanup-direct/hoiBot, codex/text-cleanup-direct, 운영 기준 fd888bab/ver_2.679.
- 분리 이유: 원래 C:/Users/user/Desktop/hoiBot에는 feature/raid-attack-allocations의 미커밋 수정(main.js, COMMAND_INDEX.md, 레이드 테스트2개)이 있어 보존하고 관리 작업 공간을 별도로 생성함. 해당 변경/미추적 사용자 폴더는 건드리지 않음.
- 구현: isManualResetLegacyCommand에서 정확한 `/글자수전체정리`만 안내 대상에서 제외. 메뉴32항목과 확인 절차는 유지. 기존 직접 정리 분기·권한·정렬·보관 한도·저장 본문·일반 메시지 필터는 그대로 사용. DEV 직접 입력 및 다른 초기화 대기와 격리. 접미사/다른 정리 명령은 기존 안내 유지.
- 변경 파일: main.js, COMMAND_INDEX.md, COMMAND_REGISTRY.md, data/hoiBotChangeLog.json, tools/test_reset_menu.js, tools/test_reset_cleanup_menu.js, tools/test_reset_cleanup_rhino.js, 이 체크포인트.
- 검증: 변경 전 직접 명령이 메뉴로 잡히는 회귀 실패 재현. Node 정리17+초기화22=39그룹 PASS. Rhino Main/Info 전체 컴파일·기존 메뉴 동시확정20쌍·직접 실행·DEV 격리·권한/만료/재시작 시험 PASS. 현재 운영 기준으로 후속 실행 본문 동일 검증. 새 분류로 인해 Rhino 합성 시험에만 필요해진 외부 명령/필터 스텁을 추가함. 게임 스냅샷은 사용·변경하지 않음.
- 버전: 운영 ver_2.680, 개발자노트2026-10-23. origin/feature/prod에서 버전·날짜·검증 소스 전체 일치 확인.
- 소스 저장: 18e780f6aeda39e57f76fd853073f835c42ca0f3 푸시 및 origin/codex/text-cleanup-direct 일치 확인. PR152 https://github.com/ic-song/hoiBot/pull/152 (draft OPEN, base feature/prod) 생성·채팅 첨부. 문법·UTF-8·diff·버전/노트 일치 확인 완료. 원래 작업 폴더의 미커밋 변경 보존.
- 운영 반영: PR152 병합 커밋 f795d2342c39ef2b1d54c95a1fc2293cc5207687을 origin/feature/prod에서 검증. 병합 후 정리17그룹 재통과. PlayMCP로 정확히 ver_2.680 전송 성공.
- 노션 확인: 확정 기획 DB에서 `/글자수전체정리` 검색 후 기능추가 기획393393bd-d7aa-804d-9f8b-e336ce22f6bb와 대전중 사용허용903393bd-d7aa-833f-9349-81d8adfd84e2를 조회. 둘 다 기존 LIVE 문서이며 이번 작업은 READY/HOTFIX 개발 항목에서 시작되지 않아 상태·본문·기존 운영 속성을 보존. 새 페이지 미생성.
- 다음 행동: 승인된 개발·검증·소스 푸시·운영 Git 반영·알림 완료. 런타임 업로드/컴파일은 운영자가 수행. 스킬 파일과 원래 작업 폴더의 다른 미커밋 변경은 미변경. 원격 소스와 앱 관리 작업 공간으로 복구 가능.
