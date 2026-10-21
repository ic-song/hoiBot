# 필터 목록 조회

- 작업 키: filter-list
- 체크포인트 버전: 3
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 상태: 운영반영 승인, 최신 운영 기준 재검증 및 반영 진행 중.
- 요구: `/필터리스트`로 등록 목록 조회, 추가·제거의 구분자 동작 확인.
- 기준: origin/feature/prod 361ed98df71ebfb25593d9bf35c9783ecec0e2d5/ver_2.669. feature/filter-list 분리.
- 구현: Main 정확한 명령, 기존 관리자·MASTER 권한, 메모리 목록 번호·개수·빈 목록 안내. Info 중복 처리 방지. 파일 IO·저장 없음. 추가·제거 구문 변경 없음.
- 검증: 필터 15그룹·정리 12그룹·Rhino 8시나리오, 전체 컴파일·문법·UTF-8·diff 검사 통과. 구분자는 쉼표, 내부 공백 보존, 완전 일치 제거 확인.
- 소스: 5b0b409a4394b0cb6769ed3806317558c3f9c646 푸시. draft PR https://github.com/ic-song/hoiBot/pull/143 생성. 원격 prod 361ed98d/ver_2.669 무변경 확인.
- 승인: 사용자가 `/필터리스트` 운영반영 요청. 최신 운영 361ed98d 동기화, 버전·개발자노트 ver_2.670 준비.
- 다음: 관련 기획 확인 → 재검증·소스 푸시 → PR #143 병합·원격 검증 → 버전 알림. 실제 Main·Info 업로드·컴파일은 운영자 수행.
- 보존: 기존 미반영 PR #138/feature/bugFix, .codex-remote-attachments/, 개발환경_고도화/runtime/.
