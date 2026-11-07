# 길드전쟁 확정 정책 개발

- 작업 키: guild-war-beta
- 작업 상태: 검증 완료
- 정리 후보: 아니요
- 체크포인트 버전: 4
- 마지막 갱신: 2026-11-06 KST
- 목표/승인: 수정된 Notion READY 401393bdd7aa821ab7d281d767c2fb6b의 Q1~Q13·51검수에 따라 레거시 개발·검증·소스 push·feature/prod 원격 반영·Notion 세 속성·정확 버전 카카오 알림까지 수행. 운영 기기 접속 금지.
- 선언 파일: main.js, 필요 시 Info.js, COMMAND_INDEX.md, COMMAND_REGISTRY.md, ERROR_FIX_LOG.md, data/hoiBotChangeLog.json, 본 체크포인트. 테스트·합성자료는 %TEMP%/hoiBot/guild-war-beta에만 생성하고 완료 후 제거.
- 작업 위치: C:/Users/user/Desktop/hoiBot, codex/guild-war-beta. 최신 local/origin feature/prod 460cdfb1/ver_2.779에서 생성.
- 기존 사용자 미추적 체크포인트7개 보존. 구 작업 체크포인트는 과거 브랜치/검증 기록이며 현재 tracked 수정 없음. 기존 오류복구 e0b8c1a2를 새 작업에 cherry-pick, ERROR_FIX_LOG의 최신 큐 조사 기록과 기존 길드전쟁 기록을 모두 보존해 충돌 해결.
- 기획 확정: 역할별5회·정찰/교체각2회·3:00/3:15/3:30·방어+3/+10 및 정찰합계+8·대장특수아이템제외·지역5/광산지구방위대·점령3억/방어1억/광산조각1·자폭겸직1회10%/교체1회·전쟁중지역차단·미점령영주/세금중단·즉시무혈입성동일보상·등록길드MASTER초기화·기존영지전/22:05보상휴식·길마기본권우선·당일순사용차감·진행전쟁양측무효/공격권1환급/아이템복구·편성초기화정찰/자폭/사용량유지.
- 완료: prod 기준 새 브랜치 생성 및 기존 오류복구2388159 cherry-pick. main.js에 역할권/일회전환/자폭/단계별전투/무혈입성/보상/명령/길드정보/교육/스케줄/영지전휴식 연동 구현. 신규범위만main약600줄diff. 기존저장/복구게시본문재사용. 운영기기·게임스냅샷 미접근.
- 검증: 기획51항목+추가15예외 총66시나리오/226단언을 Node와Rhino1.7.15 languageVersion200에서각각통과. 일부UI연계는 실제helper출력+소스hook확인. 단계별중복/동시방어아이템/실패복원/권한/오입력/날짜/일회전환/관리자/알림재시도/DEV 포함. 스케줄실제문자열을추가검증해남은22:05보상유지문구를지급중단으로보완.
- 실제디스크검증: 실제 prepare/publish/recover·UTF8원자교체·SHA256복사에Java임시파일을사용해58검사통과. 회원저장후/길드저장후/완료표식직전중단·정상완료재실행·손상사본선검증·필수원본누락·다른저널충돌. 별도JVM prepare종료→recover16검사통과. 회원분리save·Android전송·관련없는계산은어댑터. 실제운영환경실행은제외.
- 정적검증: 최종 main.js/Info.js Node syntax, 전체Rhino128MiB컴파일, git diff--check, UTF8검사 통과. 기존7인자callback·DEV/PROD경로·공통저장/복구본문유지. Info.js미변경.
- 반영준비: HoiBotVersion/개발자노트2.780·2026-11-06 동기화. 명령인덱스/레지스트리/오류기록갱신. 최신origin/prod460cdfb1유지, 소스는2388159+이번개발. Notion본문이시작시점과동일함을재확인했으며운영후본문추가수정금지.
- 임시자료: 검증150파일/JAR/합성자료와빈디렉터리10개를커밋전에전부정리완료. 일괄계산경로삭제가자동검토에서거부되어검증한절대경로의명시파일목록과빈폴더만각각삭제했고성공확인. 다른작업자료·사용자미추적7개보존. 영구테스트파일미추가.
- 검증소스: main.js SHA256=95ffe326f7fc3e728973484ebe54ecf8ebdf0f130ab022014df1376d3e451630. Info.js는기준prod와동일.
- 다음 행동: 한국어커밋/source push→PR/prod원격검증→Notion상태/날짜/버전3종→PlayMCP정확ver_2.780알림. 아직prod미반영·Notion속성미갱신·알림미전송.
