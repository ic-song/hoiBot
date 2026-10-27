# 필터 목록 조회

- 작업 키: filter-list
- 체크포인트 버전: 4
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 상태: 운영 Git 반영·원격 검증·버전 알림 완료.
- 요구: `/필터리스트`로 등록 목록 조회, 추가·제거의 구분자 동작 확인.
- 기준: origin/feature/prod 361ed98df71ebfb25593d9bf35c9783ecec0e2d5/ver_2.669. feature/filter-list 분리.
- 구현: Main 정확한 명령, 기존 관리자·MASTER 권한, 메모리 목록 번호·개수·빈 목록 안내. Info 중복 처리 방지. 파일 IO·저장 없음. 추가·제거 구문 변경 없음.
- 검증: 필터 15그룹·정리 12그룹·Rhino 8시나리오, 전체 컴파일·문법·UTF-8·diff 검사 통과. 구분자는 쉼표, 내부 공백 보존, 완전 일치 제거 확인.
- 소스: 구현 5b0b409a, 버전 포함 소스 1b8cfa506f9f4ffe80734cce633a8f9553d44db2 푸시 후 PR https://github.com/ic-song/hoiBot/pull/143 병합 완료.
- 승인: 사용자가 `/필터리스트` 운영반영 요청. 최신 운영 361ed98d 동기화, 버전·개발자노트 ver_2.670 준비.
- 운영 근거: origin/feature/prod 6194d6b09d7ee6cfdd86412aa54be5d4faf65f27에 소스 포함, Main/Info/개발자노트 동일·ver_2.670 확인. 병합 후 필터 15그룹 재실행 통과.
- Notion: 확인한 기획 데이터 소스에서 정확한 명령 검색·관련 제목 속성 조회. 기존 가입 닉네임 필터 TODO는 별도 기획으로 이번 목록 조회와 다르므로 변경하지 않음. 새 페이지 생성 없음.
- 알림: 원격 검증 후 PlayMCP 나에게 정확히 ver_2.670 한 번 전송 성공. 스킬 변경 없음.
- 다음: 요청 완료. 실제 Main·Info 업로드·컴파일은 운영자 수행. 운영 게임 데이터 변경 없음.
- 보존: 기존 미반영 PR #138/feature/bugFix, .codex-remote-attachments/, 개발환경_고도화/runtime/.
