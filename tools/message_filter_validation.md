# 명령어 문구 필터 검증

- 기준: 2026-10-21, feature/message-filter, 운영 기준 9a86f146ae26a306144af276281d6e80ecea3851 / ver_2.667.
- 요구: 쉼표로 복수 문구 관리, 기존 관리자·MASTER 권한, 일치 시 무응답 중단, 컴파일 초기 캐시, 일반 대화 비교 제외. 댓글 삭제는 보류.
- 일반 명령 필터는 메모리만 조회한다. 관리 변경은 회원 저장 성공 후 Main·Info 캐시에 반영한다. DEV/PROD 분리, DEV 백업 시 캐시 갱신, 재컴파일 시 저장 목록 복원.
- 저장/복구 내부 함수는 기존 구현을 유지한다. 저장 실패 시 기존 파일·캐시 유지, 응답 실패 시 확정된 목록 유지. 실제 분리 회원 저장에서도 레이드·로그 데이터와 세대 표식이 유지된다.

## 실행 결과

- `node tools/test_message_filter.js`: 12그룹 통과. 실제 콜백 무응답/무저장, 권한, CSV/빈 인자/접두 충돌, 중복, 저장·응답 실패, 복원, DEV 분리/손상, 리터럴/이모지, Main·Info 동기화, 분리 저장 검증.
- `node tools/test_message_filter_rhino.js <Rhino 1.7.15 jar>`: 7개 시나리오 통과. 전체 소스 컴파일, 실제 Java 공유 속성/별도 Rhino 전역, 각 1,000회 검사 중 파일 읽기 0회, 일반 대화 비교 0회, 재초기화/DEV 백업/손상 값 검증.
- 기존 회귀: server_raid 130, member_storage_split 55, server_raid_oct12 11, server_raid_delivery 18, carrot_confirmation 16, doll_boxes 42, minipet_admin_add 11, storage_io_reuse 21, doll_test_room 9그룹 및 main_test_room_only 통과.
- 기존 Rhino 회귀: carrot_confirmation 전체 컴파일·실제 Java 잠금 20쌍·만료, server_raid_delivery 공지/재시작/동시성 9개 시나리오 통과.
- Main/Info 문법, 변경 파일 엄격한 UTF-8 및 diff 공백 검사 통과. 운영 데이터 스냅샷 및 기존 `/데이터정리` 처리 본문 무변경.

## 적용 조건과 범위

- Main과 Info를 함께 업데이트한다. 관리 명령은 즉시 공유되며 파일 수동 수정은 Main 재컴파일이 필요하다.
- 실제 Android MessengerBot 앱에서는 실행하지 않았다. 개발 PC의 Node 합성 데이터와 Rhino/Java 임시 파일로 검증했다.
- 운영반영 전 상태이며 버전·개발자노트·Notion은 변경하지 않았다. 필터 초기값은 비어 있고 과거 댓글이나 기존 게임 데이터는 삭제하지 않는다.
