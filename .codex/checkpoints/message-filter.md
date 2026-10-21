# 명령어 문구 필터

- 작업 키: message-filter
- 작업 상태: 운영반영 승인, 최신 운영 재검증·반영 진행 중
- 체크포인트 버전: 3
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 사용자 정책: `/필터추가`, `/필터제거`, 쉼표 구분. 기존 관리자·MASTER 관리. 일치 시 무응답 중단. 컴파일 시 캐시 구성, 일반 대화는 비교하지 않음.
- 보류: `/데이터정리` 댓글 삭제. 삭제 코드·실제 데이터 변경 없음.
- 기준: feature/message-filter는 최신 운영 9a86f146ae26a306144af276281d6e80ecea3851/ver_2.667에서 분리. 데이터 스냅샷 갱신 후 구현.
- 구현: Main/Info 초기 캐시와 Java System 환경별 공유 속성, 회원 선택 필드 저장, 저장 성공 후 게시. 명령·단축 입력만 비교. DEV 분리와 백업 시 캐시 갱신.
- 검증: tools/message_filter_validation.md. 신규 Node 12그룹·Rhino 7시나리오 및 기존 회귀 통과. 실제 운영 앱 접근 없음.
- 소스: e9d4e246, feature/message-filter 푸시 완료. draft PR https://github.com/ic-song/hoiBot/pull/141 (base feature/prod).
- 승인: 사용자가 필터 기능 운영반영을 요청. 최신 운영 9a86f146 동기화 확인, 버전·개발자노트 ver_2.668 갱신.
- 다음: 관련 기획 검색·재검증 후 소스 푸시 → PR #141 병합 → 원격 검증 → 정확한 버전 알림. 실제 앱 업로드·컴파일은 운영자 수행.
- 보존: 기존 미반영 공격 응답 변경 PR #138/feature/bugFix, .codex-remote-attachments/, 개발환경_고도화/runtime/.
