# 인형상자 명령 등급 공백 제거

- 작업 키: doll-box-command-spacing
- 작업 상태: 검증 완료
- 정리 후보: 아니요
- 체크포인트 버전: 2
- 마지막 갱신: 2026-10-19 Asia/Seoul
- 목표: 운영 반영한 인형상자의 후속 표기 수정. /인형상자오픈고급 10처럼 명령·등급 사이 공백을 없앤다.
- 승인 범위: 기존 5건 운영 반영의 인형상자 후속 수정. 새 기획서나 인형 데이터 확장은 포함하지 않는다.
- 기획: https://www.notion.so/43f393bdd7aa83fd9d4881c7a51f3243 (기존 DEV, ver_2.659). 본문 수정 없음.
- 저장소: C:/Users/user/Desktop/hoiBot
- 브랜치: feature/bugFix (origin/feature/prod df2652e8에서 신규 생성)
- 파일 범위: main.js, Info.js, COMMAND_INDEX.md, COMMAND_REGISTRY.md, data/hoiBotChangeLog.json, 관련 tools 테스트 및 증거, ERROR_FIX_LOG.md, 이 체크포인트.
- 구현: 10등급 붙인 명령·잠금·아이템 및 결과/오류 안내. 기존 공백 입력 호환. 기존/새 재고 합산과 기존 재고 우선 차감. MAIN/Info 가방은 저장 키/번호 보존하며 붙인 사용법 표시.
- 검증: 전체 JavaScript 66회 모두 통과. 상자20+기존 인형22그룹, MAIN/Info Rhino 전체 컴파일/핵심 실행, 실제 Java 잠금20쌍, 문법·UTF-8·diff·버전 일치 통과. 개발 버전 2.660.
- 증거: tools/test_doll_box_spacing_result.json. 데이터1143개 해시 변화 없음, JSON 파싱 오류0. 실제 Android 단말 실행은 미검증.
- 저장 흐름: 기존 인형 pending/롤백 재사용. 새 IO와 데이터 일괄 이관 없음. DEV/PROD 경로 유지.
- 다음 행동: 검증 소스 커밋·푸시 및 PR 작성 후 운영 후속 반영. 원격 prod 검증 후 기존 노션 날짜/버전과 카카오 알림 확인.
- 보존: 사용자 미추적 .codex-remote-attachments/, 개발환경_고도화/runtime/. 운영 단말 접속/업로드/컴파일 없음.
