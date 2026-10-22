# 글자수 전체 정리 직접 명령 유지

- 작업 키: text-cleanup-direct
- 작업 상태: 검증 완료
- 정리 후보: 아니요
- 체크포인트 버전: 1
- 마지막 갱신: 2026-10-23 Asia/Seoul
- 사용자 승인: `/글자수전체정리`는 확인 없이 직접 실행하고 `/초기화`의 기존 메뉴 경로도 함께 유지. 개발 요청이며 이번 변경의 운영 반영 요청은 없음.
- 작업 위치: C:/Users/user/.codex/worktrees/text-cleanup-direct/hoiBot, codex/text-cleanup-direct, 운영 기준 fd888bab/ver_2.679.
- 분리 이유: 원래 C:/Users/user/Desktop/hoiBot에는 feature/raid-attack-allocations의 미커밋 수정(main.js, COMMAND_INDEX.md, 레이드 테스트2개)이 있어 보존하고 관리 작업 공간을 별도로 생성함. 해당 변경/미추적 사용자 폴더는 건드리지 않음.
- 구현: isManualResetLegacyCommand에서 정확한 `/글자수전체정리`만 안내 대상에서 제외. 메뉴32항목과 확인 절차는 유지. 기존 직접 정리 분기·권한·정렬·보관 한도·저장 본문·일반 메시지 필터는 그대로 사용. DEV 직접 입력 및 다른 초기화 대기와 격리. 접미사/다른 정리 명령은 기존 안내 유지.
- 변경 파일: main.js, COMMAND_INDEX.md, COMMAND_REGISTRY.md, data/hoiBotChangeLog.json, tools/test_reset_menu.js, tools/test_reset_cleanup_menu.js, tools/test_reset_cleanup_rhino.js, 이 체크포인트.
- 검증: 변경 전 직접 명령이 메뉴로 잡히는 회귀 실패 재현. Node 정리17+초기화22=39그룹 PASS. Rhino Main/Info 전체 컴파일·기존 메뉴 동시확정20쌍·직접 실행·DEV 격리·권한/만료/재시작 시험 PASS. 현재 운영 기준으로 후속 실행 본문 동일 검증. 새 분류로 인해 Rhino 합성 시험에만 필요해진 외부 명령/필터 스텁을 추가함. 게임 스냅샷은 사용·변경하지 않음.
- 버전: 개발2.680/노트2026-10-23 준비. 운영2.679 유지. 버전/노트 반영일은 운영 반영 시 재확인 필요.
- 다음 행동: 마지막 테스트·문법/UTF-8/diff 확인 후 소스 푸시·검토 PR 준비. 운영 반영 시 최신 origin/feature/prod 및 다른 작업의 버전 충돌을 재확인. 런타임 업로드/컴파일 미접근.
