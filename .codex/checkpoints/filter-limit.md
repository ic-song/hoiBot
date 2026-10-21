# 필터 등록 300개 상한

- 작업 키: filter-limit
- 체크포인트 버전: 2
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 상태: 운영반영 승인, 최신 운영 기준 재검증·반영 진행 중.
- 요구: 필터 등록 수 300개 제한.
- 기준: origin/feature/prod e7b0b1b047441582a9f2c6bc6ffa3544ce2f11fb/ver_2.670. feature/filter-limit 분기.
- 구현: Main 설정 maxWords 300, 순수 변경 함수에서 실제 신규 추가가 초과하면 전체 거절, 진입부에서 저장/캐시 게시 전 종료. 제거/중복·기존 초과 데이터 보존. DEV/PROD 독립.
- 검증: 필터 19그룹·정리 12그룹·Rhino 9시나리오. 299→300 허용·299→301 전체 무저장·300개 중복·제거 후 추가·기존 초과 목록·DEV 격리·파일/캐시 보존 확인. 문법·UTF-8·diff 통과.
- 소스: 구현 3ffd55e5fd7846100205222e641adf65dbb77ef2, PR https://github.com/ic-song/hoiBot/pull/144.
- 승인: 사용자가 즉시 운영반영 요청. 최신 운영 e7b0b1b0 동기화 확인, 버전·개발자노트 ver_2.671 준비.
- 다음: 관련 기획 확인·재검증 후 소스 푸시 → PR #144 병합·원격 검증 → 버전 알림. 실제 앱 접근·데이터 삭제 없음.
- 보존: 기존 미반영 PR #138/feature/bugFix, .codex-remote-attachments/, 개발환경_고도화/runtime/.
