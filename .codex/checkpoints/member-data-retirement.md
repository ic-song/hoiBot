# 레이드 중복 요약·봉인금고 희귀 기록 종료 및 긴급 공격권 수정

- 작업 키: member-data-retirement
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 1
- 마지막 갱신: 2026-11-16 Asia/Seoul
- 작업 위치: C:/Users/user/Desktop/hoiBot, 현재 codex/guild-war-ticket-order
- 기준: origin/feature/prod ce9c2c49 (07 스냅샷), main ver_2.854. 스냅샷이 changelog 2.854 행을 없애 2.853부터 시작하므로 원격 릴리스 기록 2.854를 소스에서 복원한 뒤 2.855 이상 증가 필요.
- 사용자 승인: 레이드 중복 요약(serverRaidAccount.latest) 및 봉인금고 개인/전체 희귀 기록만 종료. 필수 ID/누적 전적/재화/금고 개봉·부스터·천장/월별 보상/관리자 기록 보존. 실제 JSON 제거는 /데이터정리 미리보기→확인만, 백업/복구본 실제 정리 금지. 검증 후 운영 Git 반영.
- 긴급 추가: 공용 기본권1 남고 추가권0인데 편성의 모든 개인권0인 제보를 먼저 수정·운영반영 후 위 작업 재개. 운영 단말 접근 금지.
- 조사: 07의 해당 길드는 초기화된 5/5 상태여서 제보 시점 실제 권리표는 없음. 공격 자리 교환 뒤 기존 자리별 flags와 계정별 사용량을 동시에 적용해 미사용자의 잔여가0이 되는 경로 발견. 개인 누적/공용권/지휘관 이력은 초기화하지 않고 남은 공격 진형권만 현재 공격자의 계정 한도 안에서 참조하도록 수정 중.
- 현재 수정: getGuildWarPersonalAvailability에서 현재 공격 편성자에게 미사용 attack0/1/2를 후보로 보완. 길마/정찰/지휘관 권리는 공유하지 않음. Node/Rhino116개 합성 회귀 검증 통과. UI/기록 문서와 ver_2.855/개발자노트 반영. 원격 push/prod 후 정리 작업 재개 필요.
- 이후 남은 일: 최근 레이드 조회를 기존 serverRaidData에서 계산(중복 요약 생성/참조 제거), 금고 희귀 기록 생성·조회·명령 종료, /데이터정리에서 현행 JSON 필드만 제거 및 재생성 방지. 기록 삭제를 시작/일반 메시지에 넣지 말 것.
- 확인된 원본: ce9c2c49 member1,489,595byte / 회원363 / latest195(기존 기록과 전체 동일) / 금고 개인593건·전체100건. 원본 JSON 변경 금지, 검증은 메모리 사본/합성 자료. 임시 검증은 %TEMP%/hoiBot/member-data-retirement, 완료 후 파일별 삭제.
- 변경 범위: main.js, 필요 시 Info.js, COMMAND_INDEX.md, COMMAND_REGISTRY.md, ERROR_FIX_LOG.md, data/hoiBotChangeLog.json, 본 체크포인트. 기존 미추적 다른 체크포인트 보존.

- 브랜치 예외: origin/feature/bugFix는 미반영 b45affeb 및 열린 PR173의 다른 작업이 있어 보존. 최신 prod에서 만든 로컬 bugFix를 codex/guild-war-ticket-order로 이름 변경하여 분리. 원격 기존 브랜치 삭제/덮어쓰기 금지.
