# 길드전쟁 스킬·공격권·지도 통합 개발

- 작업 키: guild-war-skills-map
- 작업 상태: 작업 완료
- 정리 후보: 아니요
- 체크포인트 버전: 3
- 마지막 갱신: 2026-11-12 Asia/Seoul
- 목표: READY 기획 https://app.notion.com/54f393bdd7aa831c959d015077d01d0a 구현·로컬 검증. 운영 반영은 아직 미승인.
- 사용자 확정: 개인 선포권은 역할권 모두 합산. 지휘관 장착 길마는 길마+정찰+공격+스킬 최대4회. 공용 기본5회와 충전분은 별개.
- 파일 범위: main.js, 필요 시 Info.js, COMMAND_INDEX.md, COMMAND_REGISTRY.md, 본 체크포인트. 운영 스냅샷과 기존 다른 체크포인트는 보존.
- 위치: C:/Users/user/Desktop/hoiBot, feature/guild-war-skills-map. 기준 feature/prod=180e83abad0e10524439ac326710f5c7a2ab2a60.
- 앞선 3건 로컬 커밋: 다이아3a6bcdef(feature/diamond-conversion), 대전보상7eeb86b(feature/daily-battle-rewards), 시장5a3faaf(feature/free-market-fees). 운영/노션상태 미변경.
- 검토: 기존 상태 version2/expansionVersion1, 개인 최대2회·5개 역할권·기본5회. 신규 권리·추가 공격권과 지역 재배치를 별도 일회 전환 표시로 검증하며 기존 진행 전투를 취소하지 않는다.
- 다음 행동: 별도 운영 반영 승인 전까지 source 개발 결과를 보존. 이후 실제 원격 기준 재확인·개발자노트/버전 추가·source push 후 prod 반영 및 Notion DEV/실제일/버전 동기화가 필요하다.
- 구현: main.js에 campaignVersion 일회 지역 재배치, 문자열 큰 정수 추가권, 여섯 역할권·개인 합산, 스킬 스냅샷, 지도·소진·진격·침공 UI 연결. 명령 인덱스·등록부 동기화 완료. 이번 로컬 작업 커밋에 함께 보존.
- 검증: node --check main.js, git diff --check, UTF-8 확인, Rhino 1.7.15 전체 source compileString 통과. 실제 helper/명령·합성 저장으로 6038개 assert 통과(소유 상태729조합, 개인4회, 큰 정수 충전, 다음날/운영 초기화 보존·환급, 기존 진행 전투/영주/보상·번호 이관, 효과 고정, 침공/소진 UI, 회원/길드/완료표식 저장 실패 전체 취소). 저장 저수준·환경 API는 일부 모의이며 Android 실제 callback·파일 IO·길드톡 E2E는 미검증. 임시 검증 파일 삭제 완료.
- Git: 새 체크포인트 로컬 파일. 아직 푸시 없음. Android/LDPlayer 접근·업로드·컴파일 금지.
