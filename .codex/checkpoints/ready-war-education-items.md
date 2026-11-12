# 노션 길드전쟁 버그·교육·길드 아이템 순차 반영

- 작업 키: ready-war-education-items
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 6
- 마지막 갱신: 2026-11-12 Asia/Seoul
- 목표/승인: 사용자 지정 순서 ①길드전쟁 공격권·개인 선포 락 ②교육2·8번 ③길드창고·전투 아이템 기부/사용처를 각각 상세 검토→개발→기획 재대조→정상/예외 테스트→source push→prod 원격 확인→Notion DEV/일자/버전까지 완료한다. 각 페이지 본문은 수정하지 않는다.
- 대상: 177393bdd7aa8374bc6a816af5a3b775, 611393bdd7aa82e48fa7012c04628da8, 9c1393bdd7aa83f28a280166edbaff02. 모두 READY 속성/DB 스키마 확인. 기획 수정일은 각각2026-11-12T09:18:35.212Z,2026-11-06T16:00:13.423Z,2026-11-12T09:31:08.216Z.
- 위치/기준: C:/Users/user/.codex/worktrees/hoiBot-war-ticket-lock-fix, fresh local feature/bugFix from feature/prod89f01e42/ver_2.829. 원래 remote feature/bugFix=b45affeb 미반영 사용자 작업은 보존하고 이번 source는 별도 remote feature/war-ticket-lock-fix로 공유한다.
- 범위: main.js, Info.js(필요 시), COMMAND_INDEX.md, COMMAND_REGISTRY.md(명령 계약 변경 시), ERROR_FIX_LOG.md, data/hoiBotChangeLog.json, 본 체크포인트. 운영 스냅샷·타 작업 파일 보존. 검증 자료는 TEMP/hoibot-war-ticket-lock 전용 폴더에 두고 각 검증 완료 후 삭제.
- 1번 의도: 개인 기본권 소진·추가권 있음이면 기존 유자격자만 추가권을 직접 소비한다. 기본권/개인 사용량 불변, 무권한 우회 금지. 지휘관 현재 길마1회 및 역할권 합산 유지. 계정 ID별 사용 이력과 UI 공용잔액 대조.
- 1번 구현: 개인권 소진이면 기본권과 개인 사용량을 유지하고 추가권만 직접 소비. 일반 개인권 잔여는 기존 기본권 우선 및 기본0일 때 추가권+개인권 소비 유지. 신규 선포는 고유 계정 ID로 이력, 구 이름별 이력은 ID 연결해 보존. 추가권 전후잔액/소비종류·개인권 소비여부를 전쟁에 기록. 양쪽 추가권 환급·일일/관리자 초기화·편성 개인 합계·가이드/충전/선포 메시지 연결.
- 1번 검증: 현재 Rhino726 assert 통과(정책조합/고유ID/닉변/편성/500회 큰 정수/마지막1개 경쟁/공개 명령/초기화 환급/무혈/게시 준비·회원·길드·완료표식 오류). 저수준 IO·환경 API 일부 모의, 실제 runtime/실제 제보자의 데이터 귀속은 미확인.
- 다음 행동: 1번 기획18QA 재대조·Rhino726/Node724·전체 Rhino 컴파일·Node 구문·diff 검사 통과. ver_2.830 source push→prod 검증→Notion 갱신 뒤 2·3번 순차 진행. 정산 snapshot/restore는 entry 전체 직렬화로 신규 이력도 보존한다.
- 제한: Android/LDPlayer 접근·업로드·컴파일 금지. HW 개발·원격 runtime QA는 하지 않는다. 실제 운영 로그가 없으면 제보 개인/길드의 잘못된 귀속을 확정하지 않는다.

- 1번 완료: 64f12ff2를 source feature/war-ticket-lock-fix에 먼저 push하고 origin/feature/prod 동일 SHA와 ver_2.830 확인. Notion DEV/2026-11-12/ver_2.830 DB 확인. PlayMCP 부재로 알림 생략. gh 미인증으로 PR 생성은 불가했으며 Git 반영은 완료. 원래 remote bugFix 미반영 작업은 보존.
- 2번 진행: source feature/education-stat-home, 노션 최종 문구2·8번과 기존10챕터/수료 정책 보존. 선행 평수 기획580393bdd7aa829ba4f801ff1d83df75와 달리 적용되던 빌리지·인테리어 배율을 Main/Info·정보/확장/진단에서 제외. 기존 최종 배율·재료/주택 저장 유지. Rhino3229 assert 통과. Android 실제 조회는 운영자 영역.

- 2번 완료: 28411584 source feature/education-stat-home push 후 origin/feature/prod 동일 SHA/ver_2.831 확인. Notion DEV/2026-11-12/ver_2.831 확인. Rhino/Node3229·전체 Main/Info 컴파일·구문·UTF-8·diff 통과. 전용 TEMP 삭제.
- 3번 진행: feature/guild-combat-item-donation. 네 이름 호환·현행 자료 읽기 전환, 창고 조회/기부·개당 보상·접수 영수증·고유 계정, 전쟁/영지 창고 발동 차감·펫무쌍 개인 유지, 원천 길드 환급/이전 대진 snapshot 보호. 기획23항목 대조. 현재 Rhino472 assert 및 실제6종 로컬 스냅샷 변환 통과. 기존 saveJsonFile·펫무쌍 판정은 이름 외 동일. 낮은 IO·환경 API는 모의이며 실제 Android는 미검증.
- 3번 중복 한계: MQ 동일 접수/선택적 기존 이벤트ID·응답 실패 재처리는 멱등. 기본7인수는 별도 중복 콜백과 사용자가 보낸 새 동일 문구를 구별할 ID가 없어 시간 제한을 만들지 않는다. 사용자에게 한계 설명 완료.
- 다음: 최신 source 전체 컴파일·Node/Rhino 및 예외 검증→전용 TEMP 정리→ver_2.832 source push→prod 원격 확인→Notion DEV/일자/버전 갱신.
