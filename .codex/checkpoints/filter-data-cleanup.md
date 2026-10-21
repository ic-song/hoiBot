# 필터 데이터 정리 명령

- 작업 키: filter-data-cleanup
- 체크포인트 버전: 2
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 상태: 구현·검증·소스 푸시 완료. 운영 미반영.
- 사용자 요구: 기존 `/데이터정리` 대신 `/필터데이터정리`를 새로 만들어 필터에 일치하는 댓글·피드·일반/펫 타이틀 기록 제거.
- 기준: origin/feature/prod ab1c58f74ec8c03dbe2a28a23d53e6096559f1ff/ver_2.668. feature/filter-data-cleanup 새 분기.
- 구현: 기존 관리자·MASTER 권한, 정확한 명령, 필터 관리 자기 차단 예외. 메모리 목록을 고정해 5개 저장소를 읽고 7종 본문 정리. 장착 번호 보정·해제, 변경 파일만 저장, 스냅샷 원복·DEV 분리, Info 중복 처리 방지.
- 검증: tools/filter_data_cleanup_validation.md. 정리 12그룹·필터 12그룹·Rhino 8시나리오·저장 21그룹·메인방 제한 통과. 실제 데이터 삭제 없음.
- 소스: f62a9e4ecb646fd3f9e0cc71af973e54fd38e52c 푸시, draft PR https://github.com/ic-song/hoiBot/pull/142 생성. 원격 prod는 ab1c58f7/ver_2.668 그대로임을 확인.
- 다음: 사용자에게 구현·검증 결과 보고. 신규 기능 운영반영 요청 전 prod/버전/노션/카카오 변경 없음.
- 보존: 기존 PR #138/feature/bugFix, .codex-remote-attachments/, 개발환경_고도화/runtime/.
