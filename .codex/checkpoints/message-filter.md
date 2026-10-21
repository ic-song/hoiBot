# 명령어 문구 필터

- 작업 키: message-filter
- 작업 상태: 검증 완료, 소스 정리 중 / 운영 미반영
- 체크포인트 버전: 1
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 사용자 정책: `/필터추가`, `/필터제거`, 쉼표 구분. 기존 관리자·MASTER 관리. 일치 시 무응답 중단. 컴파일 시 캐시 구성, 일반 대화는 비교하지 않음.
- 보류: `/데이터정리` 댓글 삭제. 삭제 코드·실제 데이터 변경 없음.
- 기준: feature/message-filter는 최신 운영 9a86f146ae26a306144af276281d6e80ecea3851/ver_2.667에서 분리. 데이터 스냅샷 갱신 후 구현.
- 구현: Main/Info 초기 캐시와 Java System 환경별 공유 속성, 회원 선택 필드 저장, 저장 성공 후 게시. 명령·단축 입력만 비교. DEV 분리와 백업 시 캐시 갱신.
- 검증: tools/message_filter_validation.md. 신규 Node 12그룹·Rhino 7시나리오 및 기존 회귀 통과. 실제 운영 앱 접근 없음.
- 다음: 소스 브랜치 커밋·푸시와 draft PR 정리. 운영반영 요청 전 prod/버전/노션/카카오 변경 금지.
- 보존: 기존 미반영 공격 응답 변경 PR #138/feature/bugFix, .codex-remote-attachments/, 개발환경_고도화/runtime/.
