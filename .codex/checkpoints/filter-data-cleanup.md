# 필터 데이터 정리 명령

- 작업 키: filter-data-cleanup
- 체크포인트 버전: 4
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 상태: 운영 Git 반영·원격 검증·버전 알림 완료.
- 사용자 요구: 기존 `/데이터정리` 대신 `/필터데이터정리`를 새로 만들어 필터에 일치하는 댓글·피드·일반/펫 타이틀 기록 제거.
- 기준: origin/feature/prod ab1c58f74ec8c03dbe2a28a23d53e6096559f1ff/ver_2.668. feature/filter-data-cleanup 새 분기.
- 구현: 기존 관리자·MASTER 권한, 정확한 명령, 필터 관리 자기 차단 예외. 메모리 목록을 고정해 5개 저장소를 읽고 7종 본문 정리. 장착 번호 보정·해제, 변경 파일만 저장, 스냅샷 원복·DEV 분리, Info 중복 처리 방지.
- 검증: tools/filter_data_cleanup_validation.md. 정리 12그룹·필터 12그룹·Rhino 8시나리오·저장 21그룹·메인방 제한 통과. 실제 데이터 삭제 없음.
- 소스: 구현 f62a9e4e, 버전 포함 소스 0b1ceba65788cf832dd70d54e56a1a9d3c7e9eb3 푸시 후 PR https://github.com/ic-song/hoiBot/pull/142 병합 완료.
- 승인: 사용자가 `/필터데이터정리` 운영반영 요청. 최신 prod ab1c58f7과 소스 동기화 확인, 버전·개발자노트 ver_2.669 준비.
- 운영 근거: origin/feature/prod 2ecc4ec4cbbde98d256e72bd5dcd678a1e40f9f6에 소스 포함, Main/Info/개발자노트 원문 동일·ver_2.669 확인. 병합 후 정리 12그룹 재실행 통과.
- Notion: 확인한 기획 데이터 소스에서 정확한 명령 검색과 관련 제목 속성 조회. 유사 문서는 별도 글자수 정리 LIVE·가입 닉네임 필터 TODO·명령어 목록의 기존 데이터정리로 이번 기능에 해당하지 않아 변경하지 않음. 새 페이지 생성 없음.
- 알림: 원격 검증 후 PlayMCP 나에게 정확히 ver_2.669 한 번 전송 성공. 스킬 변경 없음.
- 다음: 요청 완료. 실제 앱 Main·Info 업로드·컴파일과 `/필터데이터정리` 실행은 운영자 수행. 실제 기록 삭제는 실행하지 않음.
- 보존: 기존 PR #138/feature/bugFix, .codex-remote-attachments/, 개발환경_고도화/runtime/.
