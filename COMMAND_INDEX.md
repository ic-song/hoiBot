# COMMAND_INDEX.md

Status: PARTIAL

This document is an AI-oriented navigation index for command and helper exploration.
Source of truth is always the current codebase, especially `main.js` and `Info.js`.

## How To Read This File

- `VERIFIED`: confirmed against current code in this repository
- `PARTIAL`: partially confirmed, useful as a navigation hint but not complete
- `STALE`: likely outdated, re-check code before using
- `UNKNOWN`: not verified yet

## AI Navigation Rules

- Use this file as a starting map, not as proof.
- Prefer searching the listed command text or helper name first, then inspect related branches.
- Search anchors intentionally avoid line numbers so they remain useful after code insertions and removals.
- If a command appears in both `main.js` and `Info.js`, trust the actual branch handling in code.
- When a command mutates game state, check both `loadJsonFile` and `saveJsonFile` calls in the same branch.

---

# /미니게임 · /밸런스 · /밸런스결과 · /호월주사위 · /금고 · /금고리셋 · /금고횟수리셋

Status: VERIFIED

## Files and entry points

- `main.js`: `getMiniGameRequest`, `runMiniGameEntry`, `scheduleMiniGameWork`, `getMiniGameWorkDelay`, `getMiniGameObservedVaultId`.
- `Info.js`: 회원 읽기 전 `miniGamePending.json` 게시 대기 차단. 포인트 중간 상태 표시 방지.
- 기본 7인수 `response(...)` 유지. 기존 등록·출석·정지·개인톡 패스·대전/영지전 제한을 통과한 뒤 진입.
- 무인수 명령은 정확히 일치할 때만 실행. 투표는 1·2와 한 줄 1~80자 이유, 금고는 100~99999 정수 하나만 구문으로 허용하고 현재 단계 범위는 판정 직전에 검증한다. 접미 안내·개행·숨김 문자 거부.

## Helpers and behavior

- 밸런스: `pickMiniGameCycle`, `createMiniGameBalance`, `summarizeMiniGameBalance`, `closeMiniGameBalance`, `buildMiniGameBalanceMessages`, `buildMiniGameBalanceStats`.
- 전체 방 공용 일일 리셋 회차당 한 문항, 권한이 확인된 `/리셋` 실행 시 마감. 5명 이상·동률 아님이면 다수 선택자 각각 1억 적립. 본인 `/밸런스` 또는 정상 투표에서 미수령만 합산 지급.
- 밸런스 조회는 투표 전후 모두 `📖 밸런스 게임 하는 방법` 다음 줄에 `명령어:/밸런스 번호 선택이유`를 표시한 뒤 기존 `allsee`와 마감·보상·투표 상태 안내를 출력한다.
- 공개 이유 목록에는 닉네임·이유만 최신 접수순(최근 등록이 위)으로 출력. 저장된 투표/접수 순서는 바꾸지 않고 조회할 때 역순으로 순회한다. `allsee` 뒤 분할하며 페이지가 나뉘어도 최신순을 유지하고 선택·진행 중 집계는 제외한다. MASTER 결과 조회에만 합산 현황 표시.
- 주사위: `getMiniGameDiceLimit`, `startMiniGameDice`, `advanceMiniGameDice`, `pickMiniGameDialogue`, `buildMiniGameDiceMessage`.
- `/호월주사위`와 앞뒤 공백을 제거한 정확한 `ㅎㅈ`는 같은 실행·횟수·배타 잠금을 사용한다. DEV도 같은 단축키를 지원하며 일반 문장·접미는 실행하지 않는다. 새 판은 호이패스 프리미엄 전용 하루 총 4회다. 첫 입력은 양쪽 1차 숫자·멘트 1줄·다음 입력·allsee 안내, 두 번째 입력은 양쪽 1·2차·합계·승부·보상·잔여 판 수를 표시해 정상 진행 총 2메시지다. 자동 추가 굴림은 없다. 승/무/패 3천만/2천만/1천만, 비용 없음. 기존 판은 날짜 변경·프리미엄 만료 후에도 끝낼 수 있다. 신규 시작 자격과 한도는 유지한다.
- ver_2.714: `calculateMiniGameDiceBonus`는 럭키 식스 5천만·역전승 2천만·2/3/5연승 1천만/3천만/1억을 계산한다. 승리만 연승 +1·무승부 유지·패배 0, 6연승 이상 추가 보너스 없음. 두 주사위 화면에 현재 연승과 `buildMiniGameDiceGuide`의 공통 allsee 안내를 표시한다. 상황별 반응은 주사위 난수와 분리해 순환하고 확정 문구를 재사용한다. 최종 숫자·경기 전후 연승·보너스·합계와 보상 원장을 같은 기존 미니게임 게시로 확정하여 재시도/재시작 때 재가산하지 않는다. `requireMiniGameDiceBonus`는 과거 보너스도 원래 숫자로 검증한다. 구버전 완료·지급 대기 경기는 소급 보너스 없이 유지한다. 일일 `/리셋`은 개인 횟수만 0으로 바꾸고 연승·진행 중인 판은 보존한다.
- 구 `USER1`/`WAIT_USER2`/`USER2`/`RESULT`의 확정 숫자·멘트·횟수·지급 기록을 보존해 다음 정상 입력에서 미완료 숫자만 이어간다. 기존 저장 단계 번호 1→2는 첫 통합 화면, 4→5는 최종 화면에 사용한다. 지급 실패는 최종 화면의 `지급 대기`로 표시하고 자동 정산에서 숫자·횟수를 다시 만들지 않는다. 결과 화면은 프리미엄/메뉴/규칙을 반복하지 않는다.
- 금고: `getVaultRobberyRequest`, `createVaultRobberyRound`, `startVaultRobberyRound`, `upgradeVaultRobberyStore`, `getVaultRobberyStage`, `openNextVaultRobberyRound`, `resetVaultRobberyRound`, `resolveVaultRobberyUser`, `getVaultRobberySkillBonus`, `getVaultRobberyAttempts`, `applyVaultRobberyGuess`, `buildVaultRobberyMessage`.
- 1~3번째 쉬움 100~999·2억·힌트 3개, 4~7번째 보통 1000~9999·5억·힌트 5개, 8~15번째 어려움 10000~99999·10억·힌트 5개. 일반/일반 호이패스 3회·프리미엄 총 5회로 금고 간 개인 횟수를 공유한다. 정상 입력만 차감하고 정답이어도 복구하지 않는다. 동일 계정의 여러 금고 당첨은 허용하지만 같은 금고는 원장으로 1회만 지급한다. 15개 당첨 후 종료하며 고정 상금 합계는 106억이다. 조회 진행은 완료 개수 0/15부터 표시한다. 현재 금고 힌트와 `buildVaultRobberyWinners`의 금일 당첨자(실제 정답·닉네임·상금)는 최신순으로 표시하고 목록은 allsee 뒤에 둔다. `getVaultRobberyPaidTotal`은 실제 지급 완료 상금만 합산한다.
- `금고털이범📙`은 A등급·기존 등급별 확률 0.4%·추가 2회, `경제사범📙`은 한정판 등급·일반 오픈 제외·추가 4회다. 실제 장착한 신규 스킬의 최댓값만 가산하며 중복 보유·동일 스킬 중복 장착·잠금 슬롯은 추가 가산하지 않는다. 탈착·교체·패스 변경 시 이미 쓴 횟수는 유지하고 잔여 횟수만 다시 계산한다. 명령 진입에서 `petSkillDataPath`를 한 번 읽고 계산 헬퍼에는 로드된 데이터만 전달한다. 조회·스킬 계산은 스킬 파일을 저장하지 않으며 누락·잘못된 JSON은 기존 오류 흐름으로 실패한다. 개별 횟수 리셋 안내에도 대상의 현재 장착 보너스를 포함한다.
- 금고 공개 안내의 초기화 시각은 `매일 자정`으로 표시하고 관리자 명령어는 노출하지 않는다. 실제 초기화는 기존 `/리셋` 실행 기준을 유지한다.
- 금고털이범·경제사범은 `PET_SKILL_COMPAT_GROUPS`에 같은 그룹으로 등록되어 `/펫스킬장착` 시 양방향으로 함께 장착할 수 없다. `isPetSkillCompatible`가 아이템 소비·저장 전에 거절하며 펫스킬 중복 안내에도 같은 조합을 표시한다. 기존 동시 장착 기록은 자동 삭제하지 않고 횟수 보너스의 최댓값 보호를 유지한다.
- 상금 이월·증가·누적 상한과 계산 함수는 제거했다. 일일 /리셋은 1번째 쉬움 2억·비밀번호·횟수·힌트·금일 목록/합계를 초기화한다. 다음 금고는 지급 확정 후 즉시 열리며 이전 범위 밖의 정답은 새 난수 범위에서 제외하지 않는다. 게임 ID/시각이 오래된 요청은 미차감 안내한다.
- `/금고리셋`: 기존 MASTER만, 새 ID·비밀번호로 첫 금고를 열고 당일 당첨 목록·전체 개인 사용 횟수·최근 힌트·재응답 대기를 함께 초기화한다. 15개 종료 후에도 리셋 가능하다. 이미 지급한 포인트·보상/지급 원장은 보존하고 이전 회차는 보관한다. 미지급 보상이 있으면 보류하며 기존 미니게임 게시 저널로 진행과 보관을 함께 확정·복구한다. 오래된 게임 ID·요청 시각은 새 금고를 실행하지 않는다.
- `/금고횟수리셋 아이디`: 기존 MASTER만, 해당 날짜의 한 계정 사용 횟수만 0으로 바꾼다. 기존 회원 검색 재사용, 닉네임/다른 계정 ID 충돌은 거부하고 @닉네임으로 명시 가능. 암호·힌트·상금·게임·종료·보상은 유지. 운영 기록에 실행자/대상/시각/결과/게임 ID만 남기며 비밀번호는 포함하지 않는다.
- 구 `/호이월드미니게임`은 실행 명령에서 제거, 현재 메뉴·도움말·게임 안내는 `/미니게임`으로 통일한다.

## Data and save flow

- 정적 원본: `data/balanceQuestions.json` 1,300문항/26분류, `data/howoriDiceDialogues.json` 200멘트/8분류. `tools/build_mini_game_catalog_bundle.js`가 Main의 구간 표시에 전체 자료를 생성하며 `--check`로 동기화를 검증한다. `getMiniGameBundledCatalog`는 누락 시에만 원본 전문을 반환한다.
- 정적 파일 누락은 유효한 교체 이전본 또는 배포에 포함된 전체 자료로 복원한 뒤 원래 경로에서 읽는다. 기존 파일 손상은 덮어쓰지 않고 오류로 유지, 사용자에게 짧은 점검 안내와 운영 오류 기록을 남긴다. 복원/로딩 실패는 투표·게임 시작·횟수·지급 변경 전에 중단. 활성 경로·수정 시각·크기별 캐시, 정상 조회/투표/굴림에서 정적 파일 저장 없음.
- 활성 진행·순환·투표·이용 횟수·미수령 원장: 활성 데이터 루트의 `miniGameState.json`. 완료된 날짜·지급 증거는 `miniGameArchive_YYYY-MM.json`에 보관, 임의 만료 없음.
- 일일 기준은 시계 자정이 아닌 실제 `/리셋` 실행이다. 운영의 자정 `/리셋`과 같은 회차를 사용하며 `dailyReset`의 날짜·연속 회차·실행 시각을 기록한다. 금고 비밀번호·15개 진행·횟수·당첨 목록/지급 합계, 밸런스 마감/새 질문, 주사위 새 판 횟수가 함께 전환된다. 기존 주사위 판과 미지급은 유지한다. 같은 날짜의 재리셋도 기존 출석 리셋처럼 새 회차를 만들며 밸런스 원장·마감 공지·보관/통계는 회차를 구분한다.
- `runMiniGameEntry("resetPlan")`은 원본을 검증해 저장 계획만 반환한다. 기존 `/리셋` 권한 분기에서 회원·펫 저장 뒤 보관·진행을 게시하고, 원문/신규 파일을 기존 저장 트랜잭션에 등록해 실패 시 함께 복구한다. 기존 미니게임 지급 확인 대기는 기록을 유지하고 미니게임 리셋만 보류한다. `/리셋`은 잠금 경합 시 기다리므로 자동 정산 중에 명령이 버려지지 않는다. 자동 작업은 미완료 지급/공지 재처리만 하며 시각만으로 새 회차를 만들지 않는다.
- 공통 고유 ID `member[*].serverRaidAccount.id` 재사용. 신규 등록 시 ID를 발급하며 첫 설치 때 기존 누락 ID만 한 번 보충한다. 설치 이관 이후 조회·투표·일반 굴림은 회원 저장 없음. 실제 지급은 기존 `addPoint`·`saveJsonFile` 경로만 사용.
- 당첨/마감/주사위 결과를 먼저 확정하고 `payMiniGameRewards`로 정산. 원문 게시 저널 `miniGamePending.json`을 먼저 저장한 후 회원·진행·해당 월 보관을 게시한다. 게시 완료 경계 이후 저널을 비운다. 중단 시 다른 회원 변경 전에 확정 원문을 완성하므로 이후 거래를 과거 회원 백업으로 되돌리지 않는다.
- `runMiniGameEntry`의 월별 보관은 `archive(day, true)`로 실제 변경을 표시하고 변경된 월만 한 번 직렬화한다. 보관 비교용 전체 문자열을 상시 유지하지 않으며 통계 조회는 변경 표시를 하지 않는다. 일일 리셋 계획은 사용하지 않는 진행 비교 문자열을 생성하지 않고, 실제 저장은 변경 판정 후 이전 비교 문자열을 해제한 다음 기존 원문 게시 저널을 만든다. 금고 교체는 새 회차 객체로 바꾸므로 이전 회차를 전체 복제하지 않는다. 기존 저널 버전·검증·저장 순서·복구 계약은 유지한다.
- 진행 파일은 정상이고 저널·교체 이전본만 없으면 진행을 검증한 뒤 누락 저널만 생성한다. `getMiniGameMissingJournalReviewReason`가 PENDING 원장·미지급 금고·결과 단계 미지급 주사위를 발견하거나 임시 저장 흔적이 있으면 `recovery: {required:true,reason:...}`를 기록하고 미니게임 변경/지급을 보류한다. 남은 저널 `.tmp` 원문은 `.missing`으로 보존하며 기존 증거 충돌은 실패한다. 진행·회원·정답·횟수·기지급 기록은 초기화하지 않는다.
- 지급 확인 대기 중에도 조기 `recover`의 `allowRecoveryReview`는 일반 명령을 통과시킨다. 실제 미완료 게시 원문은 기존대로 먼저 완성한다. `/미니게임`은 메뉴와 보류 안내, 게임 실행은 짧은 보류 안내를 출력한다. 시작 시 미니게임 예외는 로그를 남기고 다음 초기화를 계속하며, 확인 대기 자동 작업은 같은 오류를 반복 예약하지 않는다. 손상 파일은 이 예외 복구 대상이 아니다.
- 금고 schema1/2는 검증 후 schema3으로 한 번 이관한다. 현재 일일 회차의 기존 당첨(같은 날짜 이전 /리셋 기록은 제외)과 개인 사용 횟수, 확정 보상의 금액·보상 ID·지급/공지 상태는 보존한다. 미당첨 이월금은 폐기하고 새 순번의 고정 상금·범위로 교체하며 원래 금고는 보관한다. 기당첨 보상은 재지급하지 않고 미지급 확정 보상은 원래 금액으로 정산한 뒤 다음 순번을 연다. 과거 형식 범위/금액 상수는 이 검증에만 사용한다.
- `requireMiniGameState`, `requireMiniGameJournal`, `requireMiniGameArchive`, `requireMiniGameCatalog`로 손상을 오류 처리. 설치 후 누락·파싱 오류를 빈 진행으로 초기화하지 않는다. 분리 회원의 레이드/로그 슬롯 변경은 차단한다.
- 전체 공지는 지급과 별개로 CLAIMED를 먼저 저장. 실패·전송 여부 불확실 상태는 UNCERTAIN으로 남기고 자동 재발송/재지급하지 않는다. 상태/보관 원문에서 운영 확인 가능.
- DEV/PROD 모두 기존 `resolveActiveDataPath` 적용. 운영자는 새 Main과 개발자노트를 업로드·컴파일한다. 정적 JSON은 함께 배포할 수 있으며 빠졌을 때 Main의 전체 자료로 복원한다. 진행/저널/보관 파일은 런타임에서 생성하며 저장소 데이터로 덮어쓰지 않는다. Info의 기존 게시 차단 형식은 호환 유지.

## Validation

- `tools/test_vault_robbery.js`: 3·4·5자리 정답 전 범위, 난수 양끝과 직전 정답 제외, 입력·단계 오류·KST 변환 6그룹. `tools/test_vault_balance.js`: 실제 15개·106억·3/5회·힌트·최신순 UI·이월 폐기·schema1/2와 구 저널 이관·확정 지급/실패·DEV·/리셋 16그룹. `tools/test_vault_reset_skills.js`: 신규 스킬·등급/확률/장착 UI·탈착/교체·전체 리셋·재시작·중단 복구·10개 종료본 확장·손상 파일 9그룹. `tools/vault_reset_skills_validation.md` 참조.
- `tools/test_mini_games.js`: 실제 명령 진입·7인수 콜백·정산/저널/실패 재시도·분리 회원·Info 차단·정적 자료·일일 `/리셋`·시각만 경과 시 유지·DEV 예외 검증.
- `tools/test_mini_games_rhino.js <rhino.jar>`: 전체 Main/Info Rhino 컴파일, 실제 Java 파일·동시 스레드·새 전역 재시작·보상 중단 복구 검증.
- `tools/test_mini_game_revision.js`: 2.697 이관·2차/수동 개방·공유 횟수·프리미엄 전용·관리자 대상/권한·동시 게임 ID 경계·누락 복원/손상 차단·짧은 오류 안내 검증.
- `tools/test_mini_game_missing_journal.js`: 누락 저널만 생성·기지급/불확실 지급 보존·임시 원문·실패/DEV·실제 일반 콜백·시작 예외·반복 타이머 중단 11그룹. Rhino 시험에도 실제 파일 누락/동시 생성/재시작/원문 보존/보류·잠금 해제를 포함한다.
- `tools/test_mini_game_ui.js`: 2메시지·별칭/DEV 실제 콜백·승무패/6개 눈·구 진행 8단계·기지급/중단/응답 실패·지급 대기·금고 범위/특별 힌트 제거·기존 기록 보존.
- `tools/test_mini_game_daily_reset.js`: 실제 `/리셋` 분기11그룹. 시각만 경과 시 유지·동일 날짜 여러 회차·미수령/기지급·진행 중 주사위·권한/접미·회원/펫/보관/진행 실패 복구·DEV·이전 회차 대기 입력·잠금 대기·지급 확인 대기·시각 역행.
- `tools/test_mini_game_memory.js`: 성능 수치 비교 없이 금고 회차 보관의 불변성·관리자 변경 기록·이중 당첨 지급·통계 무저장·큰 합성 보관과 기존 버전 저널의 게시 중단 복구를 검증한다. `tools/mini_game_memory_validation.md` 참조.

---

# 명령별 데이터 로드 · Info 조회 · Main 재화 기록

Status: VERIFIED

## Files and Save Flow

- `Info.js`는 회원·길드를 기존 공통 위치에서 읽고 레이드·출석·영지·무쌍·개인톡·정지·약관 제한을 검사한다. 펫·펫스킬·회원 타이틀·펫 타이틀은 해당 명령 분기 안에서 필요한 것만 읽는다. 파일을 생략할 때 빈 객체를 대신 만들거나 새 캐시를 쓰지 않는다.
- `/포인트`·`ㅍㅍㅍ`·`/레벨`·출석·상점·서버 통계·티어·누적 좋아요/영주 수익·캐슬대전 순위는 위 4종 선택 파일을 읽지 않는다. `checkRank`는 펫 인자를 실제로 참조하지 않으며 닉네임·길드 표시는 회원/길드로 계산한다. 이 의존성이 바뀌면 로드와 테스트를 함께 갱신해야 한다.
- `/정보 대상`: 펫+회원 타이틀, `/내정보`: 펫+회원 타이틀+펫 타이틀, 회원/펫 타이틀 목록: 해당 타이틀만 읽는다. 기존 대상 조회 권한과 인자 처리는 유지한다.
- 종합/서버/캐슬매력/레이드매력 순위: 펫+펫스킬, `/펫정보`·`/ㅎ`·`ㅁㅁㅁ`: 펫+펫스킬+펫 타이틀을 읽는다. 미니펫 대전/승률·펫강/펫매력/시련탑 순위·펫상태/주인·미니펫통계·캐슬전적은 펫만 읽는다. 펫홈·탐험·시련탑·캐슬 등 각 분기의 다른 기존 로드는 유지한다.
- `main.js`의 `currencyLogPath` 로드는 기존 공통 위치를 유지하되 맞짱 종료·다이아 순위/상점 구매/지급/차감/전체 초기화/상자 개봉·길드 분배·계정 삭제/잠수 삭제·데이터 정리에서만 실행한다. 다른 명령·일반 대화는 재화 기록을 읽지 않는다. 이는 읽기 분류이며 명령 실행 가드·권한·저장 순서·트랜잭션은 바뀌지 않는다.
- Main의 펫/스킬/길드 공통 로드는 패스 만료·스킬 보정·대전 및 자동 처리에서 실제로 사용하므로 유지한다. DEV/PROD 경로, 기존 로더의 누락/손상 처리와 복구 대기 차단도 유지한다.
- 검증: `tools/test_command_data_loading.js`, `tools/test_command_data_loading_rhino.js`, `tools/command_data_loading_validation.md`.

---

# /교육 · /교육완료 · /교육실적 · /교육실적전체 · /교육명령어

Status: VERIFIED

## Files and Commands

- `main.js`: `GLOBAL_CONFIG.gmEducation`, 교육 요청/원본 검증·진행·보상·매뉴얼·실적 함수. `Info.js`: `/내정보`·`/정보 닉네임` 레벨 다음 교육 상태 한 줄과 경로별 읽기 캐시.
- `isGmEducationOperator`: 기존 `isMaster` 판정과 허용 방을 유지하고 `GLOBAL_CONFIG.gmEducation.rooms`의 정확한 `교육방`·`교육방2`에서는 기존 Master 명단에 든 사용자에게 교육 명령만 허용한다. 전역 `isMaster` 방 목록은 바꾸지 않는다. Admin/일반 사용자는 제외한다. 두 방은 같은 교육 원본과 보상 영수증을 사용하며 방을 바꿔도 중복 완료·보상·실적을 만들지 않는다. 진행 중 영지전의 공통 차단은 교육방 허용보다 우선한다.
- `/교육`: 기존 GM 흐름 안내와 전체보기 12챕터 제목 목록, `/교육 1`~`12`: 공통 매뉴얼, `/교육 아이디`: 진행/다음 챕터. 숫자 계정은 `/교육 @닉네임` 또는 기존 `serverRaidAccount.id`로 구분한다. 공백 닉네임도 전체 이름으로 조회한다. 11장은 홈뱃지·큐브, 12장은 `/패키지가방`에서 패키지 이름·보유 수량을 확인하는 교육이다. 실제 재화 사용·결제는 완료 조건이 아니다.
- `/교육완료 아이디 챕터번호`: 마지막 정수 1~12와 그 앞의 전체 닉네임을 분리. 다음 챕터만 허용하며 재완료·순서 건너뛰기·추가 안내 문구는 지급하지 않는다. 계정당 총 12개 챕터, 챕터당 `다이아상자💎(소)` 1개, 수료 추가 보상 없음. 기존 10챕터 기록은 10/12로 유지하고 11·12만 추가 지급한다.
- `/교육실적`, `/교육실적 GM아이디`, `/교육실적 전체` 뒤 선택적 `YYYY-MM`: 기본은 현재 KST 월, 지정 월은 최초 정상 완료 시각 기준으로 집계한다. `/교육실적전체 [YYYY-MM]`은 전체 조회 별칭이다. 담당 GM 교대·닉변에도 내부 계정 ID를 유지한다. 개수 내림차순·동률 1등/1등/3등·닉네임 정렬, 본문 최대 3명과 전체 순위/`👤` GM별 기록을 `allsee`로 표시한다. 각 기록은 대상자·챕터·KST `YYYY.MM.DD HH:mm:ss`를 한 줄로 출력한다. 시각 기록은 최신순, 날짜만 있는 기록은 시각을 만들지 않고 같은 날짜 안에서 원본 순서를 유지한다. 인원·수료 인원·금액은 표시하지 않는다. 미래·빈 달·형식 오류·없는 계정·예약어 충돌은 각각 안내하며 `/교육실적 초기화`는 과거 월 조회를 안내한다.
- `/교육명령어`: 독립된 전체보기 명령 안내. 상단/상세의 지난달 예시는 KST 직전 월로 자동 변경한다. `/교육`에 새 명령 목록을 붙이지 않는다. 조회는 무저장이다.
- 실제 게임 명령·권한·소모 조건은 그대로다. 강화·구매·가입·거래를 강제하거나 자동으로 교육 완료하지 않는다. 교육 초기화·별도 타이머 없음.

## Helpers and Save Flow

- `getGmEducationRequest`, `resolveGmEducationUser`, `requireGmEducationStore`, `getGmEducationProgress`, `requireGmEducationPending`, `applyGmEducationPending`, `buildGmEducationStatus`, `buildGmEducationManual`, `buildGmEducationStats`.
- 교육 원본 `gmEducation.json`: 계정 ID별 최대 12개 확정 챕터/담당 GM/처리 키/시각. 실적은 이 기록에서 계산하며 별도 집계 파일을 중복 저장하지 않는다. `getGmEducationChapterCount`, `getGmEducationMonthKey`, `getGmEducationStatsRequest`, `buildGmEducationCommands`가 챕터/월/안내를 일관되게 처리한다.
- 가방과 동일한 `member.json` 저장에 `member.gmEducationRewards` 최대 12개 처리 키와 `gmEducationRewardTimes` 최초 확정 시각을 함께 남긴다. 기존 영수증에는 날짜 메타데이터가 없어도 되며 새 챕터 추가 시 기존 구간은 null로 보존한다. 기존 안정 ID가 없으면 ID만 먼저 확정한다.
- `gmEducationPending.json` 영속 요청 확보 → 가방+지급 영수증 저장 확정 → 교육 원본 저장 확정 → pending 삭제. 응답은 이후 출력한다. 중단된 요청은 다음 Main 응답 전처리에서 최초 계정/GM/처리 키로 누락 단계만 복구한다. 이미 사용한 보상을 다시 주지 않는다.
- 신규 요청의 `completionClock: 1`은 요청 영속화 후 회원을 다시 읽고 보상과 같은 저장에 완료 시각을 확정한다. 미지급 요청이 다음 달 처음 확정되면 새 월, 기지급 뒤 원본 저장만 복구하면 최초 영수증의 월을 유지한다. 기존 pending은 기존 at를 보존한다. 기존 원본의 완료 날짜가 없으면 원본 그대로 `기존 누적·월 미분류` 상세로 인계하고 월별 실적에서는 제외한다. 잘못된 날짜·영수증·JSON은 계속 오류다.
- 두 GM의 완료 요청은 기존 쓰기 흐름 잠금으로 직렬화한다. 분리 회원의 레이드/운영 로그 슬롯은 그대로 유지한다. pending/원본의 게시 중단 `.rollback`도 기존 파일 검증 후 복구한다.
- PROD `/sdcard/호이랜드/`, DEV `/sdcard/호이랜드_dev/`의 교육/요청/회원 파일은 분리한다. 최초 전용 파일 미생성은 미진행, 기존 잘못된 JSON/형식·영수증 불일치는 오류로 남기며 빈 데이터로 덮지 않는다.
- 조회는 무저장. `/내정보`와 `/정보 닉네임`은 환경별 교육 파일의 수정 시각/크기별 캐시를 공유하고, 각 조회 대상자의 지급 영수증과 일치한 완료 수만 표시한다. 복구 대기 중에는 이전 확정 수만 노출한다. `/정보`는 레벨 다음에 `📘 n/12챕터 완료 · 다음 n+1챕터`, 12개 완료 시 `📘 12/12챕터 완료 · 전체 수료`를 표시한다.
- 검증: `tools/test_gm_education.js`, `tools/test_gm_education_rhino.js`, `tools/test_education_followup.js`, `tools/test_education_territory_update.js`, `tools/test_oct25_ready.js`, `tools/oct25_ready_validation.md`. 이전 이력은 `tools/gm_education_validation.md`.

---

# /길드마블 · /마블판 · /마블가이드 · 길드마블 진행

Status: VERIFIED

## Files

- `main.js`: `GLOBAL_CONFIG.guildMarble`, `getGuildMarbleRequest`, 응답 전처리의 길드마블 분기, 순수 경기/출력 함수.
- 검증: `tools/test_guild_marble.js`, `tools/test_guild_marble_settlement.js`, `tools/test_guild_marble_improvements.js`, `tools/test_guild_marble_rhino.js`.

## Commands and Behavior

- `/길드마블`: 현재 소속 길드의 참가비·고정 상금·오늘 횟수와 모집/진행/정산 상태. `/마블판`: 현재 차례·선택과 최신 참가자/16칸 게임판. `/마블가이드`: 별도 전체보기 규칙.
- 길드마스터·부길드마스터는 `/마블시작`으로 모집을 연다. 현재 길드원인 기존 부길마 목록의 최대 2명만 인정한다. `/마블참가비 숫자`(1~10억 포인트), `/마블모집취소`, `/마블중단`은 길드마스터만 실행한다. 운영자 MASTER는 길드 역할을 대신하지 않으며, 모집을 연 사람도 직접 `/마블준비`해야 플레이한다.
- `/마블준비`, `/마블준비취소`: 같은 길드 4명 모집. 네 번째 준비 시 소속·잔액을 전원 재검증하고 실제 시작 때만 참가비와 길드 일일 이용 횟수 차감. 실패자는 준비 해제하며 나머지는 유지.
- `/마블굴리기`, `/마블구매`, `/마블건설`, `/마블통과`: 본인 차례와 단계에 맞는 정확한 명령만 실행. 부족해도 구매/건설 대기는 자동 진행하지 않는다. 추가 안내 문구/인수는 실행하지 않는다.
- 정확한 `ㅁㅂ`, `ㅁㄱ`, `ㅁㅌ`는 굴리기·구매/건설·통과 별칭이다. `ㅁㄱ`는 앞뒤 공백을 제외한 전체 일치만 허용하고 BUY/BUILD 대기에 따라 기존 구매/건설 처리로 연결한다. 필터·제재·영지전 잠금·출석 조건과 DEV 격리·쓰기 잠금을 유지한다.
- 기본 통행료는 땅 가격 200/300/400에 각각 75/120/150골드, Lv2는 3배다. 구매·건설비는 유지한다. 행운 두 칸은 항상 +100골드이며 추가 추첨하지 않는다. 기회는 기존 50% +200/-100골드다.
- 4명 순서는 시작 시 무작위, 골드는 1,000/1,020/1,030/1,040. 10라운드 홀수 정순·짝수 역순, 탈락자 예정 차례 제외. 통행료·이벤트 손실로 골드가 부족하면 잔액만 지급하고 파산하며 땅 초기화. 정확히 0골드는 생존.
- 생존자 1명 또는 40번째 예정 차례 완료 시 종료. 생존자는 골드+지역/건설 원가 총자산순, 동점 생존자만 추첨, 탈락자는 먼저 탈락한 순서로 하위 순위. 참가비 총액의 10% 수수료를 제외한 풀을 40/30/20/10% 지급(참가비 별도 반환 없음).
- `/마블중단확인`: 길드마스터 중단 요청 후 실제 4명(탈락자 포함)이 전원 동의해야 전액 환급. 횟수는 유지. 유효 진행만 동의 취소, 잘못된 입력·중복 동의는 미변경.
- 길드 기준 KST 하루 7회, 개인 별도 제한 없음. 기존 5회 이용 기록을 유지하며 남은 2회를 추가로 사용할 수 있다. 모집·취소·시작 실패는 횟수를 쓰지 않으며 실제 경기 시작만 계산한다. 이용권 기능은 사용자 요청으로 보류했다. 진행 방 고정, 시작 당시 계정 ID로 닉변·탈퇴/추방 후에도 진행/정산. 시계 자정만으로 종료하지 않으며 실제 일일 `/리셋` 실행 시 전체 길드 세션을 종료한다. 타이머·자동 넘김 없음.

## Helpers and Data

- `requireGuildMarbleStore`, `isGuildMarbleRecruiter`, `executeGuildMarbleRequest`, `startGuildMarbleGame`, `rollGuildMarbleDice`, `chooseGuildMarbleLand`, `advanceGuildMarbleTurn`.
- `prepareGuildMarbleSettlement`: 확정 순위/금액을 한 번 저장. `settleGuildMarbleGame`: 기존 `buildServerRaidAccountIndex`의 내부 ID로 미지급만 처리. `finishGuildMarbleGame`: 상세 정리, 최소 마지막 지급 기록 유지.
- `buildGuildMarbleMessage`, `buildGuildMarbleProgress`, `buildGuildMarbleFooter`: 진행 안내·참가자 현황과 게임판을 두 메시지로 분리. 첫 메시지는 참가자 현황 제목 아래부터 `allsee`, 둘째는 현재 길드마블 상황 제목 아래부터 `allsee`로 16칸 표시. `replyGuildMarbleSafely`가 각 메시지를 순서대로 전송하며 개별 실패가 확정 저장을 취소하지 않는다. 모집·가이드는 기존 한 메시지. 정산 대기는 실제 지급 표시, 완료 출력은 최종 게임판 포함.
- 현재 차례·가능한 행동은 진행 안내 하단에 한 번 표시한다. 선택 대기에는 이동한 사람을 유지하고 잔액 부족 시 통과만 안내한다. 진행/정산의 반복 이용횟수·가이드 안내를 제거하고 게임판 소유자도 참가자와 같은 닉네임으로 표시한다. 이동 설명과 실제 금액 결과는 구분하며 부족 통행료에는 실제 지급액·부족액·파산만 표시한다. 가이드는 전체 규칙과 7회·별칭·부길마 시작 권한을 안내한다.
- 파산 시 확정 순위/참가자 → 이동/지역 주인 → 통행료·실제 지급·부족액 → 잔액/반환 지역/상금 시점 → 실제 라운드 전환·다음 행동 순으로 구분한다. 보유 지역 0곳은 별도 문구, 참가자 현황도 확정 순위를 표시한다. 파산 후 종료되면 기존 최종 정산을 출력하며 다음 행동 안내를 붙이지 않는다. 정확히 0골드 생존 규칙과 통행료/상금 계산은 유지한다.
- 소형 파일 `guildMarble.json`: 길드별 설정·KST 횟수·현재 경기·최소 마지막 거래. 지난 턴/메시지 이력 누적 없음.
- 기존 `member.serverRaidAccount.id` 재사용. 아직 ID 없는 회원은 첫 준비에 기존 계정 형식으로 한 번 발급하며 별도 공개 식별자/콜백 인수를 요구하지 않는다.
- `getGuildMarbleRankLabel`은 기존 채크랭크를 재사용하되 추방/삭제된 길드 참조는 표시용 사본에서만 제외해 조회 중 회원 정리·저장을 막는다.

## Save Flow

- 기존 7인수 `response`와 쓰기 흐름 잠금 사용. 회원/펫/길드 조회 후 순수 함수에 전달. 일반 턴은 `writeMemberSplitSlot`으로 경기 파일만 저장. 조회·잘못된 입력은 저장 없음.
- `resetGuildMarbleGames`는 이미 로드한 전체 길드 저장소와 회원/계정 인덱스를 받아 모집 취소, 진행 경기 전액 환급(수수료 없음), 기존 확정 정산의 미지급분 처리를 구분한다. 리셋 권한과 길드 일일 횟수는 유지한다. 지급 불가 경기는 SETTLING으로 보존하고 실제 종료/취소/대기 건수를 표시한다. `/리셋`은 DEV 포함 배타 쓰기 잠금을 사용한다. 리셋 진입부에서 기존 `guildMarblePending.json` 형식으로 원래 회원 원문과 종료 의도가 확정된 정산 대기 원문을 먼저 보존한다. 회원·경기·일일 초기화 게시 사이 중단 후에도 이전 PLAYING을 복원하지 않고 미지급만 재처리한다. 호월주사위 진행과 연승은 삭제하지 않는다. `tools/minigame_updates_validation.md` 참조.
- 참가비·상금·환급(초기 계정 ID 발급 포함)은 `guildMarblePending.json`에 회원/경기 원문 보존 → 기존 `saveJsonFile` 회원 저장 → 경기 게시 → 복구 기록 해제. 다음 명령에서 중단 게시를 먼저 원문 복구. 기존 회원 분리 상세/운영 로그 슬롯 변경은 차단한다.
- 정산 순위는 지급보다 먼저 확정하고 재시작·미처리 재시도에서 재추첨/중복 지급하지 않는다. 정산 대기 중 새 모집/환급 전환 차단. 응답 전송 실패는 확정된 저장을 되돌리지 않는다.
- 정산 재시도는 원래 방의 길드마스터·부길드마스터 `/마블시작` 또는 기존 참가자 `/마블굴리기`(별칭 포함)만 허용한다. 탈락·탈퇴 참가자도 재시도 가능하며, 그 외 명령·잘못된 수량·권한 없는 입력은 순위·포인트·파일을 변경하지 않는다. 명령별 권한과 참가비 범위 검사는 정산 분기보다 먼저 적용한다.
- 파일은 `resolveActiveDataPath`로 PROD `/sdcard/호이랜드/`와 DEV `/sdcard/호이랜드_dev/` 분리. 존재하는 잘못된 저장소를 새 빈 경기로 대체하지 않는다.

---

# /초기화 · 번호 선택 · 1삭제 / 2취소

Status: VERIFIED

## Files

- `main.js`: `GLOBAL_CONFIG.manualReset.entries`의 32항목 중 개인 미니펫 전적은 직접 명령으로 분리하고 운영 초기화·정리 31종을 통합한다.
- `Info.js`: 메뉴·번호·최종 확인 입력에서 중복 처리하지 않는다.

## Behavior

- `/초기화` → 현재 역할로 허용된 번호 목록 → 번호 선택 → 대상·범위 안내 → 정확히 `1삭제` 또는 `2취소`.
- `GLOBAL_CONFIG.manualReset.rooms`의 정확한 서버관리자/기존 `testRoom` 팻 테스트방에서만 운영 초기화 31종의 메뉴·구형 안내·후속 처리를 실행한다. 그 외 방은 읽기·응답·대기 변경·삭제 전에 반환한다. 허용 방에서도 현재 역할이 없으면 `⛔ 사용 권한이 없습니다.`만 출력한다. `Info.js`는 동일 운영 명령 목록을 진입 전 반환한다.
- 글자수 전체 정리·필터 데이터 정리는 `[정리]`로 표시하며 기존 정리 기준과 범위를 안내한다. 두 운영방 제한과 기존 항목별 역할을 모두 적용한다. GM 관리자방·주문기록방의 권한만으로 운영 초기화에 진입할 수 없다.
- `/글자수전체정리`는 정확히 직접 입력하면 확인 메뉴 없이 기존 권한·정리 기준으로 즉시 실행한다. `/초기화`의 글자수 정리 항목과 `1삭제`·`2취소` 절차도 함께 유지한다. 이 예외는 다른 초기화·필터 정리 명령이나 접미사 입력에 적용하지 않는다.
- 대상을 지정하는 항목은 `번호 아이디`, `번호 아이디 횟수`, `번호 서버` 형식으로 선택한다. 서버는 기존 호1~7·벨1~2·GM·서버장만 허용한다.
- 기존 수동 초기화 명령과 두 신규 별칭 `/댓글초기화`, `/피드초기화`는 직접 입력하면 메뉴 안내만 출력한다. 원래 실행 분기는 최종 확인을 소비한 응답에서만 재사용한다. 접미사·설명 문구로 즉시 실행할 수 없다.
- 대기는 사용자·PROD/DEV·방·그룹 여부에 묶인다. 각 선택 단계의 유효기간은 60초이며 만료 시 다음 입력에서 취소 안내한다. 재컴파일·재시작은 모든 대기를 없앤다.
- 번호 목록은 세션별 권한에 맞춰 생성한다. 선택·확인 때 권한을 다시 검사하고 기존 실행부의 자원·출석·대전·장소 조건도 유지한다. 길드 게시판은 소속 길드가 바뀌면 취소한다.
- 본인 `/미니펫전적초기화`는 운영 메뉴/구형 안내에서 제외하여 기존 일반방·아이템 소모 기능으로 직접 실행한다. 개인 개별 피드/댓글 삭제도 그대로다. `/피드전체삭제`와 길드 게시판 일괄 초기화는 운영방에서 기존 패스/길드 역할을 유지한다. 마스터 명단 초기화는 MASTER 전용이다.
- 일반 숫자는 해당 사용자·방의 메뉴 대기가 있을 때만 선택으로 처리한다. 메뉴 관련 입력은 필터 자기 차단에서 제외한다.
- `/리셋`, `/주기리셋`, notice.js 알림 운영과 개인 가방 정리·개별 미니펫/가구/펜던트 정리는 그대로다. 메뉴 외 직접 운영 `/글자수전체정리`, `/데이터정리`, `/경매초기화`, `/계삭진행`, `/계정잠수삭제`도 두 운영방·기존 역할 검사와 쓰기 잠금을 적용하며 기존 실행/확인 절차를 유지한다.

## Related Helpers

- `isManualResetRoom`, `getManualResetSessionKey`, `getManualResetDirectOperation`, `getManualResetLegacyEntry`, `isManualResetLegacyCommand`, `isManualResetInput`: 운영방·직접 예외·개인 제외·환경/사용자/방/그룹별 대기·입력 분류.
- `isManualResetEntryAllowed`, `advanceManualResetSession`: 파일 IO 없는 역할 검사·메모리 선택/확인·1회 실행 연결.
- `resetAllPetHomeContent`: 이미 로드한 댓글 또는 피드 및 같은 종류의 알림만 초기화한다. 파일 IO 없음.

## Save Flow

- 메뉴·선택·취소·만료는 저장하지 않는다. 실제 댓글/피드 삭제는 진입부에서 대상 파일과 활동 파일을 각각 로드하고 변경 파일만 기존 `saveJsonFile`로 저장한다. 작업 전 스냅샷·기존 백업·명령 트랜잭션으로 실패를 원복한다.
- 전체 댓글은 일반·픽 댓글과 댓글 알림, 전체 피드는 피드·이전 한줄평과 피드 알림을 제거한다. 포인트·가구·방문 기록·좋아홈·소셜 누적 통계·기존 guestComments는 유지한다.
- 미리보기 건수와 실제 삭제 건수는 다를 수 있다. 삭제 직전에 최신 데이터를 다시 읽는다. 완료 응답 실패는 확정 삭제를 취소하지 않으며 재실행은 남은 항목만 처리한다.
- 신규 두 파일 작업의 앱 강제 종료 원자성은 기존 저장 방식과 같다. 재시작 시 확인은 취소되며 새 메뉴 확인으로 남은 항목을 정리할 수 있다.
- `tools/test_reset_menu.js`, `tools/test_reset_menu_rhino.js`, `tools/reset_menu_validation.md` 참조.
- 메뉴에서 선택한 운영 정리 2종은 최종 확인 후 원래 실행 분기로 연결하며 정리 계산·저장 본문은 유지한다. 메뉴·선택은 정리 대상 파일을 읽지 않고, 확인 시 최신 데이터·가방 한도·필터로 실행한다. 별도 `/글자수전체정리` 직접 입력도 동일한 최신 데이터 정리 분기를 사용한다. `tools/test_reset_cleanup_menu.js`, `tools/test_reset_cleanup_rhino.js`, `tools/test_filter_data_cleanup.js`, `tools/reset_cleanup_validation.md` 참조.

---

# /필터추가, /필터제거, /필터리스트

Status: VERIFIED

## Files

- `main.js`: 관리 명령과 게임 명령 차단
- `Info.js`: 조회 명령 차단

## Related Helpers

- `readMessageFilterWords`, `setMessageFilterCache`, `getCachedMessageFilterWords`
- `getMessageFilterRequest`, `containsMessageFilterWord`
- `isMessageFilterCommandInput`, `changeMessageFilterWords` (Main)

## Behavior

- `/필터추가 단어1,단어2`, `/필터제거 단어1,단어2`. 기존 방별 관리자·MASTER 권한으로 관리한다.
- `/필터리스트`: 같은 관리 권한으로 현재 환경의 메모리 목록을 등록 순서·번호와 함께 표시한다. 상단은 `현재 등록: 100/300개` 형식이며 분모는 등록 상한 설정값을 사용한다. 빈 목록도 `0/300개`로 안내하고 파일 읽기·저장 없이 조회한다. Info는 중복 응답하지 않으며 목록 명령 자체는 필터 자기 차단에서 제외한다.
- 쉼표로 나누고 앞뒤 공백·중복을 제거한다. 빈 구간이 있으면 전체 요청을 저장하지 않는다. 인자 없이 입력하면 사용법과 현재 목록을 안내한다.
- 등록 상한은 DEV/PROD 각각 300개(`GLOBAL_CONFIG.messageFilter.maxWords`). 중복 제외 후 실제 신규 등록으로 상한을 넘으면 요청 전체를 거절하고 파일·캐시를 바꾸지 않는다. 중복 추가는 무변경이며 제거는 계속 허용한다. 기존 초과 목록을 자동 삭제하거나 로드 오류로 처리하지 않는다.
- 문구 안의 띄어쓰기는 유지한다. 제거는 쉼표로 구분한 각 문구와 완전히 같은 등록 항목만 삭제한다.
- 슬래시 명령과 기존 단축·확인 명령만 비교한다. 일반 대화는 목록 조회·단어 비교를 건너뛴다.
- 등록 문자열이 명령 전체에 포함되면 응답 없이 처리 중단. 대소문자를 구분하며 정규식으로 해석하지 않는다.
- 관리 명령은 자기 차단을 피하기 위해 필터 비교에서 제외한다. 관리 권한은 그대로 검사한다.

## Data Usage / Save Flow

- 환경별 `member.json.messageFilterWords` 선택 필드. 기존 데이터에 필드가 없으면 빈 목록이며 손상된 값은 오류 처리한다.
- 컴파일 시 기존 회원 로드 결과와 DEV 초기 데이터에서 목록을 구성한다. 매 명령마다 필터 파일을 다시 읽지 않는다.
- 실제 추가·제거 시 진입 흐름에서 회원을 읽고 기존 `saveJsonFile`로 저장한 뒤 캐시를 갱신한다. 중복 추가·미등록 제거는 저장하지 않는다.
- Main이 Java System 환경별 공유 속성에 게시하고 Info는 변경 시에만 재해석한다. Main 변경은 Info 재컴파일 없이 반영된다.
- DEV/PROD 목록은 분리한다. 기존 DEV 백업 완료 시 복사한 목록으로 DEV 캐시를 갱신한다.
- 파일을 직접 편집한 경우 Main을 재컴파일해야 한다. Main과 Info 변경은 함께 배포해야 한다.
- `/데이터정리` 및 기존 댓글 데이터 삭제는 이번 작업에 포함하지 않는다.

---

# /필터데이터정리

Status: VERIFIED

## Files

- `main.js`: `/필터데이터정리` 직접 입력은 `/초기화`를 안내한다. 메뉴에서 필터 데이터 정리를 선택하고 `1삭제` 확인 시 기존 방별 관리자·MASTER 권한으로 원래 처리 분기를 실행한다.
- `Info.js`: 같은 명령은 데이터 읽기 전에 반환하여 중복 처리하지 않는다.

## Related Helpers

- `cleanupMessageFilterData`: 이미 읽은 저장소에 삭제 계획을 적용하고 종류별 개수·파일 변경 여부를 반환한다. 파일 IO 없음.
- `getCachedMessageFilterWords`, `containsMessageFilterWord`: 현재 환경의 등록 문구를 실행 시점에 고정해 기존 문자열 포함 규칙으로 비교한다.

## Data Usage / Save Flow

- 일반·픽 댓글의 `text`, 홈 `feeds[*].content`와 이전 한줄평 `comment`, 일반·펫 타이틀 `title.list[*].name`, 댓글·피드 홈알림의 `commentPreview`·`feedContent`만 비교한다.
- 전체 사용자가 대상이며 작성자·닉네임·가격·방문·소셜 통계·가구·기존 `guestComments`·포인트는 삭제 조건으로 사용하지 않는다.
- 삭제된 타이틀을 장착 중이면 해제하며 남아 있는 장착 타이틀의 번호를 보정한다. 잘못된 기존 장착 번호는 해당 목록이 실제로 줄어들 때만 해제한다.
- `petHomeComments.json`, `petSweetHomeData.json`, `member_title.json`, `pet_title.json`, `petHomeActivityData.json`을 진입부에서 각각 한 번 로드하고 모두 처리한 뒤 변경 파일만 기존 `saveJsonFile`로 저장한다. 실패 시 기존 명령 트랜잭션과 작업 전 스냅샷으로 원복한다.
- 메뉴·선택 시 정리 파일을 읽지 않으며 확인 시 필터가 비어 있어도 정리 파일을 읽지 않는다. 메뉴 공통 회원·길드 검사는 유지한다. 재실행 시 이미 제거된 항목은 재삭제하지 않으며 변경 없으면 저장하지 않는다. 손상·누락·파싱 오류는 중단하며 빈 파일로 덮지 않는다.
- 배타 쓰기 잠금을 사용하고 DEV/PROD 저장 경로와 필터 목록은 분리한다. 필터에 관리 명령 문구가 있더라도 권한 있는 관리자는 정리할 수 있다.
- 기존 `/데이터정리` 동작과 백업 파일은 유지한다. 강제 앱 종료의 여러 파일 동시 원자성은 기존 트랜잭션과 동일하며, 중단 후 재실행은 남은 항목만 처리한다.

---

# 권한 타이틀뱃지

Status: VERIFIED

## Files

- `main.js`
- `Info.js`

## Related Helpers

- `getAuthorityTitleBadge`
- `getInfoAuthorityTitleBadge`
- `getHoiPassPremiumHeader`
- `getInfoHoiPassPremiumHeader`
- `buildAttendanceCompleteMessage`

## Data Usage

- `data.master`
- `data.admin`
- 호이패스 프리미엄의 현재 활성 상태

## Save Flow

- 현재 권한 명단을 읽어 마스터에게 `[🎮호월GM]`, 관리자에게 `[🎖호월관리자]`를 표시한다. 겸직자는 마스터 뱃지만 표시한다.
- 권한 뱃지를 별도로 지급·저장하지 않는다. 기존 프리미엄 표시보다 위에 출력하며 프리미엄이 없어도 권한 뱃지를 표시한다.

---

# /성장오픈소 숫자, /성장오픈중 숫자, /성장오픈대 숫자

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `getGrowthPotionConfig`
- `prepareGrowthPotionUse`
- `processAdventureLevelUps`
- `buildAdventureLevelUpMessage`
- `checkRank`

## Data Usage

- `data.member[sender].bag[정식 성장물약 이름]`
- `data.member[sender].exp`, `lv`, `point`

## Save Flow

- 수량·보유량·EXP·포인트 범위를 검증한 복사본에 아이템 차감과 레벨업을 적용한 뒤 `member.json`을 한 번 저장하고 다시 읽어 검증한다.
- 잘못된 입력, 미보유, 수량 부족, 처리 범위 초과에서는 저장하지 않는다. 티어 보너스와 가호는 적용하거나 차감하지 않는다.

---

# 1:1톡 패스 접근 제한

Status: VERIFIED

## Files

- `main.js`
- `Info.js`

## Related Helpers

- `hasActiveHoiOrNewbiePass`
- `recordBlockedPrivateChatAttempt`
- `hasExpiredHoiPassForPrivateChat`
- `buildExpiredHoiPassPrivateChatMessage`
- `buildNoHoiPassPrivateChatMessage`
- `getBlockedPrivateChatNoticeKind`
- `hasInfoPrivateChatPass`
- `isSupportPassActive`
- `isInfoSupportPassActive`

## Data Usage

- `data.member[user].pass.newbie`
- `data.member[user].pass.hoi`
- `data.member[user].pass.premium`

## Save Flow

- 패스 상태를 읽기만 하며 데이터를 변경하거나 저장하지 않는다.

## AI Notes

- 그룹채팅은 기존 명령어 흐름을 유지한다.
- 1:1톡은 활성 초보패스·호이패스·호이패스 프리미엄이 없으면 `main.js`와 `Info.js` 모두 명령 실행 전에 반환한다. 단, `main.js`의 홈뱃지 조회·장착·해제·삭제·큐브·확률 명령은 패스 없이도 실행한다.
- `main.js`는 패스 없는 1:1 입력의 유저별 차단 횟수를 메모리에 누적하며, 3회 단위마다 `room90`에 사용자·방·횟수·최근 메시지를 알린다. 패스 미가입자는 차단 때마다 1:1 이용 제한 안내를 받고, 호이패스 또는 프리미엄 이용기간이 지난 유저는 기존 감지 건에서 1:1 종료 안내를 받는다.
- `Info.js`는 별도 응답과 카운트 증가 없이 실행만 차단한다.
- 1:1톡 차단 횟수는 파일에 저장하지 않아 봇 재시작 시 초기화된다.
- `main.js`의 DEV 데이터 백업과 봇 복구 명령은 기존 비상 복구 흐름을 유지한다.

---

# /채팅경험치확인 대상닉네임

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `getChatExperienceQueryTarget`
- `handleDailyChatExperienceQuery`
- `buildDailyChatExperienceStatusMessage`
- `getAttendanceKstDateKey`
- `hasAttendedToday`

## Data Usage

- `data.member[대상].chatExperienceDaily.date`
- `data.member[대상].chatExperienceDaily.experience`

## Save Flow

- 관리자·MASTER가 한국시간 오늘의 채팅 EXP 누적량과 1,000 EXP 한도, 남은 수량을 읽기만 한다. 대상 닉네임의 공백을 허용하며 데이터는 변경하거나 저장하지 않는다.

---

# /로열오픈

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/로열오픈`

## Files

- `main.js`

## Related Helpers

- `hasItem`
- `removeItem`
- `addItem`
- `initSweetHomeUser`
- `createCuId`
- `sortFurnitureList`

## Data Usage

- `data.member[sender].bag["[🏡가구]로열패키지 확정(/로열오픈)"]`
- `homeData[sender].furnitureBag`
- `GLOBAL_CONFIG.guaranteedPackage.royal`

## Save Flow

- 가구 보관함 32칸을 먼저 확인하고 패키지 1개를 소모해 `고대서적📘(+140,000💕)[로열 루미에르]` 1개를 지급한다.
- 성공 시 `homeDataFile`과 `filePath`를 저장하며, 저장 실패 시 지급 가구 제거와 패키지 복원을 시도한다.

## AI Notes

- Exact command guard: `/로열오픈`.
- 패키지가 없거나 보관함이 가득 찬 경우 데이터는 변경하지 않는다.

---

# /창세오픈

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/창세오픈`

## Files

- `main.js`

## Related Helpers

- `hasItem`
- `removeItem`
- `addItem`
- `refreshMiniPetSortIndex`

## Data Usage

- `data.member[sender].bag["[🐹미니펫]창세등급 확정(/창세오픈)"]`
- `petData[sender].miniPetBag`
- `GLOBAL_CONFIG.guaranteedPackage.creationRewardBox`

## Save Flow

- 현재 미니펫 가방 한도(일반 10칸, 프리미엄 15칸)를 먼저 확인하고 보상상자 1개를 소모해 `호이똥💩(+990,000💞)[창세]` 1마리를 지급한다.
- `memberPetPath`와 `filePath`를 기존 명령 저장 트랜잭션 안에서 저장한다. 저장 실패 시 기존 트랜잭션 롤백 흐름을 따른다. 성공 안내는 두 저장이 완료된 뒤 출력한다.

## AI Notes

- Exact command guard: `/창세오픈`.
- 보상상자가 없거나 보관함이 가득 찬 경우 데이터는 변경하지 않는다.
- `/패키지추가`의 `item:[🐹미니펫]창세등급 확정(/창세오픈):수량` 구성품으로 등록 가능하다. `/패키지지급` → `/패키지가방` → `/패키지사용` → `/가방` → `/창세오픈` → `/미니펫가방` 흐름을 사용한다.
- 창세 기존 이름은 `[🐹미니펫]창조패키지 확정(/창세오픈)`이며, 이전 개발 이름 `[🐹미니펫]창조보상상자(/창세오픈)`도 호환한다.
- 기존 `/창조오픈`은 `GLOBAL_CONFIG.guaranteedPackage.genesis`의 신규 `[🐹미니펫]창조등급 확정(/창조오픈)` 또는 기존 `[🐹미니펫]창조패키지 확정(/창조오픈)`을 소모해 `호이빛💖(+1,350,000💕)[창조]`를 지급한다.
- `getOwnedMiniPetRewardBoxItem`은 기존 이름을 먼저 조회하고 한 번에 보유 아이템 한 종류에서 1개만 차감한다. 보유분을 일괄 변환하지 않는다.
- `normalizeMiniPetRewardBoxItemName`으로 기존 패키지 구성품도 새 이름으로 지급하며, 기존 패키지 정의·보유 수량은 덮어쓰지 않는다.
- 신규 미니펫은 보상상자로 확정 지급하며 기존 랜덤 뽑기 목록·확률은 변경하지 않는다.

---

# /글자수통계

Status: VERIFIED

## Files

- `main.js`

## Data Usage

- `filePath`
- `homeDataFile`
- `petHomePlacedFurniturePath`
- `memberPetPath`
- `petSkillDataPath`
- `memberTitlePath`
- `petTitlePath`
- `miniPetTitlePath`
- `miniPetCollectionPath`
- `trialTowerPath`
- `petExplorePath`
- `guildPath`
- `attendanceLightPath`
- `boardPath`
- `freeMarketPath`

## Save Flow

- Read-only command. It reads active DEV/PROD-resolved files through `resolveActiveDataPath` and does not save data.

## AI Notes

- Master operator `호이 남` only.
- 출력 항목은 멤버, 펫홈, 장착가구, 펫멤버, 펫스킬, 펜던트, 회원칭호, 펫칭호, 미니펫칭호, 미니펫도감, 시련의탑, 펫탐험, 길드, 경량출석, 게시판, 자유시장이다.
- 각 항목은 JSON 문자열 길이와 파일 구조에 맞춰 중복 제거한 유저 수를 함께 표시한다.
- 출력은 핵심 데이터, 칭호·성장 데이터, 운영 데이터 구역으로 나눠 표시한다.
- 펜던트 글자수와 유저 수는 `member_pet.json`에서 `pendant`와 `pendantBag` 데이터가 있는 유저만 추출해 계산한다.
- 연결된 동기화 명령어가 있으면 해당 항목 바로 아래 줄에 `/장착가구동기화`, `/펫데이터동기화`, `/펫타이틀동기화`, `/시련의탑동기화`, `/길드데이터동기화`, `/전체동기화`를 표시한다.

---

# /캐슬대전

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/캐슬대전`

## Files

- `main.js`

## Related Helpers

- `hasPetSkill`
- `getRandomScore2`
- `setCastleBattleTier`
- `ensureCastleBattleRecord`
- `difftypeBuff`
- `calculateCriticalDamage`
- `calculateCastleItem`
- `calculateItemInfoAll`
- `calculatePendantItemInfo`
- `buildBattleExperienceRewardMessage`

## Data Usage

- `data.member[sender].battle`
- `data.member[sender].point`
- `data.member[sender].exp`
- `petData[sender].petexp`
- `petData[*].pendant`
- `castleBattleData`

## Save Flow

- Saves `castleBattleData` through `saveJsonFile(castleBattleData, castleBattlePath)`
- Saves member data through `saveJsonFile(data, filePath)`
- Saves pet data through `saveJsonFile(petData, memberPetPath)` so `숙련된 전사` pet charm gain is persisted

## AI Notes

- `숙련된 전사` adds pet charm only after matching and ticket validation pass; keep `memberPetPath` save in this command flow when changing castle battle rewards.
- `/캐슬대전` 장비 매력 계산은 `calculateItemInfoAll(...).castleExp`를 사용해 펜던트 캐슬 매력을 함께 반영한다.
- `/캐슬대전` 미니펫 매력 계산은 `/펫정보`와 맞게 `getMiniPetModeCharm`으로 대표 100%와 보조 50%를 합산한다.
- 양측 모두 `calculateCastleExp`로 전체 캐슬매력을 계산해 장비·미니펫·홈·친밀도·일반/티어 전용 펫스킬을 동일하게 반영한 뒤 상성·크리티컬을 적용하며, 동률이면 방어자가 승리한다.
- 출력 상단에는 대전횟수·리셋권, 경험치, 승패와 대전 상대를 먼저 표시하고 `데일리 캐슬대전 상세결과`부터 `allsee`로 접는다. 상세 영역은 공격·방어 펫 외형, 속성, 캐슬/상성/최종 매력, 크리티컬, 비교식, 매력 차이와 기존 CP·보상을 유지한다.
- 캐슬대전 경험치는 승리 100 EXP, 패배 25 EXP이며 기본 EXP에 현재 티어의 고정 EXP를 더한 뒤 호월신의 가호를 적용하고 레벨 상승을 처리하는 공통 경험치 흐름을 사용한다.
- 수동 캐슬대전에서 레벨업·승급·대승급이 발생하면 대전 결과 다음 메시지로 안내를 별도 출력한다. 자동일퀘에서는 기존 즉시 안내만 출력해 중복을 막는다.
- 카드 상단의 경험치 아래에 현재 공격 결과를 `✅ 승리` 또는 `❌ 패배`와 양쪽 사용자로 표시한다.
- When a command reads home/guild/pet data, also inspect the normalization helper listed in `Related Helpers`.
- `COMMAND_REGISTRY.md` is the human-facing command checklist. This file is the AI-friendly code navigation index.

## Shared Search Anchors

- `function response`
- `function loadJsonFile`
- `function saveJsonFile`
- `function generateBagOutput`
- `function initSweetHomeUser`
- `function buildMiniPetBagMessage`
- `function getMyGuildId`
- `function ensureGuildTerritoryWar`
- `function calculateTotalExp`

## Shared Data Files

- `filePath`: member data, runtime path `/sdcard/호이랜드/member.json`, repo snapshot `data/member.json`
- `memberPetPath`: pet and mini-pet data, runtime path `/sdcard/호이랜드/member_pet.json`, repo snapshot `data/member_pet.json`
- `guildPath`: guild data, runtime path `/sdcard/호이랜드/guildData.json`, repo snapshot `data/guildData.json`
- `homeDataFile`: sweet-home data, runtime path `/sdcard/호이랜드/petSweetHomeData.json`, repo snapshot `data/petSweetHomeData.json`
- `petHomePlacedFurniturePath`: placed furniture detail data, runtime path `/sdcard/호이랜드/petHomePlacedFurniture.json`; created by `/장착가구동기화`
- `petHomeBeforeSplitBackupPath`: one-time pre-split backup, runtime path `/sdcard/호이랜드/petSweetHomeData_beforePlacedFurnitureSplit.json`
- `petSkillDataPath`: pet skill data, runtime path `/sdcard/호이랜드/petSkillData.json`, repo snapshot `data/petSkillData.json`
- `trialTowerPath`: trial tower data, runtime path `/sdcard/호이랜드/trialTower.json`, repo snapshot `data/trialTower.json`
- `castleBattlePath`: castle battle data, runtime path `/sdcard/호이랜드/castleBattle2.json`, repo snapshot `data/castleBattle2.json`
- `petTitlePath`: pet title data, runtime path `/sdcard/호이랜드/pet_title.json`, repo snapshot `data/pet_title.json`
- `memberTitlePath`: member title data, runtime path `/sdcard/호이랜드/member_title.json`, repo snapshot `data/member_title.json`
- `boardPath`: public letter board, runtime path `/sdcard/호이랜드/board.json`, repo snapshot `data/board.json`
- `carrotBoardPath`: carrot market board, runtime path `/sdcard/호이랜드/carrotBoard.json`, repo snapshot `data/carrotBoard.json`
- `freeMarketPath`: free-market listing/log data, runtime path `/sdcard/호이랜드/freeMarket.json`, repo snapshot `data/freeMarket.json`
- `hoiBotChangeLogPath`: bot change-log data, runtime path `/sdcard/호이랜드/hoiBotChangeLog.json`, repo snapshot `data/hoiBotChangeLog.json`
- `miniPetCollectionPath`: mini-pet collection data, runtime path `/sdcard/호이랜드/miniPet_collection.json`, repo snapshot `data/miniPet_collection.json`

## Runtime / Save-Flow Hotspots

- `/봇살리기` is handled before account-suspension and normal member-data loading, so an Admin/Master can restore `member.json`, pet data, pet skill data, and `petHomeActivityData.json` from their strictly parsed recovery snapshots.
- `response(...)` uses a non-blocking data transaction `ReentrantLock`; when another response owns the transaction, the incoming response keeps the existing silent-drop behavior.
- `saveJsonFile(...)` backs up only an actually saved managed JSON (`member`, pet, pet skill, or pet-home activity), keeps two fixed last-known-good generations, then uses a path-specific `ReentrantLock`, verified UTF-8 temporary file, disk sync, and rollback rename for the original/backup files.
- A response-scoped save transaction preserves the first pre-command backup when the same managed file is saved repeatedly and automatically rolls back already-saved managed files in reverse order when command processing fails.
- `writeVerifiedJsonFile(...)` reuses an already verified write only inside the same healthy response transaction, with backup rotation already skipped and identical serialized text rechecked against the current target under its path lock. The first save, changed/missing/different target, explicit backup rotation, and rollback still write normally. Reuse state ends with the transaction; member files, split stores, and recovery journals are excluded. `tools/test_command_save_reuse*.js` covers parity, failures, restart, DEV/PROD, Java threads, and actual-file timing.
- `loadJsonFile(...)` strictly validates managed JSON and restores only the damaged original from the newest valid first- or second-generation backup; recovery success or failure is reported to the GM admin room, and if both backups are invalid the existing error flow remains visible.
- `/데이터상태` reads the original and both backup generations for all four managed JSON files without modifying them; `/데이터복구 [파일] [1|2]` restores only the selected file from the explicitly selected validated backup generation.
- Account-suspension checks reuse the already loaded member object in the common response flow instead of loading `member.json` twice.
- Slash-prefixed commands no longer perform an unconditional four-file backup before execution; managed JSON is backed up immediately before that specific original is actually saved.
- `main.js`: main `response(...)` entry point for almost all mutable gameplay commands
- `Info.js`: info/query-oriented `response(...)` entry point
- `main.js`: `loadJsonFile(path)` resolves DEV/PROD path via `resolveActiveDataPath(path)` and parses UTF-8 JSON through `parseJsonContent(...)`
- `main.js`: `saveJsonFile(data, path)` resolves DEV/PROD path, ensures parent folders, and writes UTF-8 JSON
- `Info.js`: separate `loadJsonFile(path)` implementation used by info commands
- `main.js`: production/DEV root constants and major runtime data-file constants

## DEV / PROD Path Rules

- `main.js` creates a command context with `createCommandContext(isDevCommandMessage(msg))` near the top of `response(...)`
- DEV-prefixed messages are normalized through `stripDevCommandPrefix(msg)` before regular command branching continues
- Both `loadJsonFile(...)` and `saveJsonFile(...)` pass through `resolveActiveDataPath(...)`, so save-flow verification should check path resolution rather than only literal file constants
- `dev/데이터백업` is gated early in the main response flow and is the canonical bootstrap path when DEV files are missing; transient `.tmp` files are excluded from backup and required-file checks
- `/데이터상태` and `/데이터복구` follow `resolveActiveDataPath(...)`; normal commands target production and `dev/` commands target DEV data.
- If a command looks read-only but still writes, inspect whether it sanitizes or normalizes data before display

## Core Helper Hotspots

| Helper | Anchor | Why it matters |
| --- | --- | --- |
| `generateBagOutput` | `main.js`, `Info.js` | Canonical bag numbering and text renderer |
| `isRegisteredHomeMember` | `main.js` | Checks that a user exists in `member.json` before pet-home data can be created from commands |
| `initSweetHomeUser` | `main.js`, `Info.js` | Normalizes home/sweet-home user state before access |
| `getHomeTotalExp` | `main.js`, `Info.js` | Home ranking and profile summary calculation |
| `buildMiniPetBagMessage` | `main.js` | Main mini-pet bag formatter and viewer/target split |
| `initPetSkillUser` | `main.js`, `Info.js` | Normalizes pet-skill storage before use |
| `getPetSkillSlotCount` | `main.js`, `Info.js` | Slot-count source for pet-skill display/equip rules |
| `calculateTotalExp` | `main.js`, `Info.js` | High-value aggregate formula for user progression/rank output |
| `getMyGuildId` | `main.js`, `Info.js` | Fastest guild membership lookup anchor |
| `getMyGuildInfo` | `main.js`, `Info.js` | Guild object + sender membership validation hub |
| `getJoinableGuildRows` | `main.js` | Joinable guild filtering and listing logic |
| `findGuildIdByNameSafe` | `main.js` | Safer guild-name-to-id resolution |
| `ensureGuildWarehouseObj` | `main.js` | Warehouse/fund branches should usually pass here first |
| `ensureGuildTerritoryWar` | `main.js` | Canonical territory-war state normalizer |
| `ensureGuildBoard` | `main.js` | Guild board schema normalization |
| `buildGuildRankingRows` | `main.js` | Cross-store guild ranking aggregation |
| `syncMemberGuild` | `main.js` | Member/guild mismatch repair path |
| `trialTowerRanking` | `Info.js` | Ranking renderer for tower-related info output |
| `getMiniPetGradeStats` | `Info.js` | Aggregate mini-pet grade statistics |
| `getTitle` | `Info.js` | Member/pet title display helper used by info summaries |

## Command Family Hotspots

| Family | Primary files | Good first anchors |
| --- | --- | --- |
| Inventory / bag / trade | `main.js`, `Info.js` | `/가방`, `generateBagOutput`, `/당근`, `/구매` |
| Guild / territory / warehouse | `main.js`, `Info.js` | `/길드정보`, `/길드목록`, `/길드영지시작`, `ensureGuildTerritoryWar` |
| Mini-pet / collection | `main.js`, `Info.js` | `/미니펫가방`, `buildMiniPetBagMessage`, `/미니펫컬렉션등록`, `/미니펫컬렉션만능` |
| Pet skill | `main.js`, `Info.js` | `/펫스정보`, `initPetSkillUser`, `getPetSkillSlotCount`, `/펫스장착` |
| Sweet home / furniture | `main.js`, `Info.js` | `/가구가방`, `initSweetHomeUser`, `getHomeTotalExp`, `/가구순위` |
| Ranking / profile / info | `Info.js`, `main.js` | `/내정보`, `/정보 [닉네임]`, `/펫정보`, `calculateTotalExp` |
| Board / social / letters | `main.js` | `/게시판`, `/편지`, `boardPath`, `carrotBoardPath` |

## Quick Search Recipes

- Entry-point scan: `rg -n "function response|if \\(msg ==|msg\\.startsWith\\(" main.js Info.js`
- Save-flow scan: `rg -n "saveJsonFile\\(|loadJsonFile\\(" main.js Info.js`
- Guild scan: `rg -n "Guild|guild|영지" main.js Info.js`
- Mini-pet scan: `rg -n "miniPet|미니펫|컬렉션" main.js Info.js`
- Home scan: `rg -n "SweetHome|furniture|가구|homeData" main.js Info.js`
- Pet-skill scan: `rg -n "petSkill|펫스" main.js Info.js`

## Coverage Snapshot

- Current heuristic command-pattern count across `main.js` + `Info.js`: about `1010`
- This registry is strongest on representative high-traffic commands, helper anchors, and save-flow notes
- Mutation-heavy admin tooling still has broader coverage gaps than user-facing info commands
- `COMMAND_REGISTRY.md` is better for human usage/removal checks; this file is better for "where should I inspect first?" decisions

---

# !알림내용|!알림시작|!알림초기화|!알림정보|/알림리셋

Status: VERIFIED

## Command Anchors

- Search in `notice.js`: `!알림내용`, `!알림시작`, `!알림초기화`, `!알림정보`, `/알림리셋`

## Files

- `notice.js`

## Related Helpers

- `isNoticeCommand`
- `isNoticeOperator`
- `getNoticeContentArgument`
- `loadNoticeStateFromFile`
- `getNoticeState`
- `saveNoticeState`
- `broadcastNotice`
- `createNoticeScheduleToken`
- `createNoticeTimeout`
- `ensureNoticeRuntimeSchedule`
- `clearNoticeRuntimeSchedule`
- `replaceNoticeSchedule`
- `formatNoticeRemainingTime`
- `buildNoticeInfoMessage`

## Data Usage

- `/sdcard/호이랜드_notice/noticeData.json`
- `noticeState.content`
- `noticeState.scheduleActive`
- `noticeState.scheduleToken`
- `noticeState.nextRunAt`
- `noticeRuntimeSchedule`

## Save Flow

- `!알림내용 내용`은 줄바꿈을 유지한 본문을 독립 데이터 파일에 저장한다.
- 반복 예약의 활성 여부·실행 토큰·다음 발송 시각은 독립 데이터 파일에 저장하며 알림 내용 변경 시 다음 발송부터 새 본문을 사용한다.
- `!알림정보`는 현재 문구와 저장된 예약 상태·남은 시간을 조회하고, 재컴파일 뒤 새 실행 컨텍스트가 예약을 인계할 때 실행 토큰을 갱신해 이전 타이머를 무효화한다.
- `/알림리셋`은 실행 타이머를 해제하고 저장된 알림 문구·예약 상태·실행 토큰·다음 발송 시각을 초기화한 뒤 독립 데이터 파일을 한 번 저장한다.

## Notes

- `NOTICE_CONFIG.operators`에서 운영자 계정을, `NOTICE_CONFIG.targetRooms`에서 전체 발송 대상 방을 관리한다.
- 대상 방 발송과 반복 오류 보고는 기존 `noticeMsg`와 같은 `Api.replyRoom` 방식으로 처리한다.
- `!알림시작`은 즉시 1회 발송한 뒤 기존 예약 토큰을 무효화하고 하나의 70분 반복 예약만 유지한다.
- `!알림초기화`는 실행 중인 모든 반복 예약을 해제하고, 즉시 발송 없이 70분 뒤부터 하나의 반복 예약으로 다시 시작한다.
- `!알림정보`는 현재 저장된 알림 문구, 실제 저장된 반복 예약 상태, 다음 발송까지 남은 시·분·초를 표시한다.
- `/알림리셋`은 저장된 알림 문구를 삭제하고 실행 중인 반복 예약을 중지한다.

---

# /가방

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/가방`
- Alias: `ㄴㄴㄴ`
- Point visibility toggle: `/포인트잠금`

## Files

- `main.js`

## Related Helpers

- `generateBagOutput`
- `buildHoiPassPremiumBagMessage`
- `formatHoiPassPremiumBagExpiry`
- `isHoiPassPremiumActive`
- `getChuseokCarrotBalance`
- `checkRank`

## Data Usage

- `data.member[sender].bag`
- `data.member[sender].point`
- `data.member[sender].diamond`
- `data.member[sender].lv`
- `data.member[sender].exp`
- `data.member[sender].boostercnt`
- `data.member[sender].pass.premium`
- `data.member[sender].hidePremiumBagPoint`
- `petExploreData.chuseokEvent.active`
- `petExploreData.chuseokEvent.balances[sender]`
- `data.member[sender].bag["황금당근🌕(/황금당근오픈 숫자)"]`
- `data.adv`

## Save Flow

- 일반 조회는 데이터를 변경하지 않는다.
- 기존 만능열쇠 저장명 정규화가 필요한 경우에만 `member.json`을 저장한다.
- `/포인트잠금`은 프리미엄 전용 가방의 포인트 노출 설정을 토글하고 `member.json`을 한 번 저장한다.

## Related Commands

- `/가방속성`
- `/가방추가`
- `/당근`
- `/포인트잠금`

## AI Notes

- Primary read-only inventory output command
- Good entry point for bag item shape and numbering logic
- 프리미엄 전용 가방은 포인트 공개 상태에서 `/포인트잠금` 안내를 표시하고, 잠금 상태에서는 포인트를 `쉿 비밀🤫`로 표시한다.
- For bag item numbering, inspect `generateBagOutput` in `main.js`
- 활성 호이패스 프리미엄 이용자는 공지·후원 문구 없이 포인트, 다이아, 이벤트 기간의 황금당근, 봉인금고·열쇠, 모험가 칭호, 레벨·경험치 게이지, 부스터, 만료일을 상단에 표시하고 기존 정렬의 전체 아이템 목록을 `allsee` 뒤에 유지한다. 황금당근은 달토끼상점과 같은 이벤트 잔액을 표시하며 기존 가방 저장 잔액도 전환 전까지 합산한다. 프리미엄 가방의 레벨 영역에는 캐슬·레이드 보너스를 표시하지 않는다.
- 일반 이용자와 일반 호이패스 이용자는 기존 가방 공지·광고 출력을 유지한다.
- `main.js`와 `Info.js`의 특별 아이템 정렬에서 `자동일퀘권📝`은 `자동탐험권🌄` 바로 다음에 표시된다.
- `main.js`와 `Info.js`의 특별 아이템 정렬에서 `호이의 봉인금고` → `해방의 열쇠` → `자동탐험권` → `자동일퀘권` 순으로 먼저 표시한다.
- During the pendant transition, legacy `반지 강화석💍` remains separate; `generateBagOutput` must not show old quantities as `펜던트 강화석📿`.

---

# /미니펫추가 [아이디(2단어)] [이름] [이모지] [등급] [가격] [매력도]

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `addMiniPetToUserBag`
- `getMiniPetBagLimit`
- `checkRank`

## Data Usage

- `data.member[receiver]`: 등록 회원인지 확인
- `petData[receiver].miniPetBag`: 미니펫 1마리 추가

## Save Flow

- 명령 진입에서 읽은 `petData`를 전달하며 지급 함수 내부에는 파일 IO가 없다.
- `saveJsonFile(petData, memberPetPath)` 완료 후 지급 성공과 보유 수량을 안내한다.
- 저장 실패 시 실패 안내 후 오류를 다시 던져 기존 응답 오류 로그·트랜잭션 흐름을 유지한다.
- 기존 명령 컨텍스트가 DEV/PROD 경로를 분리한다.

## Related Commands

- `/미니펫가방`

## AI Notes

- 기존 `호이 남` 전용 권한과 아이디 2단어 형식을 유지한다. 미니펫 이름은 여러 단어를 허용한다.
- 전체 명령 패턴으로 실행을 제한하고 연속 공백·탭을 구분자로 처리한다.
- 숫자로만 된 등급은 허용하지 않아 뒤에 숫자를 붙여 인자 위치가 밀리는 입력을 막는다.
- 가격·매력도는 0 이상 9,007,199,254,740,991 이하의 정수만 허용한다.
- 미등록 대상의 잔여 펫 데이터를 만들지 않는다. 등록 회원의 펫/가방 구조가 없으면 기존 지급 함수가 생성한다.
- 관리자 지급의 기존 가방 한도 초과 허용은 유지한다. 보유 수량 표시는 일반 10칸·프리미엄 15칸을 기준으로 한다.
- 공용 지급 함수와 가방 정렬·전체보기 출력은 변경하지 않는다.
- 검증: `node tools/test_minipet_admin_add.js` (합성 파일시스템, 실제 저장·교체·로드·DEV 컨텍스트 함수 사용).

---

# /미니펫가방 [아이디]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/미니펫가방`

## Files

- `main.js`

## Related Helpers

- `buildMiniPetBagRenewedMessage`
- `checkRank`

## Data Usage

- `petData[sender].miniPetBag`
- `petData[sender].miniPet`
- `miniPetCollectionData.member[sender]`
- `miniPetData`

## Save Flow

- 본인 조회는 메시지 생성 후 `saveJsonFile(petData, memberPetPath)`로 정렬·번호를 저장한다.
- MASTER 대상 조회는 컬렉션을 한 번 로드하고 출력 함수의 `readOnly` 옵션으로 가방 복사본만 정렬한다. 대상 원본과 장착 상태를 변경하거나 저장하지 않는다.

## Related Commands

- `/미니펫정보`
- `/미니펫장착`
- `/미니펫조합...`
- `/미니펫가방정리`
- `/귀속해제`

## AI Notes

- Canonical entry point for mini-pet bag rendering
- 인자 없이 본인을 조회하며, `/미니펫가방 [아이디]`는 기존 방 조건을 포함한 `isMaster(sender)`만 허용한다. Admin 단독 권한으로는 대상 조회가 불가하다.
- 아이디는 기존 회원 키인 전체 닉네임으로 해석하고 공백을 지원한다. 대상 회원의 실제 키 존재를 확인하며 미등록 회원과 빈 가방은 구분해 안내한다.
- 대상의 프리미엄 헤더·가방 한도·컬렉션·순위를 사용한다. 기존 출석·1:1톡·전쟁 공통 제한은 유지한다.
- 가방은 원본 매력을 한 줄씩 표시하고 5번 다음에 `allsee`를 넣는다. 상단에 대표·보조 장착 안내를 추가하며 정보·편성은 `/미니펫정보`에서 확인한다.
- Nearby branches contain most mini-pet bag mutation logic
- 일반 이용자는 10칸, 호이패스 프리미엄 이용자는 15칸으로 표시·획득 제한하며 프리미엄 종료 후 초과 보유 데이터는 삭제하지 않는다.

---

# /미니펫강화 [미니펫가방번호] [시도횟수]

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `getMiniUpgradeTargetInfo`
- `runMiniPetUpgradeOnce`
- `runRepeatMiniPetUpgrade`

## Data Usage

- `petData[sender].miniPet`
- `petData[sender].miniPetBag`
- `data.member[sender].point`
- `data.member[sender].bag["미니펫 강화석💫"]`
- `petData[sender].miniPetSupport` — 대상 `00`일 때 강화하는 보조 슬롯

## Save Flow

- 강화 시 회원 포인트·강화석과 대상 미니펫의 강화·매력 수치를 변경한다.
- 명령 흐름에서 `filePath`와 `memberPetPath`를 각각 한 번 저장한다.

## Related Commands

- `/미니펫오픈`
- `/미니펫가방`

## AI Notes

- 가방 미니펫 강화 중에는 기존 `sortIndex`를 유지하고, `/미니펫가방` 조회 시 매력 기준으로 재정렬한다.
- 연속 강화는 처음 선택한 가방 번호의 미니펫만 계속 강화해야 한다.
- `/미니펫강화 0 [시도횟수]`는 대표, `/미니펫강화 00 [시도횟수]`는 `petData[sender].miniPetSupport` 보조를 강화한다. `00`은 문자열로 유지하며, 미장착 시 대표로 대체하거나 자원을 소모하지 않는다. 횟수 생략 시 1회, 100회 초과 시 100회로 제한한다.
- `/미니펫오픈`의 1회 최대 수량은 `GLOBAL_CONFIG.miniPet.openMaxCount`에서 관리하며 현재 3,000개다.

---

# /가구가방

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/가구가방`

## Files

- `main.js`

## Related Helpers

- `initSweetHomeUser`
- `isRegisteredHomeMember`
- `sortFurnitureList`
- `getFurnitureMaxSlots`
- `getFurnitureExp`
- `getHomeTotalExp`
- `checkRank`

## Data Usage

- `homeData[sender].furnitureBag`
- `homeData[sender].placedFurnitureSummary`
- `homeData[sender].floor`
- `homeData[sender].houseName`
- `petSkillData`
- `petData`

## Save Flow

- Calls `saveJsonFile(homeData, homeDataFile)` after normalization/sorting

## Related Commands

- `/샵오픈`
- `/가구정보`
- `/가구가방정리`
- `/가구전체정리`
- `/가구장착`
- `/가구제거`
- `/가구순위`

## AI Notes

- Canonical read path for sweet-home furniture bag
- This branch normalizes home user data before output
- `buildPetHomeFurnitureBagMessage` places registration and all equip/sell/unbind guides above the inventory. Item numbers/order remain the sorted bag order. `allsee` occurs once after item 3, or after the final divider when there are at most 3 items. House/charm summaries and repeated bottom management/growth guides are omitted.
- 일반 이용자는 10칸, 호이패스 프리미엄 이용자는 15칸으로 표시·획득 제한한다. 프리미엄 이용자는 가구를 3개 더 장착할 수 있고 종료 시 장착 가구 중 매력이 가장 낮은 초과 가구를 가방으로 회수한다.
- `/가구장착`은 로열 하우스 조건 충족 시 기존 멘트를 유지하고, 아르카나 하우스와 아르카나 루미에르 5개 보유 조건을 충족하면 전용 멘트를 추가한다.
- Pet-home command entry must not create/save sweet-home defaults for users missing from `data.member`
- If investigating furniture slot counts, inspect `getFurnitureMaxSlots`
- `/샵오픈`의 1회 최대 수량은 `GLOBAL_CONFIG.furniture.openMaxCount`에서 관리하며 현재 5,000개다.
- `/샵오픈`은 `buildGradeRates` 뒤 `buildFurnitureGradePools`로 등급별 후보 배열을 명령당 한 번 구성하고 `getRandomFurnitureByGrade`에 전달한다. 후보는 원래 목록 순서와 객체 참조를 유지하며 중복 등급은 배열을 공유한다. 명령 간 캐시는 없고 등급 추첨·가구 추첨·ID 생성의 난수 순서와 저장 순서는 그대로다.

---

# /펫홈

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/펫홈`
- `/펫홈`
- `/펫홈 [닉네임]`
- `/댓글`
- `/댓글핀 [번호]`
- `/댓글핀삭제 [번호]`
- `/댓글확인`
- `/댓글삭제`
- `/좋아홈 [닉네임]`
- `/마음 [닉네임]`
- `/귀여워 [닉네임]`
- `/응원해 [닉네임]`
- `/멋져요 [닉네임]`
- `/사랑해 [닉네임]`
- `/팔로우 [닉네임]`
- `/언팔로우 [닉네임]`
- `/팔로워`
- `/팔로잉`
- `/내마음`
- `/홈뱃지`
- `/홈뱃지전체`
- `/홈뱃지정보 [번호|ID|이름]`
- `/홈뱃지장착`
- `/홈뱃지장착 [번호|ID]`
- `/홈뱃지장착 [대표뱃지번호] [보조뱃지번호]`
- `/홈뱃지해제 [대표뱃지번호] [보조뱃지번호]`
- `홈뱃지교체` / `홈뱃지해제확정` / `홈뱃지취소`
- `/홈뱃지삭제 [번호|ID]`
- `/홈뱃지오픈 [숫자]`
- `/홈뱃지오픈2 [숫자]`
- `/홈뱃지오픈3 [숫자]`
- `/홈뱃지큐브 [장착슬롯 1|2] [옵션번호] [횟수]`
- `/홈뱃지큐브수정 [닉네임] [장착슬롯 1|2] [캐슬%] [레이드%] [펫강화%] [탐험%]`
- `/큐브확률`
- `/홈뽑기확률`
- `/특별뱃지목록`
- `/특별뱃지목록 [S01|[S01]]`
- `/특별뱃지지급 [닉네임] [뱃지이름|코드]`
- `/특별뱃지회수 [닉네임] [뱃지이름|코드]`
- `/홈알림` / `ㅎㄹ`
- `/피드 [내용]`
- `/피드삭제 [번호]`
- `/피드전체삭제`
- `/팔로워순위`
- `/마음순위`
- `/뱃지순위`
- `/펫홈댓글파일생성`
- `/펫홈활동파일생성`
- `/펫홈활동살리기`
- `/펫홈소셜뱃지마이그레이션`
- `/펫홈피드마이그레이션`
- `/펫홈패스개편정리`

## Files

- `main.js`
- `data/petSweetHomeData.json`
- runtime `petHomePlacedFurniture.json`
- `data/petHomeComments.json`
- runtime `petHomeActivityData.json`

## Related Helpers

- `initSweetHomeUser`
- `initPetHomeCommentsData`
- `getPetHomeCommentList`
- `getPetHomePinnedCommentList`
- `isPinnedPetHomeComment`
- `buildPetHomeCommentsMessage`
- `trimPetHomeComments`
- `requirePetHomeActivityData`
- `isProtectedPetHomeActivityJsonPath`
- `writeVerifiedJsonFile`
- `addPetHomeActivityAlert`
- `updatePetHomeRecentVisitor`
- `buildPetHomeActivityMessage`
- `buildPetHomeHeartExpressionMessage`
- `ensurePetHomeFeedList`
- `createPetHomeFeed`
- `buildPetHomeFeedMessage`
- `addPetHomeFeedActivityAlert`
- `getPetHomeAlertActorBadgeText`
- `buildPetHomeSocialRankingMessage`
- `getPetHomeSocialUser`
- `getPetHomeMutualUsers`
- `getActivePetHomeMutualCount`
- `awardPetHomeAchievementBadges`
- `buildPetHomeFollowListMessage`
- `buildOwnedPetHomeBadgesMessage`
- `getSortedOwnedPetHomeBadges`
- `getHomeBadgeCubeRecord`
- `getHomeBadgeCubeActiveOptionPercent`
- `rollHomeBadgeCubePercent`
- `buildHomeBadgeCubeRateMessage`
- `migratePetHomeSocialBadges`
- `migratePetHomeFeeds`
- `isPetHomeFeedMigrationComplete`
- `removePetHomeActivityUserOnAccountDelete`
- `markPetHomeAlertsRead`
- `cleanupPetHomePassBenefitData`
- `clearPetHomeCommentsPreservingPins`
- `hasActiveHoiOrNewbiePass`
- `getPetHomePassBenefitCost`
- `getFurnitureExp`
- `getPlacedFurnitureList`
- `getFurnitureMaxSlots`
- `findTargetAtStart`

## Data Usage

- `homeData[target].houseName`
- `homeData[target].exp`
- `homeData[target].floor`
- `homeData[target].placedFurnitureSummary`
- `placedFurnitureData[target]`
- `homeData[target].visitCnt`
- `homeData[target].likeCnt`
- `homeData[target].feeds`
- `homeData[target].feedMigration20260728`
- `homeData[target].heartExpressions`
- `homeData[sender].lastHeartExpressionDate`
- `petHomeCommentsData.comments[target]`
- `petHomeCommentsData.pinnedComments[target]`
- `petHomeCommentsData.migrations.passBenefits20260726`
- `petHomeActivityData.alerts[target]`
- `petHomeActivityData.recentVisitors[target]`
- `petHomeActivityData.petHomeSocial[target].followers`
- `petHomeActivityData.petHomeSocial[target].following`
- `petHomeActivityData.petHomeSocial[target].badges`
- `petHomeActivityData.petHomeSocial[target].deletedBadgeIds`
- `petHomeActivityData.petHomeSocial[target].equippedBadgeIds` (`equippedBadgeId` 대표 호환 필드 유지)
- `petHomeActivityData.petHomeSocial[target].heartUsage`
- `petHomeActivityData.petHomeSocial[target].feedActivityDates`
- `petHomeActivityData.petHomeSocial[target].badgeStats`
- `petHomeActivityData.petHomeSocial[target].specialBadgeLogs`
- `data.member[target].homeBadgeCube.equippedBadgeIds` (`equippedBadgeId` 대표 호환 필드 유지)
- `data.member[target].homeBadgeCube.badges[badgeId]`
- `petHomeActivityData.migrations.petHomeSocialBadges20260727`
- Legacy `homeData[target].guestComments` is not changed by `/데이터정리`.

## Save Flow

- `/펫홈`: loads home, placed furniture, activity and comments once. Shows house, final furniture charm, village level/progress and distinct furniture TOP 3, followed by the guestbook in one reply. Other-user visits retain cumulative counts, visitor records and badge awards. Over-limit historical comment lists are saved as the latest 30 with separate pinned copies preserved; normal views skip comment serialization/saves.
- `/댓글`: active hoi/newbie pass users write up to 30 characters and pay zero cost; mutates `data.member[sender].point` only when a cost applies, appends to `petHomeCommentsData.comments[target]`, adds an activity alert, then saves `filePath`, `petHomeCommentsFile`, and `petHomeActivityFile` with rollback handling.
- `/댓글핀 [번호]`: active hoi/newbie pass users pay zero cost; adds the displayed newest-first comment to `pinnedComments[sender]`, then saves `filePath` and `petHomeCommentsFile`. Captures comments before trimming/mutation and passes that snapshot to `saveJsonFile`, so comments use verified transactional saves even though this file is not in the default protected-path list. Failures restore both member and comments.
- `/댓글핀삭제 [번호]`: removes the selected pinned comment and saves `petHomeCommentsFile` with a pre-mutation snapshot, without changing member points or reinserting old pinned comments into the recent list.
- `/댓글확인`: reads `petHomeCommentsData.comments[target]` and replies the comment-only message.
- `/댓글삭제`: mutates `petHomeCommentsData.comments[sender]`, then saves `petHomeCommentsFile`.
- `/펫홈댓글파일생성`: Admin/Master-only; creates `petHomeCommentsFile` with `{ comments: {}, pinnedComments: {} }` only when the file does not exist.
- `/펫홈활동파일생성`: Admin/Master-only exact command; creates `petHomeActivityFile` with empty `alerts`, `recentVisitors`, `petHomeSocial`, and `migrations` only when the active DEV/PROD file does not exist and never overwrites an existing file.
- `/펫홈활동살리기`: Admin/Master-only exact command; strictly parses and validates `petHomeActivityData_back.json`, then atomically restores only `petHomeActivityData.json` without replacing the backup.
- `/마음 [닉네임] [수량]` and the four direct expression commands require both users to have an active hoi/newbie pass, share a daily `1 + active mutual follow count + 망므📙 5회` allowance, save target totals to `homeDataFile`, and save sender usage, badge stats, and target alerts to `petHomeActivityFile` with rollback handling. `호이 남`은 일일 사용 횟수 판정만 무제한이며 대상 패스·본인 사용 금지·통계·알림·저장 규칙은 그대로 적용된다. `/내마음`과 `/홈알림`에는 남은 횟수를 `무제한`으로 표시한다. 스킬 해제 후에는 이미 사용한 횟수는 유지하고 추가 한도만 즉시 사라진다.
- `/팔로우` requires both users to have an active hoi/newbie pass, updates the sender's following and target's followers together, detects mutual relationships, awards relationship badges, and saves `petHomeActivityFile`; `/언팔로우` remains available after pass expiry and removes both sides of the relationship.
- `/팔로워`, `/팔로잉`, and `/내마음` read preserved social relationships from `petHomeActivityFile`; list and benefit commands require an active pass. `/내마음`은 `망므📙` 장착 시 `+5회`를 별도 표시한다. Their standalone guide outputs identify the requesting user with `[checkRank] 님`. Follower/following lists show non-mutual users before mutual users without mutating the stored relationship order, and the headers show the related `/팔로우` and `/팔로잉` command guides.
- `/홈뱃지` rechecks achievement badges, including 10 feed activity badges for 1–365 distinct activity days, while the badge view/equip/unequip/permanent-delete commands include achievement, special, 57 original gacha badges, 20 MBTI gacha badges, and 50 relationship-type gacha badges stored in `petHomeActivityFile`; permanent deletion blocks re-grant from every path. These commands are available without a pass. 장착은 `/홈뱃지장착 [대표뱃지번호] [보조뱃지번호]`로 두 슬롯을 한 번에 지정하며 기존 단일 `/홈뱃지장착 [번호|ID]`는 대표 슬롯으로 호환된다. 해제도 장착된 뱃지번호 1~2개를 지정하고 30초 확인을 거치며, 대표만 제거되면 보조가 자동 승격한다. 같은 뱃지 중복 장착은 거부한다. 캐슬·레이드는 두 슬롯, 펫강화·탐험은 대표 슬롯만 적용하며 뱃지별 기본합계 100% 보정과 프리미엄 +3%p를 독립 계산한다. 보조로 장착된 뱃지의 옵션 카드에는 사용 가능한 1번 캐슬·2번 레이드만 표시하고, 저장된 3·4번 수치는 보존해 대표 장착 시 다시 표시한다.
- `/홈뱃지오픈` consumes `data.member[sender].bag["홈뱃지뽑기🛡️(/홈뱃지오픈)"]`, opens 1 by default or 1–100 by full numeric guard, runs under the response data write lock, draws C/B/A/S at 55/30/12/3% then uniformly within the grade, stores unique `HB001`–`HB057` IDs in `petHomeActivityFile`, and grants 100,000,000 points immediately for each duplicate. Member points, tickets, and badge data roll back together on save failure. All results are sent in one reply with `allsee` before the fifth draw, and S results send an overall notice.
- `/홈뱃지오픈2 [숫자]` requires a full numeric argument from 1–100, consumes `data.member[sender].bag["홈뱃지뽑기🛡️[2](/홈뱃지오픈2)"]`, runs under the response data write lock, uniformly draws one of 20 `MBTI01`–`MBTI20` badges per item, stores unique IDs in `petHomeActivityFile`, and applies the existing duplicate-point, permanent-delete, single-reply, and two-file rollback behavior.
- `/홈뱃지오픈3 [숫자]` opens 1 badge when the count is omitted or accepts a full numeric argument from 1–100, consumes `data.member[sender].bag["홈뱃지뽑기🛡️[3](/홈뱃지오픈3)"]`, runs under the response data write lock, uniformly draws one of 50 `LOVE01`–`LOVE50` relationship-type badges per item, stores unique IDs in `petHomeActivityFile`, and applies the existing duplicate-point, permanent-delete, single-reply, and two-file rollback behavior.
- `/홈뱃지큐브 [장착슬롯] [옵션] [횟수]` is available without a pass and targets the badge currently in slot 1 or 2. Slot 1 allows options 1–4; support slot 2 allows only castle option 1 and raid option 2. Slot 2 options 3–4 and empty slots are rejected before cube/point mutation. It uses 1 cube per castle/raid attempt, 2 per pet-upgrade attempt, and 3 per explore attempt. Each consumed cube grants 500,000 points in the same `member.json` save, and point overflow or save failure rolls the point, cube bag, and cube-option state back together. It allows 1–1,000 tries and preserves the existing option limits, integer protection bands, per-badge `×1.1` total buff, and milestone notices.
- `/홈뱃지큐브수정 [닉네임] [장착슬롯 1|2] [캐슬%] [레이드%] [펫강화%] [탐험%]` is Master-only and directly sets the four cube-option values of the named user's badge currently equipped in the selected slot. It resolves space-containing nicknames through `findTargetAtStart`, accepts one decimal place, and enforces the existing maxima of 50/50/30/15. The command consumes no cube, grants no points, rejects unknown users and empty or unowned equipped badges, saves only `member.json`, and reload-verifies all four values for the same target. Slot 2 stores pet-upgrade and explore values but the existing effect calculation applies them only after that badge moves to the representative slot.
- `/홈뽑기확률` is exact/read-only and shows grade and individual badge rates.
- `/특별뱃지지급` and `/특별뱃지회수` are Admin/Master-only, accept an optional comma after the target plus `S01`, `[S01]`, the exact name, or the `[ID] emoji name` list label, save an audit log and activity alert, and automatically unequip a revoked representative badge.
- `/펫홈소셜뱃지마이그레이션` is Admin/Master-only and one-time; it validates or creates an activity-file backup, initializes existing comment/like/reaction/visit totals without mass alerts, saves, and reload-verifies the migration marker.
- `/펫홈피드마이그레이션` is Admin/Master-only and one-time; it validates or creates a home-data backup, converts all legacy one-line reviews to the first feed, saves `homeDataFile`, and reload-verifies every user migration marker.
- `/홈알림` and `ㅎㄹ`: keep pass access, 100 activity alerts, read handling and daily completion with existing rollback. The top shows current follows/mutuals/heart allowance, the sum and compact counts of all five received-heart types, unread/stored alert counts and recent-visitor counts. Existing alerts, follow lists and restored recent visitors appear below `allsee`, followed by cumulative visits and visit-badge progress/ownership. Visitor storage and badge progression remain.
- `/피드 [내용]`: runs under the response data write lock; active hoi/newbie pass users write a free feed of up to 100 characters, keep the latest 10 entries in `homeDataFile`, add the same feed alert to the writer and each valid follower, record one KST feed activity date per day, award feed activity badges, and complete the pass `피드 글 작성` daily condition only after home/activity/member saves succeed; all three files use rollback handling. Stored feeds are not included in `/펫홈` output.
- `/피드삭제 [번호]` and `/피드전체삭제`: active hoi/newbie pass users remove their own stored feeds and save `homeDataFile`.
- `/팔로워순위`, `/마음순위`, and `/뱃지순위`: read current member, home, and social data without saving, exclude zero scores, sort by score then original user ID, and show up to 100 users; `/팔로워순위`는 실제 팔로워에 `인플루언서📙` 1,000명과 `셀럽📙` 2,000명을 합산하고, `/마음순위`는 각 유저의 귀여워·멋져요·응원해·사랑해 받은 수를 표시한다.
- `/펫홈패스개편정리`: Admin/Master-only exact command; validates or creates one-time backups under the active data root's `backups/` folder, removes all normal comments and `likeCnt` values, preserves pinned comments, saves both files, reload-verifies the cleanup, and records `passBenefits20260726` so it cannot run twice.
- `/댓글`, `/댓글핀`, `/댓글확인`, `/댓글삭제`, and `/댓글핀삭제` require the command sender to have an active hoi or newbie pass; `/댓글` additionally requires the target home owner to have one.
- `/좋아홈` requires both sender and target to have an active hoi or newbie pass before counters, points, or home data are mutated; active pass users pay zero cost and successful use adds an activity alert with rollback handling. 일반 이용자의 일일 2회 제한은 유지하며 `호이 남`만 횟수 제한 없이 사용할 수 있다.
- Successful `/댓글`, `/좋아홈`, heart-expression, follow, and visit flows update cumulative badge stats and award badges in the same activity-file save/rollback flow.
- Both account-deletion flows remove the deleted user's social record and references from other users' followers/following, alerts, and recent visitors before saving `petHomeActivityFile`.
- Duplicate comments by the same writer are allowed.

## Related Commands

- `/펫홈순위`
- `/펫홈방문초기화`
- `/피드`
- `/피드삭제`
- `/피드전체삭제`
- `/팔로워순위`
- `/마음순위`
- `/뱃지순위`
- `/집청소`
- `/가구가방`
- `/장착가구동기화`

## AI Notes

- `/펫홈` combines the new home/village/TOP 3 body and guestbook. Feed commands/storage remain available; the latest feed is not shown here.
- Feed write/delete commands are pass-only and free, and the removed `/한줄평` data is lazily migrated once without point deductions.
- `/홈알림` shows the current representative badge above comment, like, follow, unfollow, heart, and feed alerts; system badge award/revoke alerts do not receive an actor badge line.
- `/펫홈` and `/가구정보` use the queried owner's house, skills, charm, levels and furniture. Preview TOP 3 numbers never replace the actual equipped-item indices.
- `getPetHomeBadgeById`는 활성 `commandContextThreadLocal`의 명령 한 번 안에서만 고정 뱃지 정의를 재사용한다. 첫 조회는 기존 선형 검색을 유지하고, 추가 문자열 ID 조회부터 첫 일치 정의의 원본 참조를 점진적으로 색인한다. 없는 ID 문자열은 보관하지 않으며 잘못된 정의는 기존 검색 순서에서 오류로 남는다. 명령 종료·DEV/PROD·중첩/동시 실행 사이에는 색인을 공유하지 않는다. `getAllPetHomeBadges`의 새 배열·고정 순서, 비문자 ID의 엄격 비교, 컨텍스트 없는 독립 조회는 기존대로 유지한다.
- `/홈뱃지` shows both equipped badge slots and the final applied-effect summary first, inserts `allsee` immediately after that summary, then keeps command guides, cube guides, collection summary, and the owned-badge list folded.
- Standalone full/special badge lists, badge details, pet-home feed output, and follower/heart/badge ranking output identify the requesting or target user with `[checkRank] 님`.
- `/홈뱃지정보` accepts badge IDs both as `S01` and as the bracketed `[S01]` text shown by `/특별뱃지목록`.
- `/특별뱃지목록 [코드]` shows one special badge by `S01` or `[S01]`, while the no-argument command keeps showing all S01–S10 badges.
- `/펫홈` shows at most three distinct furniture names before the guestbook; the complete equipped list is at the bottom of `/가구정보`, after its single `allsee` marker.
- Recent comment storage keeps exactly the latest 30; separate pinned copies survive pruning. Guestbook `allsee` follows the first pin or the header when no pin exists. A completely empty guestbook omits empty numbers/sections.
- Up to `GLOBAL_CONFIG.petHomeComments.maxPinned` comments can be pinned; pinned comments cannot be deleted through `/댓글삭제` until `/댓글핀삭제` removes the pin.
- Duplicate pet-home comments by the same writer are allowed.
- `/댓글`, `/댓글핀`, `/좋아홈` 성공 메시지는 포인트 차감·소모 문구를 표시하지 않는다.
- Command guards are exact/full-pattern based so adjacent commands such as `/펫홈순위` and `/댓글확인` do not fall through.
- `/좋아홈` also uses an exact/full-pattern guard so `/좋아홈순위` and `/좋아홈초기화` do not enter the mutation branch.
- `petHomeActivityData.json` is intentionally initialized by `/펫홈활동파일생성`; missing or invalid files follow the existing load/error flow and are not silently replaced.
- Legacy valid activity files gain empty `petHomeSocial` and `migrations` containers, while invalid existing social structures still fail validation.
- Social counts and representative badge are displayed through `/홈알림`; its existing active-pass access remains. `/펫홈` no longer displays social, visitor, pet or doll details.

---

# /장착가구동기화

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/장착가구동기화`

## Files

- `main.js`
- runtime `petSweetHomeData.json`
- runtime `petHomePlacedFurniture.json`
- runtime `petSweetHomeData_beforePlacedFurnitureSplit.json`

## Related Helpers

- `buildPlacedFurnitureSummary`
- `requirePlacedFurnitureDataMap`
- `synchronizePlacedFurnitureData`
- `validatePlacedFurnitureSync`
- `mergePlacedFurnitureLists`
- `removePlacedFurnitureDuplicatesFromBag`

## Data Usage

- `homeData[*].placedFurniture` during initial legacy migration only
- `homeData[*].placedFurnitureSummary`
- `homeData[*].furnitureBag`
- `placedFurnitureData[*]`

## Save Flow

- Admin/Master-only exact command.
- Before the first separation, saves and reload-validates `petSweetHomeData_beforePlacedFurnitureSplit.json`; an existing backup is preserved without overwrite.
- If the detail file is missing, copies legacy placed lists into it, verifies summaries, then removes legacy fields from home data.
- If the detail file exists, treats it as the source of truth, merges remaining legacy IDs, removes bag/detail ID duplicates, and recalculates every summary.
- Summary recalculation stores `gradeCounts` for condition skills such as `아르카나 하우스📙`; its five-item check combines placed furniture with `furnitureBag`.
- Saves `petHomePlacedFurniturePath` before `homeDataFile`, reloads both, and reports verification mismatches.

## AI Notes

- Re-running the command is idempotent for furniture entries that have IDs.
- A missing detail file is not recreated when only non-zero summaries remain, preventing silent loss of detailed furniture data.
- After separation, detail-dependent view and mutation commands stop with an operator-check message if the detail file disappears instead of recreating partial legacy lists.

---

# /길드영지시작

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드영지시작`

## Files

- `main.js`
- runtime `petHomePlacedFurniture.json`

## Related Helpers

- `ensureGuildTerritoryWar`
- `buildGuildTerritoryPrepareMessage`
- `buildGuildTerritoryTurnRows`
- `getGuildTerritoryAttackerNames`
- `getGuildTerritoryAttackLimit`
- `scheduleGuildTerritoryWarStart`
- `beginGuildTerritoryWarNow`
- `scheduleGuildTerritoryOpening`
- `buildGuildTerritoryOrderMessage`
- `buildGuildTerritoryStatusMessage`
- `buildGuildTerritoryRankingMessage`
- `buildGuildTerritoryStartMessage`
- `finishGuildTerritoryWar`
- `prepareNextGuildTerritoryWarAutomatically`
- `validateGuildTerritoryAutoAttack`
- `executeGuildTerritoryNormalAttack`
- `addGuildWarehouseReward`
- `ensureGuildTerritoryBoosterCount`
- `getGuildTerritoryByNo`
- `getGuildTerritoryOwnedCount`
- `startGuildTerritoryTurnTimer`
- `isGuildTerritoryWarCommandLockActive`
- `isGuildTerritoryAllowedDuringWarCommand`
- `isGuildTerritoryBlockedDuringWarCommand`

## Data Usage

- `guildData.territoryWar.pendingStart`
- `guildData.territoryWar.pendingStartToken`
- `guildData.territoryWar.startReady`
- `guildData.territoryWar.openingToken`
- `guildData.territoryWar.turnOrder`
- `guildData.territoryWar.roundId`
- `guildData.territoryWar.autoAttackProcessedKeys`
- `guildData.territoryWar.automationLogs`
- `data.member[user].guildTerritoryAutoAttackEnabled`
- `data.guildTerritoryAutomationLogs`
- `guildData.castleSiegeFlag`
- `guildData.guilds[*].warehouse.petSkillBook`
- `guildData.guilds[*].warehouse.fund`
- `guildData.guilds[*].guildTerritoryBooster`
- `guildData.guilds[*].guildTerritoryScore`

## Save Flow

- Saves `guildData` when start reservation is created
- Reloads latest `member/pet/petSkill/guild` data inside delayed start and opening callbacks
- Saves `guildData` after turn order is created
- Saves `guildData` again when 5-second opening grace ends and attacks become available
- Delayed start, opening grace, and turn timer callbacks use the shared data transaction lock so command saves and timer saves do not overlap.

## Related Commands

- `/길드영지준비`
- `/길드영지종료`
- `/길드영지순서`
- `/길드영지순위`
- `/길드영지보상지급`
- `/영지순위보상`
- `/영지보상순위`
- `/영지공격 [숫자]`
- `/영지온`
- `/영지오프`

## AI Notes

- Start flow is staged: `NoticeMsg` two-line prepare notice -> 20s wait -> castle-room order output -> 5s grace -> castle-room start notice -> first turn timer
- Turn order and guild attack limits may include `전투형 지휘관📙`, `기사단 증원📙` 길드마스터 effects at start time
- During the 5-second grace window, `/영지공격` is intentionally blocked by `territoryWar.startReady`
- Cancellation and forced finish should clear both pending-start and opening-grace timers
- Finish rewards use `펫스킬 광산📙` / `warehouse.petSkillBook` instead of the old `정령광산🥀` / `warehouse.elemental` guild warehouse flow.
- `finishGuildTerritoryWar` applies `길드영지 부스터🔮` to `[2]`~`[6]` mine rewards by guild; insufficient boosters across multiple mines are divided with `Math.floor`, then remaining boosters are redistributed to mines that still have bonus capacity.
- `[7] 길드영지PT광산🪙` pays 2,000,000,000 points to `warehouse.fund` and grants 100 territory points; up to 100 territory boosters can add up to 100 more points.
- Territory score boosts consume one `길드영지 부스터🔮` per additional point. When boosters are insufficient, all remaining boosters are distributed across occupied territories with the existing `n:1` mine distribution logic, capped at each territory's base score.
- `ensureGuildTerritoryWar` migrates the former PT mine occupation row from territory 8 to territory 7 and removes the stale territory 8 row; number 8 is now the virtual dimension gate only.
- `finishGuildTerritoryWar` keeps final occupation results visible first, then folds reward details, grouped territory point gains, and guide commands behind `allsee`.
- `/길드영지순위` is read-only and displays cumulative guild territory score sorted by score, guild level, then guild name; guild masters are formatted through `checkRank` when member data exists.
- `/영지순위보상` and `/영지보상순위` are read-only guide commands that show the fixed rank reward table and scheduled payout time.
- `/길드영지보상지급` and `/영지순위보상지급` are exact aliases. Both are Admin/Master only and pay guild warehouse fund rewards to rank 1~10 based on the current cumulative territory score snapshot; duplicate payment for the same snapshot is blocked.
- 영지전 종료 시 참가 길드의 현재 길드마스터·부길드마스터 중 `길드영지자동준비권` 또는 유효한 영지기습패스 보유자를 다시 확인해 다음 회차 준비를 길드당 1회 생성한다.
- `/영지온`은 유효한 영지기습패스와 현재 소드마스터 또는 `전투형 지휘관📙` 길드마스터 자격을 모두 요구한다. 미구독 상태에서 활성화에 실패하면 체크랭크와 영지기습패스 미구독 안내를 함께 표시한다. 실제 턴에도 패스와 자격을 재검증하며 실패하면 OFF 처리한다. `/영지오프`는 기존 설정·로그·저장을 유지하고 미구독 상태일 때 응답 문구만 구독 안내로 변경한다.
- 자동 공격은 1~7번 중 현재 공격 길드가 점령한 영지를 제외한 후보를 균등 무작위로 선택하고 수동 공격과 같은 공통 처리 경로를 사용한다. 회차·턴 토큰·사용자 키로 자동/수동 중복 공격을 방지하며, 예약 당시 길드와 실행 시점의 실제 길드가 다르면 실행하지 않는다.
- `guildData.territoryWar.active === true`인 환경에서는 Main 공통 진입부가 `isGuildTerritoryAllowedDuringWarCommand`의 영지전 관련 명령과 정확한 `/글자수전체정리`만 허용한다. 준비·시작·종료·상태·순서·순위·순위보상·자동공격·이벤트 온오프·균열 조정·1~9번 공격을 포함하며 각 명령의 기존 권한·인자 검사는 유지한다. `/펫정보`·`ㅊㅊ`·운영자 `/정보`·디버깅·일반 메뉴와 확인 입력도 우회하지 않는다. PROD/DEV는 각 환경의 진행 상태를 따른다. Info는 회원·펫·타이틀 로드 전에 조용히 반환하며, Main만 제한 안내를 출력한다. 일반 채팅은 안내 없이 반환한다. 검증: `tools/test_territory_command_lock.js`, `tools/test_territory_command_lock_rhino.js`.
- `/길드영지시작`은 기존 지정 운영자에 더해 서버관리자방의 등록된 Admin·Master가 실행할 수 있다. `/길드영지종료`의 기존 지정 운영자 권한은 유지하며, 방 권한이 진행 상태·준비 길드·펫무쌍 상호 차단 조건을 우회하지 않는다.
- `/영지공격 숫자`의 수동 입력 제한시간은 `GLOBAL_CONFIG.guildTerritory.timers.turnTimeoutMs`의 10초다. 자동공격 유예 1초, 시간초과 3회 누적 탈락, 공격 판정·보상·자동준비는 유지한다.

---

# /영지공격 [숫자]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/영지공격`

## Files

- `main.js`

## Related Helpers

- `ensureGuildTerritoryWar`
- `getMyGuildInfo`
- `isGuildSwordMaster`
- `isGuildTerritoryAttacker`
- `hasGuildTerritoryCommanderSkill`
- `hasGuildTerritoryKnightOrderSkill`
- `getGuildTerritoryTurnRow`
- `getGuildTerritoryAttackLimitForWar`
- `getGuildTerritoryUserAttackCount`
- `increaseGuildTerritoryUserAttackCount`
- `applyGuildTerritoryTurnReward`
- `buildPetSkillMsg`
- `resolveGuildTerritoryDimensionGate`
- `resolveGuildTerritoryRememberMe`
- `resolveGuildTerritoryAttack`
- `executeGuildTerritoryNormalAttack`
- `getGuildTerritoryAttackActionKey`
- `validateGuildTerritoryAutoAttack`
- `getGuildTerritoryDefenderName`
- `createGuildTerritoryCastleBattleSnapshot`
- `buildGuildTerritoryCastleExpSnapshots`
- `getGuildTerritoryMissingCastleExpUsers`
- `fillGuildTerritoryCastleExpSnapshots`
- `resolveGuildTerritoryCastleBattle`
- `formatGuildTerritoryCastleBattleUserBlock`
- `buildGuildTerritoryCastleBattleDetailMessage`
- `getGuildTerritoryByNo`
- `getGuildTerritoryOwnedCount`
- `getGuildTerritoryAutoAttackTargetNo`
- `processGuildTerritoryRiftEvent`
- `advanceGuildTerritoryTurn`
- `buildGuildTerritoryCurrentTurnLine`
- `buildGuildTerritoryTurnMessage`
- `buildGuildTerritoryAttackTimeCheckMessage`
- `startGuildTerritoryTurnTimer`

## Data Usage

- `guildData.territoryWar.active`
- `guildData.territoryWar.startReady`
- `guildData.territoryWar.eliminatedUsers`
- `guildData.territoryWar.eliminatedGuilds`
- `guildData.territoryWar.readyGuilds`
- `guildData.territoryWar.guildAttackCounts`
- `guildData.territoryWar.guildAttackLimits`
- `guildData.territoryWar.userAttackCounts`
- `guildData.territoryWar.castleExpSnapshots`
- `guildData.territoryWar.castleBattleSnapshots`
- `guildData.territoryWar.autoAttackProcessedKeys`
- `data.member[user].guildTerritoryAutoAttackEnabled`
- `GLOBAL_CONFIG.guildTerritory.rewards.maxTerritoryTurnFundMultiplier`
- `guildData.territoryWar.dimensionGateEnabled`
- `guildData.territoryWar.rememberMeEnabled`
- `GLOBAL_CONFIG.guildTerritory.limits.maxOwnedTerritories`
- `GLOBAL_CONFIG.guildTerritory.rewards.pointMineFundRewardAmount`
- `GLOBAL_CONFIG.guildTerritory.scores.pointMine`

## Save Flow

- Clears active turn timer before resolving a valid attack
- Wrong-turn penalty path saves `guildData` after user/guild elimination and attack-count penalty updates
- `/영지공격 8` saves `guildData` after 차원의 문 failure elimination with 2-turn attack-count penalty or success turn-limit increase
- `/영지공격 9` saves `guildData` and `data` after one-turn deduction and an optional occupied-territory release
- Saves `guildData` and `data` after attack resolution and turn advance
- Finish path saves `guildData` and `data` through `finishGuildTerritoryWar`

## Related Commands

- `/길드영지시작`
- `/길드영지준비`
- `/길드영지순서`
- `/길드영지종료`
- `/영지온`
- `/영지오프`
- `/차원의문on`
- `/차원의문off`
- `/차원의문온`
- `/차원의문오프`
- `/날기억해줘온`
- `/날기억해줘오프`

## AI Notes

- Rejects attacks while the war is active but not yet start-ready
- `전투형 지휘관📙` 보유 길드마스터는 영지전에서 소드마스터로 취급된다. 수동 공격은 같은 길드 턴이면 현재 차례 유저가 아니어도 같은 길드의 다른 소드마스터 또는 전투형 지휘관 길드마스터가 대신 공격할 수 있고, 자동 공격은 현재 차례 유저 본인만 실행한다. 해당 스킬 보유 상태로 직접 공격하면 랜덤 발동 멘트가 prepend한다
- `/불안정`, `/안정`, `/균열`, `/대균열`도 `isGuildTerritoryAttacker` 기준을 따라 `전투형 지휘관📙` 길드마스터가 사용할 수 있다. 명령어 단독 또는 순수 숫자 인자 1개만 허용하며, 숫자 뒤 접미문이나 추가 설명이 붙은 입력은 실행하지 않는다
- DEV 컨텍스트에서는 테스트용으로 `dev/강제균열`, `dev/강제대균열` 명령으로 확률 없이 이벤트를 즉시 발생시킬 수 있다
- `🌌균열` 또는 `🌋대균열`이 실제 발생하면 누적 전쟁불안정도는 즉시 0으로 초기화된다
- `기사단 증원📙` 길드마스터가 있으면 소드마스터 슬롯이 1명 추가되며, 공격 결과에 발동 멘트가 prepend된다
- `/소드마스터`에서 4번째 소드마스터가 추가될 때 `기사단 증원📙 [체크랭크] 소드마스터가 길드를 위하여 헌신합니다` 멘트를 추가 출력하며, 체크랭크는 추가된 4번째 인원 기준이다
- 종료되지 않은 공격 결과는 다음 공격자의 턴 안내와 구분선을 결과 본문 앞에 표시한다.
- 수동 턴은 `[체크랭크] 님의 공격 차례입니다.`, 자동 턴은 `[체크랭크] 님이 자동공격을 진행합니다.`로 표시한다. 자동 공격은 우리 길드 점령지를 제외한 후보에서 예약 시 선택한 영지를 `자동공격 영지`로 안내하고 같은 영지를 실제 공격에 사용한다.
- 영지공격 후 출력되는 다음 턴 현황 카드는 현재 공격자 문구를 상단에 표시하고, 영지전 상황 아래에도 구분선과 함께 한 번 더 표시한다.
- 공격 결과 상단에는 수동·자동 여부에 맞는 `상세 결과`와 공격 영지, 길드·확률 보상을 표시하며 기존 전투 및 스킬 발동 내용은 `공격/방어/보상 상세보기` 안에 유지한다.
- Wrong-turn attacks eliminate the acting user from the current territory-war rotation
- Wrong-turn attacks subtract `GLOBAL_CONFIG.guildTerritory.limits.wrongTurnPenalty` (currently 7) turns from the user's guild when remaining turns are at least the penalty
- Wrong-turn attacks eliminate the whole guild when remaining turns are less than `GLOBAL_CONFIG.guildTerritory.limits.wrongTurnPenalty`
- 개인별 영지공격은 본인 차례와 같은 길드 대리 공격을 실제 공격자 기준으로 합산하며, `GLOBAL_CONFIG.guildTerritory.limits.personalAttackLimit` 기준 최대 7회까지 가능하다. 초과 시 공격 처리 전에 차단한다.
- `/영지공격` is accepted only as `/영지공격 [1-9]`; suffix text such as `/영지공격 2 해봐` must not execute
- `/영지공격 7` targets 길드영지PT광산🪙. A guild already holding 3 territories is blocked before combat resolution, while the already-counted attack turn remains consumed.
- `/영지공격 8` triggers 차원의 문 🌀 when enabled: 80% user elimination with 2-turn attack-count penalty, 20% guild attack limit +4
- `/영지공격 9` triggers 날 기억해줘😭 when enabled: the guild and user each consume one attack, the entering user remains in the rotation, and a 30% success releases one randomly selected occupied territory among `[1]~[7]`.
- Releasing `[1] 호월킹덤🏰` also clears the current lord, earnings, and defense count so `ensureGuildTerritoryWar` cannot restore the released ownership.
- 공격 시점에 점령지 3개를 보유한 길드는 턴 길드자금 보상이 5천만에서 1억으로 두 배 적용되며 결과에 `점령 3개 추가보너스 획득`이 표시된다.
- 영지전 시작 타이머는 홈 데이터를 한 번만 읽고 공격 순서 참가자와 기존 점령자의 캐슬매력은 `castleExpSnapshots`, 강화 기준 크리 확률·배율은 `castleBattleSnapshots`에 저장한다.
- 진행 중인 구버전 영지전에서 누락된 캐슬매력·크리 스냅샷은 해당 사용자의 최초 공격 시 한 번 계산해 저장한다.
- 특수 방어권·기습공격권이 발동하지 않으면 공격자와 방어자의 크리티컬을 각각 한 번 판정한 최종 캐슬매력을 비교하며, 동률이면 방어자가 승리한다.
- `/디버깅모드`가 켜진 상태에서 `/영지공격 [1-7]`을 실행하면 방어자의 영지절대방어권 확률, 길드공헌 큐브 기습방어 증가분, 두 수치의 단순 합산값을 테스트방에 표시한다. 실제 전투는 합산 확률 한 번이 아니라 절대방어권 선판정 후 기습공격 발동 시 큐브를 별도로 판정한다.
- 일반 캐슬매력 대결 상세보기에는 영지, 공격·방어 길드, 유저·펫, 기본·최종 매력, 크리 발동, 비교식과 점령 결과를 카드형 UI로 표시한다.
- 영지전 도중 펫홈·미니펫·장비·펫스킬 변경은 현재 스냅샷을 바꾸지 않고 다음 영지전부터 반영된다.
- `dev/영지공격 [1-9]`의 정상 처리 결과 뒤에는 응답 진입 전체 시간과 공통 데이터 로드·보정, 검증, 스냅샷 준비, 전투 판정, 후처리, 결과 출력, 저장, 다음 턴 안내 단계별 소요 시간이 ms로 표시된다. 일반 `/영지공격`에는 속도 정보가 표시되지 않는다.
- After a successful or blocked attack resolution, the next turn message is sent and a fresh turn timer starts

---

# /길드정보

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드정보`
- Alias: `ㅗㅗㅗ`

## Files

- `main.js`

## Related Helpers

- `getMyGuildId`
- `ensureGuildTerritoryWar`
- `getGuildTerritoryList`
- `buildGuildResourceDisplay`
- `ensureGuildTerritoryBoosterCount`
- `buildGuildContributionCubeOptionDisplay`
- `buildGuildContributionCubeCostDisplay`

## Data Usage

- `data.member[sender]`
- `guildData.guilds[myGid]`
- `guildData`
- guild territory war state inside guild data structures
- `guildData.guilds[myGid].guildTerritoryBooster`
- `guildData.guilds[myGid].members[*].contribution`
- `guildData.guilds[myGid].members[*].boosterContribution`
- `data.member[*].gContribCnt`
- `data.member[*].gBoosterContribCnt`
- `guildData.guilds[myGid].cubeOptions`

## Save Flow

- Normal success path is read-only
- Nearby recovery paths may call `saveJsonFile(guildData, guildPath)` and `saveJsonFile(data, filePath)` when guild/member mismatch is corrected

## Related Commands

- `/길드목록`
- `/길드생성`
- `/길드상세정보`
- `/길드순위`
- `/길드상점`
- `/소드마스터`

## AI Notes

- Best entry point for current user's guild ownership and membership flow
- If a bug mentions guild mismatch auto-repair, inspect nearby warning branches with `길드 데이터 불일치`
- Territory-related display here depends on `ensureGuildTerritoryWar`
- Guild resource display is shared with `/길드상세정보` through `buildGuildResourceDisplay`
- Displays current `길드영지 부스터🔮` count through `ensureGuildTerritoryBoosterCount`
- Displays all four current 길드공헌 큐브 percentages below the territory booster and each option's contribution cost below the guild warehouse.
- Member rows show a fixed Master/SubMaster/SwordMaster legend, append `│👑🛡️⚔️` role emojis to the right of each displayed nickname in that order, and sort Master → SubMaster → SwordMaster → regular members before applying the existing contribution-descending order inside each group. The same numbered order is reused by `/소드마스터`, `/부길마`, and `/길드분배` selections.
- Member rows display total guild contribution and total booster contribution with daily check marks.
- Displays `subMasters` through `getGuildSubMasterDisplay`

---

# /길드큐브 [길드옵션번호] [시도횟수]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드큐브`
- Guard: exact usage command or two complete numeric arguments

## Files

- `main.js`
- `Info.js`

## Related Helpers

- `getGuildContributionCubeData`
- `getGuildContributionCubeMemberPercent`
- `buildGuildContributionCubeOptionDisplay`
- `buildGuildContributionCubeProbabilityMessage`
- `buildGuildContributionCubeLogMessage`
- `calculateCastleExp`
- `calculateRaidExp`
- `applyGuildTerritoryTurnReward`
- `resolveGuildTerritoryAttack`

## Data Usage

- `guildData.guilds[guildId].members[sender].contribution`
- `guildData.guilds[guildId].cubeOptions`
- `guildData.guilds[guildId].cubeLogs`

## Save Flow

- Loads member and guild data once in the common response flow.
- A successful cube run deducts only the actually processed contribution, updates integer 0.1% units, keeps the latest 50 logs, and saves `guildData` through `saveJsonFile(guildData, guildPath)`.
- Permission, maximum, count, and insufficient-contribution failures do not save or mutate persistent data.

## Related Commands

- `/길드큐브확률`
- `/길드큐브기록`
- `/길드정보`
- `/길드공헌`
- `/영지공격 [1-9]`

## AI Notes

- Any valid current guild member can use the cube with only their own stored guild contribution; each successful command deducts the actual processed cost from that member while the shared guild option continues accumulating.
- Castle and raid percentages are added to the active home-badge percentage before one multiplication.
- A member must match both `data.member[*].guild.id` and the guild's `members` map, so leaving or expulsion removes the buff immediately.
- Territory point bonus applies only to the base attack-turn guild point reward; ambush defense is checked only after a surprise-attack item succeeds.
- The common response transaction lock and exclusive mutation lock prevent concurrent cube updates from double-spending contribution.

---

# /길드큐브확률

Status: VERIFIED

## Files

- `main.js`

## Save Flow

- Read-only; requires current guild membership and does not save data.

---

# /길드큐브기록

Status: VERIFIED

## Files

- `main.js`

## Save Flow

- Read-only; displays the current guild's most recent 50 `cubeLogs` entries and does not save data.

---

# /부스터수정 [아이디] [수량|+수량|-수량]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/부스터수정`

## Files

- `main.js`

## Data Usage

- `data.member[target].boostercnt`

## Save Flow

- Master 전용이며 부호가 없는 수량은 증가로 처리한다.
- 변경 후 값이 0 미만이거나 안전 정수 범위를 넘으면 저장하지 않는다.
- `member.json` 저장 후 다시 읽어 변경 수량이 일치하는지 검증한다.

---

# /부길마 [번호] ([번호])

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/부길마`

## Files

- `main.js`

## Related Helpers

- `getMyGuildInfo`
- `getGuildOrderedMemberKeys`
- `ensureGuildSubMasters`
- `getGuildSubMasterDisplay`
- `isGuildLeader`

## Data Usage

- `guildData.guilds[myGid].subMasters`
- `guildData.guilds[myGid].members[name].role`
- `data.member[name].guild.role`

## Save Flow

- Saves `guildData` after replacing the current sub-master list
- Saves `data` after synchronizing member guild roles

## Related Commands

- `/길드정보`
- `/길드상세정보`
- `/소드마스터`

## AI Notes

- Accepted only as `/부길마` or `/부길마 [number] ([number])`
- The command itself is actual guild-master only; selected members receive shared guild operation authority through `isGuildLeader`
- Maximum two sub-masters are retained, and invalid, duplicate, master, or non-member selections are rejected

---

# /소드마스터 [번호] [번호] [번호] ([번호])

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/소드마스터`

## Files

- `main.js`

## Related Helpers

- `getMyGuildInfo`
- `isGuildLeader`
- `getGuildOrderedMemberKeys`
- `getGuildSwordMasterLimit`
- `hasGuildTerritoryKnightOrderLeader`

## Data Usage

- `guildData.guilds[myGid].swordMasters`
- `guildData.guilds[myGid].subMasters`
- guild territory war state

## Save Flow

- Saves `guildData` after replacing the current sword-master list

## Related Commands

- `/길드정보`
- `/부길마`
- `/영지공격`

## AI Notes

- Accepted only with full numeric member-number arguments.
- Guild master and sub-master can execute through `isGuildLeader`.
- The required count is 3, or up to 4 when knight-order leader conditions allow the extra slot.

---

# /내정보

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/내정보`

## Files

- `Info.js`

## Related Helpers

- `initSweetHomeUser`
- `getTitle`
- local branch helper `hasValidPet`
- `requireGmEducationStore`, `getGmEducationProgress`: Main과 같은 교육 원본/지급 영수증 검증

## Data Usage

- `data.member[sender]`
- `petData[sender]`
- `titleData.member[sender]`
- `homeData[sender]`
- `gmEducation.json`, `member.gmEducationRewards`: 확정 교육 수. 레벨 다음 한 줄 표시, 환경별 파일 수정 시각/크기 캐시, 조회 저장 없음

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/정보 [닉네임]`
- `/펫정보`
- `/타이틀목록`

## AI Notes

- Main self-profile summary command in `Info.js`
- Good navigation anchor when debugging user-visible summary formatting
- Loads sweet-home data even though command is primarily informational

---

# /정보 [닉네임]

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/정보`
- Admin or master only

## Files

- `Info.js`

## Related Helpers

- `getTitle`
- `generateBagOutput`
- `isAdmin`
- `isMaster`

## Data Usage

- `data.member[targetUser]`
- `titleData.member[targetUser]`
- `data.member[targetUser].bag`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/펫정보`

## AI Notes

- Admin inspection path for another user's summary
- Useful when debugging user-specific bag/title visibility without impersonating sender
- 레벨 다음에 조회 대상의 호월 교육 진행도를 표시한다. `/내정보`와 교육 읽기 캐시·원본/영수증 검증을 공유하며, 완료 수 0~12와 다음 챕터/전체 수료를 조회만 한다.

---

# /펫정보

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/펫정보`
- Aliases: `/ㅎ`, `ㅁㅁㅁ`

## Files

- `Info.js`

## Related Helpers

- `initSweetHomeUser`
- `getHomeTotalExp`
- `getCritChance`
- `calculateRaidExp`
- `calculateCastleExp`
- `calculateTotalExp`
- `getEquippedNonTierPetSkillExp`
- `isInfoPetSkillCharmConditionActive`
- `getMemberRank`
- `getTitle`
- `initPetSkillUser`
- `getPetSkillSlotCount`
- `getIntimacyLvFromBag`
- `getIntimacyUserRank`
- `getUserIntimacyInfo`
- Pendant equipment display is handled inline in `/펫정보`; legacy `ring` data should be migrated through `/반지보상받기` and removed from active equipment data.
- `/펫정보`와 `/ㅎ`의 요약에는 패스 회원일 때만 `[🐶호패 전용]`과 3종 완료 아이콘을 표시한다. 비회원 요약에는 패스 안내 줄을 추가하지 않지만, 상세 화면은 전용 일퀘 영역을 유지하며 세 조건을 `[호패,초패 회원전용]`으로 안내한다.

## Data Usage

- `petData[sender]`
- `data.member[sender]`
- `homeData[sender]`
- `petExploreData`
- `trialTower.user[sender]`
- `castleBattleData`
- `petTitleData.member[sender]`
- `petSkillData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/종합순위`
- `/시련의탑`
- `/펫상태`
- `/미니펫통계`

## AI Notes

- High-value aggregation command for pet, mini-pet, home, tower, castle, intimacy, and skill state
- Best anchor for bugs involving displayed total charm or mismatch between ranking and profile output
- `calculateTotalExp` here is the canonical clue for rank formula investigations
- `calculateTotalExp`(Main/Info), Info `/펫정보`와 `buildNicknameWorldRanks`는 같은 회원의 캐슬·레이드 한 쌍에서만 장비 합계·미니펫 매력·인테리어 적용 전 집 매력을 재사용한다. 두 모드 helper의 선택적 8번째 인수는 지역 공유 객체이며, 기존 7개 인수 호출은 그대로 독립 계산한다. `response(...)`의 7개 인수 계약은 변경하지 않는다.
- `/펫정보`는 레이드→캐슬, 종합매력·닉네임 순위는 캐슬→레이드 순서를 유지한다. 스킬 초기화·별채 검증·모드별 보너스와 반올림은 각각 기존 위치에서 수행하며, 펜던트 승급값 정규화 후 데이터 상태도 유지한다. 전역 사용자 캐시나 추가 파일 입출력은 없다.
- `/펫정보`의 펫강화 줄은 대표 홈뱃지 큐브를 반영한 최종 유효 강화수치만 표시한다. 치명타는 유효 강화수치를 사용하지만 강화 성공확률은 변경하지 않는다.
- `/펫정보`의 캐슬·레이드 매력은 장착 홈뱃지 옵션(프리미엄 +3%p 포함), 길드공헌 큐브, 모험가 레벨, 퀘스트 누적 보너스를 0.001% 단위로 합산한 현재값이며, 종합매력은 이 두 값과 홈뱃지 옵션 3을 반영한 펫강화 매력을 더한다.
- 일반 종합매력 펫스킬 12종은 `Info.js`의 공통 매력표로 레이드·캐슬 매력을 합산해 `/펫정보`와 `/종합순위`에 동일하게 반영한다. `전설의 몽둥이📙[한정판]`는 장착 중에만 레이드·캐슬 매력 50만씩을 더한다.
- `getMiniPetSkillCharmRate`는 창조림·엘리트 박사의 등급 조건을 대표·보조 슬롯에서 각각 판정해 대표 100% + 보조 50%를 합산하며 가방 보유만 한 미니펫은 제외한다. `getEquippedNonTierPetSkillExp`는 장착 목록만 합산해 프리미엄 잠금 스킬을 제외한다. 엘리트 기존 표기는 유지하고 창세 등급은 창조림에서 제외한다.
- `아르카나 하우스📙`는 가방·배치 합산 아르카나 루미에르 가구 5개 이상일 때만 종합매력에 반영한다.
- Pet skill slot display should stay aligned with `/펫스킬`, including `펫스킬 학개론` bonus slots
- 창조림은 캐슬·레이드 각각 대표 +50만·보조 +25만, 엘리트 박사는 각각 대표 +150만·보조 +75만이다. 양쪽 충족 시 각 스킬의 150%를 적용하고 기존 퍼센트 보너스 계산 순서를 유지한다.

---

# /길드목록

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드목록`

## Files

- `main.js`

## Related Helpers

- `getJoinableGuildRows`

## Data Usage

- `guildData.guilds`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/길드생성`
- `/길드정보`
- `/길드가입`
- `/길드상점`

## AI Notes

- Entry point for joinable guild listing
- Uses the same filtered guild row set as guild join flow
- `징집명령📙`을 장착한 길드마스터의 길드는 최대 인원이 `+1` 보정된 값으로 노출된다

---

# /길드상세정보 [길드명]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드상세정보`

## Files

- `main.js`

## Related Helpers

- `findGuildIdByNameSafe`
- `buildGuildResourceDisplay`
- `ensureGuildTerritoryBoosterCount`

## Data Usage

- `guildData.guilds`
- `guildData.guilds[*].guildTerritoryBooster`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/길드정보`
- `/길드목록`

## AI Notes

- Admin/master investigation command for named guild lookup
- Good anchor when debugging guild member snapshots without relying on sender membership
- Guild resource display is shared with `/길드정보` through `buildGuildResourceDisplay`
- Displays `길드영지 부스터🔮` below guild contribution count

---

# /길드상점

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드상점`

## Files

- `main.js`

## Related Helpers

- `ensureGuildShop`
- `numberWithCommas`

## Data Usage

- `guildData.shop`
- `data.HoiCastle.taxRate`

## Save Flow

- Read-only in the confirmed view branch

## Related Commands

- `/길드상점구매`
- `/길드상점추가`
- `/길드상점삭제`
- `/길드가입`

## AI Notes

- Canonical shop display for guild-only consumables and permissions items
- Nearby purchase branch mutates both guild and member state, and uses `applyTax` so the non-guild tax share is reflected in the Happy Foundation ledger

---

# /길드순위

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드순위`

## Files

- `main.js`

## Related Helpers

- `buildGuildRankingRows`

## Data Usage

- `guildData.guilds`
- `data.member`
- `petData`
- `homeData`
- `petSkillData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/길드정보`
- `/길드목록`

## AI Notes

- Guild ranking aggregation depends on cross-file charm calculation inputs
- Open `buildGuildRankingRows` first when ranking output looks wrong

---

# /길드게시판

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/길드게시판`
- Alias: `/길메`

## Files

- `main.js`

## Related Helpers

- `getMyGuildInfo`
- `ensureGuildBoard`

## Data Usage

- current sender guild object inside `guildData.guilds`
- guild board state on guild object

## Save Flow

- View branch is read-only
- Nearby write branches call `saveJsonFile(guildData, guildPath)`

## Related Commands

- `/길드게시판 내용`
- `/길드게시판공지`
- `/길드게시판초기화`

## AI Notes

- Use this as the main board structure anchor
- Posting and notice behavior is implemented in nearby branches

---

# /당근게시판

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/당근게시판`

## Files

- `main.js`

## Related Helpers

- `checkRank`

## Data Usage

- `carrotBoardPath`
- `carrotBoard.memo`

## Save Flow

- View branch is read-only
- Nearby board creation and cleanup branches save to `carrotBoardPath`

## Related Commands

- `/당근`
- `/당근완료`
- `/당근게시판삭제`

## AI Notes

- Canonical public market board display
- Good anchor for carrot-board schema and output order

---

# /가구정보 [닉네임]

Status: VERIFIED

## Files

- `main.js`, `Info.js` (shared combat arithmetic)

## Related Helpers

- `getPetHomeFurnitureCharm`, `getPetHomeVillageState`, `getPetHomeVillageLevelLimit`
- `buildPetHomeFurnitureInfoMessage`, `buildPetHomeFurnitureSkillMessage`, `getPlacedFurnitureList`

## Data Usage and Save Flow

- Home summary, original equipped-item order and queried owner's equipped skills; no save or inventory sorting on this command.
- No argument queries self; a nickname including spaces queries that owner. No Admin/Master restriction. Only self views show executable bag/registration guides.
- Final charm/village above `allsee`; explanation and active skills precede the complete equipped list at the very bottom.
- The final total, castle charm and raid charm each occupy a separate line.
- Castle/raid calculators in both scripts and Main diagnostics add the same scoped extra once before existing overall buffs. `/종합순위` reflects it; `/가구순위` retains individual base values.
- Village percent applies to furniture plus active royal/arcana-house charm. Interior master's existing 10% remains outside that base. Equipped `느그 집 마련의 꿈` adds 10 percentage points to the royal+arcana percent, including level-zero homes; apply that combined percent once and floor per mode. Unequipped ownership gives no effect. The S-grade detail shows its existing actual 0.3% probability. Furniture/village totals and calculation UI include the skill in the combined buff without a separate additional-charm line.

---

# /별채등록 [가구가방번호] …

Status: VERIFIED

## Files / Helpers

- `main.js`: `preparePetHomeVillageRegistration`, `buildPetHomeVillageRegistrationMessage`, `getPetHomeFurnitureCharm`

## Input and Mutation

- Exact command or full numeric-argument pattern; 1–10 distinct bag numbers across royal/arcana grades. Extra guide text does not execute.
- `등록한다` / `등록안한다`: same account, room, group-chat mode and DEV/PROD context, 60-second pending state. Confirmation state is memory-only and expires/restarts without consuming items.
- Sort with the existing bag-number convention. Revalidate full bag fingerprint, individual ownership/equipment, grade capacities, skills and predicted effect. Changed bag cancels all; changed effects require another confirmation.
- State: `homeData[user].lumiereVillage.{royal,arcana}.{level,progress}`. Missing state reads as zero without creating/saving it. Each 10 same-grade pieces gives one level; each 10 actual house-area units permits one level per annex. At-cap overflow cancels the entire mixed request.
- On confirmation remove pending first, consume only selected unequipped pieces, persist the new home once with the existing command transaction and pre-mutation snapshot. No skill/member-file rewrite or permanent per-registration history.
- Royal uses 10 equipped pieces; arcana uses 5 owned pieces (bag plus equipped). Losing arcana eligibility updates its base and village contribution and may lower final charm.
- Active state adds roughly 90 bytes per registering user; calculation helpers perform no file IO.

---

# /가구순위

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/가구순위`

## Files

- `main.js`

## Related Helpers

- `checkRank`

## Data Usage

- `placedFurnitureData[*]`
- `data.member`
- `petData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/가구가방`
- `/가구정보`

## AI Notes

- Ranking is based on placed furniture items, not bag contents
- Before initial separation, the command falls back to legacy `homeData[*].placedFurniture`.
- This branch reloads member and pet data locally before formatting names

---

# /가구가방정리 [기준매력]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/가구가방정리`

## Files

- `main.js`

## Related Helpers

- `initSweetHomeUser`
- `checkRank`

## Data Usage

- `homeData[sender].furnitureBag`
- `data.member[sender].point`

## Save Flow

- Mutates `homeData`
- Mutates member point state
- Saves `homeData` and member data in branch

## Related Commands

- `/가구가방`
- `/가구전체정리`

## AI Notes

- Threshold-based bulk cleanup command for low-exp furniture
- Check reward point formula in this branch before changing cleanup balance

---

# /미니펫정보 [닉네임]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/미니펫정보`

## Files

- `main.js`

## Related Helpers

- `buildMiniPetInfoRenewedMessage`
- `getEquippedPetSkillNames`
- `getMiniPetSkillCharmRate`
- `getPetSkillData`
- `buildMiniPetRobberyHistoryMessage`
- `isAdmin`
- `isMaster`

## Data Usage

- `petData[targetName]`

## Save Flow

- 조회만 수행하며 저장하지 않는다.

## Related Commands

- `/미니펫가방`

## AI Notes

- 인자 없이 입력하면 자신의 대표·보조 편성을 표시한다. 관리자·MASTER는 닉네임을 지정해 타인을 조회할 수 있다.
- 매력 기준 설명과 미대전 전적·승률·순위·이용 횟수·무료 안내는 출력하지 않는다. 미대전 데이터와 기능, 약탈자 안내와 기록, 하단 명령 안내는 유지한다.
- 본인·대상 조회는 이미 로드한 `petSkillData`를 출력 함수에 전달한다. 슬롯에는 미니펫 자체 매력을 표시하고, 창조림·엘리트 박사의 활성 장착·등급 조건에 따른 추가 매력과 이를 포함한 캐슬·레이드 합계를 별도로 표시한다. 잠금·미장착 스킬은 합산하지 않으며 같은 스킬의 별칭은 중복 가산하지 않는다.
- 미니펫 정보 합계는 다른 퍼센트 보너스 적용 전 기여분이다. 퍼센트 보너스를 포함한 전체 종합매력은 `/펫정보`에서 확인한다.
- 약탈자 스킬 장착 시 성공 기록을 두 번째 메시지로 최대 50건 출력한다.
- 약탈 기록은 닉네임 제목 다음에 `allsee`를 한 번 적용한다. 기록 0건일 때도 확률·금액·빈 기록 안내를 전체보기 안에 표시한다.
- 하단 안내는 대표·보조 장착 → 대표 `0`·보조 `00` 강화 → 대표·보조 귀속해제 → 귀속해제권 안내 순서로 표시한다.

---

# /미니펫가방정리 [기준매력]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/미니펫가방정리`

## Files

- `main.js`

## Related Helpers

- `checkRank`

## Data Usage

- `petData[sender].miniPetBag`
- `data.member[sender].point`

## Save Flow

- Mutates mini-pet bag
- Mutates member point state
- Saves `petData` and member data in branch

## Related Commands

- `/미니펫가방`
- `/미니펫판매`

## AI Notes

- Threshold-based mini-pet cleanup and sale command
- `창조`, `창세`, `태초+`, `태초`, and elite mini-pets are protected from cleanup sale
- Inspect this branch first for reports about unexpected bulk removals

---

# /미니펫대전

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/미니펫대전`

## Files

- `main.js`

## Related Helpers

- `getTotalMinipetExp`
- `calculateCriticalDamage`
- `hasPetSkill`
- `buildBattleExperienceRewardMessage`

## Data Usage

- `data.member[sender].point`
- `data.member[sender].exp`
- `data.member[sender].bag["호이의 봉인금고🔒(/봉인금고오픈 숫자)"]`
- `petData[sender].miniPet`
- `petData[sender].miniPetBag`
- `petData[sender].miniPetBattle`
- `petData[sender].miniPetSupport`
- `petData[sender].miniPetRobberyHistory`

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)` after point, item, and experience rewards.
- Saves pet data through `saveJsonFile(petData, memberPetPath)` after battle count and win/loss mutation.

## AI Notes

- 양측 기본 미니펫 매력에 크리티컬을 각각 한 번 적용한 뒤 최종 매력을 직접 비교하며, 동률이면 방어자가 승리한다.
- 기본 매력은 `(대표 원본 + 보조 원본의 50% 버림) × 2`이며 기존 가방 최소 5마리 입장 조건은 유지한다.
- 출력 상단에는 대전횟수·리셋권, 경험치, 승패와 대전 상대를 먼저 표시하고 `미니펫대전 상세결과`부터 `allsee`로 접는다. 상세 영역은 공격·방어 미니펫 외형과 강화 수치, 등급, 장착/미니펫/최종 매력, 크리티컬, 비교식, 매력 차이와 기존 보상을 유지한다.
- 미니펫대전 경험치는 승리 100 EXP, 패배 25 EXP이며 기본 EXP에 현재 티어의 고정 EXP를 더한 뒤 호월신의 가호를 적용하고 레벨 상승을 처리하는 공통 경험치 흐름을 사용한다.
- 수동 미니펫대전에서 레벨업·승급·대승급이 발생하면 대전 결과 다음 메시지로 안내를 별도 출력한다. 자동일퀘에서는 기존 즉시 안내만 출력해 중복을 막는다.
- 카드 상단의 경험치 아래에 현재 공격 결과를 `✅ 승리` 또는 `❌ 패배`와 양쪽 사용자로 표시한다.
- 기본 아이템 보상은 봉인금고를 제외한 기존 6종 중 1종을 같은 비율로 추첨한다. 봉인금고는 일일퀘스트 완료 보상으로 하루 1개 지급한다.
- `약탈자`, `헌터`, `만렙헌터`, `야수의 본능`, `정신승리` 후속 펫스킬 판정과 저장 흐름을 유지한다.

---

# /시련의탑

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/시련의탑`

## Files

- `main.js`

## Related Helpers

- `calculateTotalExp`
- `calculateCriticalDamage`
- `difftypeBuff`
- `hasPetSkill`
- trial tower reward and floor helpers in nearby branch logic

## Data Usage

- `data.member[sender].towerCnt`
- `trialTower.user[sender]`
- `homeData[sender]`
- `petData[sender]`

## Save Flow

- Mutates tower progress and member state
- Saves `trialTower`, member data, and sometimes pet data in branch
- `/시련의탑` 1~5층 도전은 포인트와 리셋권을 소모하지 않는다.

## Related Commands

- `/시련의탑순위`
- `/시련의탑시즌시작`
- `/시련의탑시즌종료`

## AI Notes

- High-impact progression branch with daily entry count and reward logic
- 도전자 크리티컬·양측 상성 적용 후 최종 매력을 직접 비교하며, 동률이면 보스가 승리한다.
- 직접 비교에서 패배한 경우에만 `시련을 걷는 자`와 `시탑 공략서📜` 순서로 기존 추가 판정을 수행한다.
- 도전자 `종합매력`은 `/종합정보`와 같은 `calculateTotalExp` 원본값을 표시하며, 구원·십원 발동 매력은 `추가보정`으로 분리한 뒤 실제 전투 상성·크리티컬 계산에 반영한다.
- 출력은 도전자 종합매력과 수호자매력, 상성/최종 매력, 비교식, 매력 차이, 추가 판정과 공략 결과를 카드형 UI로 표시하며 `최종 매력 비교` 뒤부터 `allsee`로 접는다.
- 카드 상단의 공략횟수 아래에 현재 결과를 `✅ 공략 성공` 또는 `❌ 공략 실패`로 먼저 표시한다.
- Best anchor for tower floor, entry limit, and reward regression investigations

---

# /호이봇버전, /개발자노트

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/호이봇버전, /개발자노트`

## Files

- `main.js`

## Related Helpers

- `buildHoiBotChangeLogMessage`

## Data Usage

- `hoiBotChangeLogPath`

## Save Flow

- `/개발자노트` reads `hoiBotChangeLogPath`
- Read-only; no save

## Related Commands

- `/호이봇버전`
- `/개발자노트`

## AI Notes

- `/호이봇버전` replies with `ver_` + `HoiBotVersion`
- `/개발자노트` is admin/master-only and shows the latest 10 entries from the manually maintained `data/hoiBotChangeLog.json` after an `allsee` fold marker
- Entries are grouped under date sections in the output; each production-facing change still increments `HoiBotVersion` by `0.001`
- `HoiBotVersion` should be increased by `0.001` whenever source changes are intentionally reflected

---

# /자동일퀘

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/자동일퀘`

## Files

- `main.js`

## Related Helpers

- `runAutoDailyQuest`
- `runAutoDailyInternalCommand`
- `runAutoDailyQuestCommands`
- `beginAutoDailyBatch`
- `commitAutoDailyBatch`
- `buildAutoDailyQuestMessage`
- `formatAutoDailyPetSkillActivationLines`
- `summarizeAutoDailyBattleExperience`
- `replyAutoDailyAdventureLevelUps`
- `buildQuestExperienceRewardMessage`
- `buildAdventureBoosterDepletionMessage`
- `isAutoDailyQuestRunComplete`
- `getDailyQuestStatus`
- `claimQuestReward`
- `ensureCastleBattleRecord` via `/캐슬대전`

## Data Usage

- `data.member[sender].bag["자동일퀘권📝"]`
- `data.member[sender].towerCnt`
- `data.member[sender].battle`
- `data.member[sender].petHomeCommentCnt`
- `data.member[sender].homeLikeCnt`
- `data.member[sender].cntlike`
- `data.member[sender].passDailyQuestCnt`
- `petData[sender].miniPetBattle`
- `trialTower.user[sender]`
- `petExploreData.record[sender]`

## Save Flow

- Creates member, pet, and pet-skill backup snapshots before automated mutation
- Loads automatic-daily data into a thread-local memory batch, repeats 시탑/캐대전/미대전 until each count reaches the normal daily maximum plus 5 bonus runs or the underlying command stops progressing, then saves each changed file once
- Uses an exclusive automatic-daily response lock so ordinary command data processing cannot overwrite the in-memory batch while it is running
- Filters successful internal battle/result output out of auto-stop reasons, so only blocking messages or concise fallback progress messages are shown
- Captures internal command exceptions as auto-stop messages instead of falling through to a generic no-progress reason
- Silently executes existing `/시련의탑`, `/캐슬대전`, and `/미니펫대전` command paths for remaining daily counts
- Sends an immediate "자동일퀘 계산 중" progress notice before long-running internal command execution
- Compares in-memory snapshots immediately after each internal command without disk-flush sleep delays
- Claims daily/weekly/premium quest experience rewards in the same memory batch before the final save
- 자동일퀘 안에서도 각 대전·퀘스트 EXP 지급 시 가호 3배와 티어 보너스, 레벨 상승, 레벨당 포인트 보상을 즉시 처리한다.

## Related Commands

- `/시련의탑`
- `/캐슬대전`
- `/미니펫대전`
- `/퀘스트`
- `/일퀘완료`

## AI Notes

- Triggers: `/자동일퀘`, `ㅇㅋㅋ`
- Requires `자동일퀘권📝` in the user bag
- 오늘 일일퀘스트 보상을 이미 받은 사용자는 자동 계산을 시작하지 않고 완료 안내를 즉시 표시한다.
- 시탑·캐대전·미니펫대전을 자동일퀘 보너스 횟수까지 이미 완료한 사용자는 0회 결과표 대신 완료 안내를 즉시 표시한다.
- `자동일퀘권📝` allows 5 additional reward runs for 시탑/캐대전/미대전, so automatic execution targets 20 while manual commands remain capped at 15
- 자동일퀘 결과 제목 아래에 `[자동일퀘 보너스 발동!]`, `[😈시탑,🐹미대전,🏆캐대전 5판 추가 보상👌]` 안내를 표시한다.
- The 5 bonus runs reuse the existing battle flows, including reset-ticket/point costs, random rewards, win/loss records, and pet-skill effects
- Pet exploration is intentionally excluded; daily quest reward is only claimed when all four daily quest categories are complete
- Internal command execution is excluded from rapid request monitoring and command backup duplication
- 공통 카드형 UI로 바뀐 시탑·캐슬대전·미니펫대전 제목을 성공 결과로 인식해 정상 진행 결과가 중단 사유로 오인되지 않는다.
- 내부 캐슬대전·미니펫대전은 장착 펫스킬 효과를 동일하게 적용하며, 실제 발동한 스킬과 횟수를 자동일퀘 결과에 표시한다. `약탈자`는 누적 획득 포인트, `숙련된 전사`는 누적 획득 매력을 함께 표시한다.
- 자동일퀘 경험치는 실행 전후의 잔여 경험치 차이가 아니라 내부 캐슬대전·미니펫대전 결과와 같은 실행에서 수령한 일일·주간·프리미엄 퀘스트 보상의 실제 지급값을 합산하므로, 반복 중 레벨업으로 잔여 경험치가 차감되어도 정확히 표시된다.
- 자동일퀘 결과는 각 지급 시점의 `기본 경험치`, `티어 보너스`, `호월신의 가호 추가 경험치`, `총 경험치`, `가호 사용량`을 각각 합산해 분리한다. 가호 잔량이 최대 추가 경험치보다 적으면 남은 수량만큼만 추가 지급·차감하며, 추가분이 없으면 `호월신의 가호 적용: 없음`으로 표시한다.
- 캐슬대전·미니펫대전·수동/자동 퀘스트에서 가호가 0개가 되면 공통 소진 안내를 결과 본문에 합치지 않고 별도 메시지로 출력한다.
- 자동일퀘 내부에서도 경험치가 필요량을 넘는 즉시 레벨과 레벨당 포인트 보상을 처리하고, 해당 레벨업·승급·대승급 안내를 바로 출력한다. 최종 결과까지 문구를 모아두거나 다음 채팅을 기다리지 않는다.
- 자동일퀘 결과의 접히지 않는 영역에 이번 실행에서 실제 지급한 레벨업 포인트와 레벨업 횟수를 별도로 표시한다. 총 포인트 변동은 모든 획득·사용을 합산한 순변동이며, 레벨업 포인트가 있으면 총액에 포함되었음을 바로 아래에 안내한다.
- Daily quest target counts are 시탑 5, 캐대전 5, 미대전 5, 펫탐험 10
- 활성 호이패스·초보패스 유저에게 마음 주기·인형뽑기·홈알림 열기 각각 1회의 별도 일퀘가 적용되며, 완료 시 `1억포인트상자🪙(/포인트상자오픈)` 2개를 독립 지급한다. 기존 좋아홈·유저 좋아요는 이 일퀘에 반영하지 않으며 기존 4종 일퀘 완료 판정과 주간 누적에는 영향을 주지 않는다.
- `/퀘스트`와 `/ㅋ`에서는 제목을 `📜 일일 · 주간 · 🐶호이패스`로 표시하고, 패스 전용 일퀘 조건·보상을 일반 일일 퀘스트 조건보다 먼저 보여준다.
- `/퀘스트`, `/ㅋ`, `ㄹㄹㄹ` 안내 화면은 첫 줄에 요청 유저의 `[checkRank] 님`을 표시한다.
- `/퀘스트` 안내에는 일일 100 EXP, 주간 500 EXP, 프리미엄 전용 일퀘 50 EXP를 각 보상 영역에 표시한다. 완료 시 기본 EXP에 현재 티어의 고정 EXP를 먼저 더하고 보유 가호 범위에서 최대 3배까지 적용하며, 실제 총 지급량과 기본·티어·가호 추가분·사용량을 표시한다. 가호 소진과 레벨업도 기존 공통 흐름으로 처리한다.
- 패스가 없는 사용자도 `/퀘스트`와 `/ㅋ`에서 패스 전용 일퀘 영역을 볼 수 있으며, 제목 다음 빈 줄에 세 조건을 `[호패,초패 회원전용]`으로 표시하고 마지막 조건 바로 아래에 구분선을 둔다.
- `/일퀘완료`와 `/ㅇ`의 미완료 안내에서는 일반 일퀘 진행도와 패스 전용 일퀘 사이에 구분선을 표시하고, 전용 보상 제목 앞에 빈 줄을 둔다.
- 패스 전용 조건은 정상 `/마음` 및 `/귀여워`·`/응원해`·`/멋져요`·`/사랑해`의 공유 `passHeartGiveCnt`, 실제 이용권을 소모한 `/인형뽑기`의 `passDollDrawCnt`, 정상 `/홈알림`의 `homeAlertOpenCnt`로 판정한다. 마음의 수량 생략/명시 모두 인정하며 기존 UI는 유지한다. 인형 실패도 인정한다. 옛 댓글/피드 카운터는 해당 기능에서 유지되지만 패스 일퀘 판정에는 사용하지 않는다. 새 진행도와 전용 수령 횟수는 기존 `/리셋` 주기에 초기화된다.
- Daily quest, battle, command-use, display, happy-foundation, title-gift, punch-machine, and guild-territory settings are grouped directly in `GLOBAL_CONFIG` in `main.js`; large domains such as guild territory use nested `limits`/`timers`/`rates`/`rewards`/`items`, and mirrored display logic in `Info.js` uses the needed subset of the same object shape
- 캐슬대전 and 미니펫대전 each allow 1 free run before requiring reset tickets

---

# /일퀘횟수수정

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/일퀘횟수수정`

## Files

- `main.js`

## Related Helpers

- `editDailyQuestCountsForTest`
- `isValidDailyQuestCount`
- `getDailyQuestStatus`

## Data Usage

- `data.member[targetUser].towerCnt`
- `data.member[targetUser].battle.count`
- `data.member[targetUser].battle.ticket`
- `data.member[targetUser].exploreCnt`
- `data.member[targetUser].dailyQuestCnt`
- `petData[targetUser].miniPetBattle.count`

## Save Flow

- Saves `member.json` through `saveJsonFile(data, filePath)`
- Saves `memberPet.json` through `saveJsonFile(petData, memberPetPath)`

## Related Commands

- `/자동일퀘`
- `/퀘스트`
- `/일퀘완료`
- `/캐슬대전횟수리셋`
- `/미니펫대전횟수`
- `/탐험횟수수정`

## AI Notes

- Master-only test helper for setting daily quest counters in one command
- Usage: `/일퀘횟수수정 유저명 시탑 캐대전 미대전 펫탐험 [일일보상횟수]`
- The outer command guard accepts `/일퀘횟수수정` and spaced arguments, then `editDailyQuestCountsForTest` returns usage/validation errors
- Count values must be 시탑/캐대전/미대전 0~15, 펫탐험 0~10
- Castle `battle.ticket` is normalized to `min(캐대전, 1)` so test state matches free-battle usage

---

# /패키지리스트

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/패키지리스트`

## Files

- `main.js`
- `data/packageInfo.json`
- `data/packageLog.json`

## Related Helpers

- `assertPackageLogData`
- `buildPackageListMessage`
- `buildPackageAddGuideMessage`
- `buildPackageEditUsageMessage`
- `parsePackageNaturalItemRewardSpec`
- `addPackageInfoByCommand`
- `editPackageInfoByCommand`
- `removePackageByCommand`
- `setPackageEnabledByCommand`
- `grantPackageToUser`
- `buildUserPackageBagMessage`
- `usePackageFromBag`

## Data Usage

- `GLOBAL_CONFIG.package.maxUseOnce`
- `packageInfo.json`
- `packageLog.json`
- `data.member[user].bag`
- `data.member[user].point`
- `data.petMusou.players[user].maxAttacks`

## Save Flow

- `/패키지추가`, `/패키지수정`, `/패키지제거`, `/패키지리스트제거`, `/패키지활성` mutate and save `packageInfo.json`
- `/패키지지급` mutates member bag and saves `member.json`, then appends a `GRANT` log to `packageLog.json`
- `/패키지사용` validates first, then deducts from member bag, applies `item`/`point` rewards, saves `member.json`, and appends a `USE` log to `packageLog.json`
- `/패키지알림` mutates `data.operationNotices.packageBag` and saves `member.json`

## Related Commands

- `/패키지추가방법`
- `/패키지추가시작`
- `/패키지추가취소`
- `/패키지추가상태`
- `/패키지추가`
- `/패키지수정`
- `/패키지제거`
- `/패키지리스트제거`
- `/패키지활성`
- `/패키지지급`
- `/패키지알림`
- `/패키지가방`
- `/패키지가방 [아이디]`
- `/패키지사용`

## AI Notes

- `packageInfo.json` list numbers are order-sensitive; removing a package shifts later list numbers
- `/패키지제거` and `/패키지리스트제거` physically remove the selected package entry; `/패키지활성` only restores entries that still exist with `enabled:false`
- 1차 지원 보상 타입은 `item`, `point` only
- Package name is also the bag item name; package data no longer needs a separate `itemName`
- Step flow uses `/패키지추가시작`, then package name, desc, repeated rewards, preview, and `등록`
- `packageInfo.json` load results are not normalized to an empty list; missing or invalid package data should follow the existing load/error flow
- `packageLog.json` is also not auto-created during grant/use; missing or invalid log data should follow the existing load/error flow
- `/패키지사용`은 기존·신규 패키지 모두 `GLOBAL_CONFIG.package.maxUseOnce` 기준으로 한 번에 최대 1,000개까지 사용한다
- New package quick command format: `/패키지추가 패키지명 | 설명 | 보상목록`
- Package edit quick command format: `/패키지수정 리스트번호 보상목록`
- `/패키지수정` keeps the existing package name, desc, `id`, and enabled state, updates rewards, and applies the common 1,000-use maximum
- Package edit does not use `|`; all text after the list number is parsed as the reward spec
- Step reward choices: `1/포인트`, `2/아이템`, `3/완료`, `4/취소`
- Reward spec examples: `point:10000000`, `item:펫 강화석⭐:10`
- Item reward specs also accept operator-friendly `아이템명 x4,000` entries separated by commas
- 창조·창세 등급 확정 구성품의 기존 이름은 `normalizeMiniPetRewardBoxItemName`으로 신규 이름에 연결한다. `/패키지사용` 결과와 구성품 요약도 신규 이름으로 표시한다.
- `item:이름:수량`, `이름 x수량`, 단계별 `ITEM_COUNT` 입력은 모두 등급 확정 구성품의 신규 이름으로 등록한다. 기존 보유 가방의 키·수량은 일괄 변환하지 않는다.
- `/패키지가방 [아이디]` is Master/Admin-only and reads another user's package bag without mutating or saving data
- `/패키지가방` displays `data.operationNotices.packageBag` above the package list when configured, then separates support-pass status from territory attack, pet-Musou preparation, and attendance automation status. 영구 패스는 `영구권 사용 중 [✅]`으로 구분하며, missing or expired entitlements display `이용 불가 [🔒]`; the view is read-only and does not initialize automation data.

---

# /정리알림 내용

Status: VERIFIED

## Files
- `main.js`

## Related Helpers
- `setOperationNoticeByCommand`
- `ensureOperationNoticeData`
- `getOperationNotice`
- `normalizeOperationNoticeText`

## Data Usage
- `data.operationNotices.cleanup`

## Save Flow
- Saves `member.json` after updating the cleanup notice text

## AI Notes
- `/n` and `\n` in the saved notice text are normalized to actual line breaks before display

## Related Commands
- `/정리`
- `ㅇㅇㅇ`

---

# /패키지알림 내용

Status: VERIFIED

## Files
- `main.js`

## Related Helpers
- `setOperationNoticeByCommand`
- `ensureOperationNoticeData`
- `getOperationNotice`
- `buildUserPackageBagMessage`

## Data Usage
- `data.operationNotices.packageBag`

## Save Flow
- Saves `member.json` after updating the package bag notice text

## AI Notes
- `/패키지가방` displays saved package notices with an `(알림)` prefix.
- The support pass and automation sections follow `allsee`, show active expiry dates or `사용 중`, and distinguish ON, OFF, and unavailable/locked states without saving data.

## Related Commands
- `/패키지가방`
- `/패키지가방 [아이디]`

---

# /펫무쌍준비|/펫무쌍시작|/펫무쌍공격 [1-10]|/펫무쌍종료|/펫무쌍전체초기화|/무쌍순위|/벼락확률 [0-100]|/티켓이벤트시작|/티켓이벤트종료|/티켓전체회수

Status: VERIFIED

## Files
- `main.js`
- `Info.js`

## Related Helpers
- `ensurePetMusouData`
- `joinPetMusou`
- `beginPetMusou`
- `processPetMusouAttack`
- `processPetMusouTimeout`
- `resolvePetMusouBattle`
- `processPetMusouLightning`
- `finishPetMusou`
- `resetAllPetMusouData`
- `buildPetMusouAttackDetailMessage`
- `startPetMusouTurnTimer`
- `recoverPetMusouTurnIfNeeded`
- `buildPetMusouRankingMessage`
- `runScheduledPetMusouStart`
- `ensurePetMusouScheduleTimer`
- `grantPetMusouTicketEventCoupon`
- `processPetMusouTicketEventAdminCommand`
- `checkRank`

## Data Usage
- `data.petMusou`
- `data.petMusou.nextParticipants`
- `data.petMusou.nextRoundId`
- `data.petMusou.realFlagDiscoveryBonusPaid`
- `data.accountSuspensions.users`
- `data.member[user].musouWinCount`
- `data.member[user].musouLastWinAt`
- `data.member[user].point`
- `data.member[user].bag["영지기습공격권🔥(40%)"]`
- `data.member[user].bag["영지절대방어권🛡(50%)"]`
- `data.member[user].bag["피뢰침⚡(자동 벼락 방지)"]`
- `data.petMusouTicketEvent`
- `data.member[user].bag["티켓이벤트할인쿠폰🎟️(10~50%)"]`
- `petData`, `homeData`, `petSkillData`, `guildData` (대회 시작 시 종합매력 스냅샷)

## Save Flow
- 참가, 시작, 공격, 시간 초과, 강제 종료, 전체 초기화 결과는 `member.json`의 기존 DEV/PROD 경로 흐름으로 저장한다.
- 운영 컨텍스트에서는 KST 기준 매일 12:30에 정규 펫무쌍 시작을 확인하고, 티켓 이벤트가 활성화되어 있으면 날짜 제한 없이 20:30 시작을 추가한다. 타이머 등록 직후에도 현재 회차를 확인하고 날짜·시각 키로 중복 실행을 막으며 맞짱필드·길드 영지전과 동시 시작하지 않는다.
- `/티켓이벤트시작`, `/티켓이벤트종료`, `/티켓전체회수`는 이벤트 상태·로그·쿠폰 회수 결과를 `member.json`에 한 번 저장한다. 시작은 운영 기간 제한 없이 가능하며, 이벤트 종료만으로 보유 쿠폰을 회수하지 않는다.
- `/벼락확률 [0-100]`은 진행 중인 대회의 `lightningRate`만 변경하고 `member.json`을 한 번 저장한다. `dev/` 입력은 기존 DEV 컨텍스트의 `member.json`에만 반영한다.
- 종합매력과 크리티컬 기준값은 60초 참가 모집 마감 시점에 저장하며 진행 중 실시간 변경을 반영하지 않는다.
- 다음 회차 준비자와 현재 회차 참가자를 별도 객체로 저장한다. 참가 신청과 대회 시작 시점에 길드·펫·계정정지 상태를 각각 확인하며, 신청 뒤 정지된 참가자는 시작 대상에서 제외한다.
- 참가 신청 명령은 `/펫무쌍준비`이며 `/펫무쌍참가` 별칭은 사용하지 않는다. `/펫무쌍시작`은 `오픈채팅봇`, 기존 명령어방 MASTER, 서버관리자방의 등록된 Admin·Master가 실행할 수 있다.
- `/펫무쌍준비` 성공 안내의 접힌 영역에는 규칙과 현재 다음 회차 준비자 전원의 체크랭크 목록을 함께 표시하며, 방금 준비한 사용자도 목록에 포함한다. 강제 종료·공격 소진·시간초과로 대회가 끝나면 프리미엄 자동 준비 ON 이용자를 다음 회차에 즉시 등록하고 종료 결과에 등록·제외·실패 인원을 표시한다.
- `/펫무쌍시작`과 정시 시작은 전체 `NoticeMsg`로 60초 전 참가 모집과 공성전 링크를 안내하고 `/펫무쌍준비`를 추가 접수한다. 기존 준비자는 유지하며 마감 시 자격·능력치를 재확인해 참가자를 확정하고 첫 12초 공격 타이머를 시작한다. 실제 시작과 확정 참가자 명단은 `castleMsg`로 공성전 명령어방에만 출력한다. 참가자가 없으면 모집을 종료하고 대회를 취소한다. 저장된 마감시각·토큰으로 재시작과 중복 타이머를 처리한다.
- 시작 유예 마감시각과 토큰을 `member.json`에 저장하며, 봇 재시작 뒤 첫 수신 메시지에서 남은 유예 타이머를 복구하거나 마감된 준비를 완료한다.
- 정상 공격 결과 제목에는 깃발 발견·점령·전투 승리 여부에 따라 `[성공✅]` 또는 `[실패❌]`를 표시하며, 미공격 탈락은 기존 `[시간 초과⚠️]`를 유지한다.
- 시간초과 탈락은 벼락 판정을 실행하지 않지만 누적 벼락 발생확률을 `0.5%p` 올린다. 탈락자의 포인트를 최대 1억 차감해 0 미만으로 내리지 않고, `/무쌍온` 설정을 OFF 처리한다. 결과 UI는 `시간초과 패널티💸: -🅟1억`과 실제 남은 포인트를 다음 줄에 분리해 표시한다.
- 정상 공격에서 벼락이 발생하지 않으면 다음 벼락 판정 확률이 `2%p`씩 누적되며, 벼락 발생 후에는 기본 `1%`로 초기화한다.
- 개인 기본 공격 횟수는 4회이며 공격 1회당 기본 획득 포인트는 1억 5천만이다. 최종 우승 상금은 15억이다.
- 티켓 이벤트 활성 중 공격권이 정상 차감된 공격에는 10%·20%·30% 쿠폰 중 1장을 기존 가중치 70:15:7로 추첨해 지급하고 공격 보상 바로 아래에 표시한다. 40%·50% 쿠폰은 신규 드랍에서 제외하지만 기존 보유분의 구매 할인 적용과 `/티켓전체회수` 대상은 유지한다.
- 진짜 깃발 발견 전 처음 찾은 가짜 깃발은 공격권만 1회 차감하고 생존하며, 결과 제목 바로 아래에 차감 후 남은 공격 횟수를 `[현재/최대⚔]` 형식으로 표시한다. 이미 공개된 가짜를 다시 공격하거나 진짜 깃발 발견 후 가짜를 공격하면 즉시 탈락한다.
- 벼락이 실제 발생하면 벼락 결과만 별도 `castleMsg`로 전송하고 공격 결과·공격 상세에는 합치지 않는다. 미발생 문구는 기존처럼 공격 결과에 포함한다.
- 진짜 깃발 최초 발견 시 기본 공격 보상과 별도로 2억을 한 번 지급하며 `realFlagDiscoveryBonusPaid`와 발견 기록으로 중복 지급을 막는다.
- 벼락 대상자가 `피뢰침⚡(자동 벼락 방지)`을 보유하면 80% 확률로 1개를 소모하고 생존한다. 벼락 결과 UI는 `피뢰침⚡(80%) 발동` 또는 `피뢰침⚡(80%) 미발동`으로 판정 결과를 구분한다. 실패 시 미소모로 탈락하며, 현재 진짜 깃발 점령자는 피뢰침을 적용·소모하지 않고 탈락한다.
- 턴 마감시각과 토큰을 저장하고, 봇 재시작 뒤 첫 수신 메시지에서 만료 턴 처리 또는 남은 타이머를 복구한다.
- 회차별 `roundId`와 `processedRounds`로 우승 상금과 누적 무쌍 횟수의 중복 처리를 막는다.
- 보상 대상 공격 1회당 기본 1억 5천만, 최종 점령자 우승 상금 15억을 지급한다. 우승 확정 메시지는 `NoticeMsg`로 방송하지 않고 공격·시간 초과·재시작 복구로 종료된 펫무쌍 방에 `castleMsg`로 출력한다. `/펫무쌍종료`는 명령 실행 방에 전체 종료 결과를 회신한다.
- `무쌍신화📙[B]`와 `무쌍귀신📙[A]` 장착 여부는 대회 시작 시 각각 스냅샷으로 확정하며, 스킬마다 개인 공격권이 1회 증가한다. 두 스킬을 함께 장착하면 공격권은 4회에서 6회로 증가하고, `무쌍귀신📙[A]` 장착 참가자는 보상 대상 공격마다 1억을 추가로 받아 총 2억 5천만을 획득한다. 상태 UI는 개인별 장착 스킬과 `maxAttacks`를 표시한다.
- 상태 UI는 공개된 가짜 깃발을 `가짜(✖️)`로 표시하고, 하단에도 현재 공격자를 다시 표시한다. 바로 아래 생존 참가자 명단 제목부터 `allsee`로 접어 표시하며 공격·벼락·시간초과 탈락자는 다음 상태 출력에서 즉시 제외한다. 이미 탈락한 참가자의 공격 시도는 탈락 상태만 별도 안내하며, 생존 상태에서 공격권만 모두 사용한 참가자는 `남은 펫무쌍 공격권이 없습니다`로 구분한다.
- 전투는 영지절대방어권→영지기습공격권→종합매력 순서이며, 아이템은 기존 영지전과 동일하게 발동 성공 시 1개 소모한다.
- 현재 데이터 키가 닉네임 문자열이므로 대회 진행 중 닉네임 변경 및 변경 후 기록 연결은 지원하지 않는다.
- `/펫무쌍전체초기화`는 참가·진행·회차·현재 칭호·당일 참가 표시·누적 전적을 초기화하고, 이미 지급된 포인트와 아이템은 회수하지 않는다.

## Command Guards
- 인자 없는 명령은 exact equality로만 실행한다.
- `/펫무쌍전체초기화`는 운영자만 exact equality로 실행한다.
- 티켓 이벤트 관리 명령 3종은 펫무쌍 운영자만 exact equality로 실행한다.
- 공격은 `/^\/펫무쌍공격\s+(?:10|[1-9])$/` 전체 패턴만 허용한다.
- `/벼락확률`은 `호이 남`만 사용할 수 있다. 값은 `0`~`100`과 선택적인 소수점 첫째 자리만 허용하며, 접미문이 붙은 입력은 실행하지 않는다.
- 슬래시가 없는 `펫무쌍준비`, `펫무쌍시작`, `펫무쌍공격 [번호]` 입력은 실행하지 않는다.
- 공격은 공성전 방 또는 DEV 컨텍스트에서만 처리한다.
- 대회 진행 중 일반 유저는 `main.js`에서 `/펫무쌍공격 [1-10]`, `/무쌍순위`(모집 중 `/펫무쌍준비` 추가 허용) 외의 슬래시 명령과 무슬래시 입력이 차단되며, 운영자는 관리 명령을 계속 사용할 수 있다. `Info.js`의 정보 명령도 일반 유저에게 차단하며, 제한 안내는 `main.js`에서 한 번 출력한다. 단, 펫무쌍·맞짱필드·길드 영지전은 어느 시작 경로에서도 동시에 활성화되지 않도록 상호 차단한다.

## Related Commands
- `/영지공격 [숫자]`
- `/길드영지시작`
- `/맞짱시작`
- `/영지패스추가, [아이디] [YY.MM.DD|영구권]`
- `/영지패스삭제, [아이디]`

---

# /패스목록

Status: VERIFIED

## Files
- `main.js`

## Related Helpers
- `buildSupportPassListMessage`
- `buildDailyRewardPayoutStatusLines`
- `isDailyRewardPayoutDone`
- `recordDailyRewardPayout`
- `cleanupExpiredSupportPasses`
- `getInvalidAutoExploreTicketUsers`
- `getHoiFreeSupportPackageCount`
- `getHoiFreeSupportPackageAlertUsers`
- `getAutoExploreTicketCount`
- `removeAllAutoExploreTickets`
- `normalizeAutoExploreTicketItemName`
- `getSupportPassConfigs`
- `isSupportPassActive`
- `getActiveSupportPassUsers`

## Data Usage
- `data.member[user].pass`
- `data.member[user].pass.territory`
- `data.territoryPassAuditLogs`
- `data.member[user].guildTerritoryAutoAttackEnabled`
- `data.member[user].bag["자동탐험권🌄"]`
- `data.member[user].bag["호이응원패키지(무료)🐹[1]" ... "호이응원패키지(무료)🐹[10]"]`
- `data.rewardPayoutStatus`
- `data.tierReward.lastPaidDate`
- `guildData.guildTerritoryReward.lastPaidAt`

## Save Flow
- `/패스목록` disables finite passes only after their KST end date has passed and saves `member.json` when expiry cleanup changes data
- `/패스목록` removes `자동탐험권🌄` only when a newbie/hoi pass expires during that cleanup and no newbie/hoi/premium automatic-explore pass remains active
- `/패스목록` consistency scanning is read-only: users holding `자동탐험권🌄` without an active newbie/hoi/premium pass are listed for manual review and are not mutated by the scan; hidden emoji variation selectors and trailing spaces in the item key are normalized for counting
- `/패스목록` sums `호이응원패키지(무료)🐹[1]` through `[10]` for each user and lists users holding at least 3 in total; this scan is read-only and does not mutate bag data
- Pass add/delete commands save `member.json` through their command branch after `processUserIDCommand`
- 영지기습패스 추가·연장·삭제는 운영자·대상·처리시각·만료일·변경 전후 값을 `territoryPassAuditLogs`에 남긴다. 유효한 영지기습패스는 자동 준비·자동 공격의 구독형 권한으로 판정하며 물리 자동화권을 반복 지급하지 않는다.
- 영지기습패스가 만료·삭제되면 `guildTerritoryAutoAttackEnabled`를 OFF로 저장하며, 패스를 다시 추가해도 자동으로 ON 복구하지 않는다.
- `/초보패스추가` and `/호이패스추가` grant one `자동탐험권🌄`
- `/초보패스삭제` and `/호이패스삭제` remove all `자동탐험권🌄` only when no other newbie/hoi/premium automatic-explore pass is active
- Past end dates are rejected before pass mutation and automatic ticket grant
- Invalid calendar dates are rejected for new pass input and excluded from automatic expiry cleanup with an operator log
- Finite passes remain active through the displayed end date and are removed from the active list on D+1
- Successful pass add/delete commands reload `member.json` and append a save-confirmation line to the reply; newbie/hoi deletion also confirms whether the automatic-explore ticket was recovered or retained
- `/패스목록`은 종합·미니펫·길드·티어·길드영지 순위 보상 명령의 예정 시각과 당일 지급 여부를 `[✅]`/`[❌]`로 표시한다. 종합·미니펫·길드 보상은 성공 직후 `data.rewardPayoutStatus`에 기록하며, 티어·길드영지는 기존 지급 기록을 재사용한다.
- `/보상지급`은 기존 응답 종료 저장, `/연금지급`과 `/길드보상지급`은 각 성공 분기의 `saveJsonFile(data, filePath)`로 당일 지급 기록을 `member.json`에 함께 저장한다.

## Related Commands
- `/원데이패스추가, [아이디] [날짜|영구권]`
- `/초보패스추가, [아이디] [날짜|영구권]`
- `/호이패스추가, [아이디] [날짜|영구권]`
- `/호패프리미엄추가, [아이디] [YY.MM.DD]`
- `/호패프리미엄삭제, [아이디]`
- `/호프단체추가 [아이디],[아이디]/[YY.MM.DD]`
- `/호프구독`
- `/공헌패스추가, [아이디] [날짜|영구권]`
- `/다이아패스추가, [아이디] [날짜|영구권]`
- `/영지패스추가, [아이디] [YY.MM.DD|영구권]`
- `/영지패스삭제, [아이디]`
- `/패키지가방`
- `/보상지급`
- `/연금지급`
- `/길드보상지급`
- `/티어보상지급`
- `/영지순위보상지급`
- Standalone legacy pass-list commands were removed; use `/패스목록`.

---

# /호패프리미엄추가|/호패프리미엄삭제|/호프단체추가|/호프구독|/무쌍온|/무쌍오프|/출첵온|/출첵오프|/자동출첵

Status: VERIFIED

## Files
- `main.js`
- `Info.js`

## Related Helpers
- `isHoiPassPremiumActive`
- `getHoiPassPremiumHeader`
- `processHoiPassPremiumCommand`
- `addHoiPassPremium`
- `hasActiveAutoExplorePass`
- `grantHoiPassPremiumDailyRewards`
- `expireHoiPassPremium`
- `cleanupExpiredHoiPassPremium`
- `returnHoiPassPremiumExtraSkills`
- `getPetSkillSlotCount`
- `getPetHomeHeartUsageStatus`
- `calcExploreSuccessPercent`
- `claimQuestReward`
- `processHoiPassPremiumAutomationCommand`
- `autoRegisterHoiPassPremiumPetMusouUsers`
- `runHoiPassPremiumAutoAttendance`
- `processAttendanceForUser`

## Data Usage
- `data.member[user].pass.premium`
- `data.member[user].premiumDailyQuestCnt`
- `data.member[user].bag`
- `data.member[user].premiumAutomation`
- `data.petMusouAutomationLogs`
- `petSkillData[user].petSkills.equipped`
- `petSkillData[user].petSkills.bag`
- `petHomeActivityData.petHomeSocial[user].badges`
- `petHomeActivityData.petHomeSocial[user].equippedBadgeId`

## Save Flow
- 개인·단체 추가 명령은 `member.json`, `petHomeActivityData.json`을 명령 분기에서 한 번씩 저장하며, 삭제 명령은 `petSkillData.json`도 함께 저장한다.
- `/호패프리미엄추가, 아이디 YY.MM.DD`는 기본 호이패스가 없는 유저에게 `자동탐험권🌄` 1개를 지급한다. 기존 공백 형식도 호환한다.
- `/호프단체추가 아이디,아이디/YY.MM.DD`는 날짜와 전체 유저를 먼저 검증한 뒤 한 번에 적용하고, 기본 호이패스가 없는 대상에게 자동탐험권을 지급한다.
- `/호프구독`은 사용 중단 안내만 출력하며, 프리미엄을 포함한 전체 패스 일일 보상은 `/구독패스지급` 또는 `/자동출첵`에서 처리한다.
- `/무쌍온`은 설정을 저장하고 현재 준비 회차 참가를 즉시 시도하며, 이후 수동·정시 시작 전 프리미엄 활성 유저를 자동 등록한다. 자동 등록은 유저별 오류를 격리·기록해 한 유저의 실패가 다음 유저를 중단하지 않으며, `/무쌍오프` 뒤에도 이미 등록된 현재 회차 참가는 유지한다. 이미 ON이면 중복 처리 없이 `이미 무쌍온 상태입니다.`를 안내한다.
- `/출첵온` 설정은 프리미엄 만료 후에도 유지하지만 `/리셋`의 자동출첵 대상에서는 제외한다. `/리셋`은 출첵 초기화를 마친 뒤 프리미엄 자동출첵을 실행하고, 성공자 전원의 체크랭크·포인트·기본·티어·가호 경험치 보상을 기존 제목과 `allsee`가 포함된 하나의 NoticeMsg로 출력한다. DEV 실행에서는 같은 합산 내용을 명령 실행방에 회신한다. 대상자를 독립 처리해 한 유저의 실패가 다음 유저를 중단하지 않는다. `/자동출첵`은 MASTER·오픈채팅봇만 실행하며 구독 패스 보상만 지급하고 출석 기록과 자동출첵 공지를 변경하지 않는다. 이미 ON이면 `이미 출첵온 상태입니다.`를 안내한다.
- 수동 `ㅊㅊ`와 자동출첵은 같은 출석 판정·기본 보상·주사위·랭크·오픈런 보상 처리를 사용하며 명령 분기에서 `member.json`을 한 번 저장한다. 출석 기본 EXP에 현재 티어의 고정 EXP를 더한 뒤 호월신의 가호를 보유량 범위에서 적용하고 실제 추가 경험치·사용량·소진 안내를 출력한다.
- 등록 회원의 수동 출석 결과는 실제 지급된 포인트·경험치·가호·오픈런 내역을 한 메시지로 합치며 `allsee` 상세 내역은 출력하지 않는다. 프리미엄 헤더는 유효한 프리미엄 회원에게만 표시하고, 심의 문구는 고정 링크 앞에 둔다. MASTER의 `/출석알림 내용` 또는 `/출첵알림 내용`은 같은 공통 알림을 `member.json`에 덮어써 이후 출석 결과에 표시한다.
- 등록 회원의 출석 여부는 마지막 `/리셋` 이후의 `member.today`로 확인한다. 자정이 지나도 출석 목록·순서·완료 상태를 유지하고, `/리셋`은 목록 누락 회원을 포함한 모든 회원의 출석 상태와 기존 일일 횟수를 함께 초기화한다. 같은 날짜의 새 리셋 회차에도 출석할 수 있으며 `member.recent`는 실제 출석 날짜 기록으로 유지한다. 경량 출석에서 회원으로 전환할 때 기존 회원 출석 목록을 날짜 기준으로 지우지 않는다. 미출석 게임 명령은 실행 전 안내하며, 관리자도 게임 명령은 출석해야 이용할 수 있다. `오픈채팅봇`과 권한이 확인된 관리 명령은 예외다. 일반 채팅의 경험치·가호 지급은 출석 전까지 건너뛴다. `Info.js`의 별도 정보 명령도 같은 리셋 기준을 사용한다.
- 미출석 회원의 `/소식`은 공지 열람만 허용하고 소식복권 추첨·포인트 지급·참여 표시는 출석 후로 미룬다.
- 프리미엄 혜택은 펫탐험 +7%p, 하루 마음 +15회, 이체수수료 5%p 감면, 펫스킬 슬롯 +7칸, 가구·미니펫 가방 각 +5칸, 가구 장착 +3칸, 장착 홈뱃지 큐브 옵션별 +3%p, `/알림` 하루 3회 무료다. 만료 정리는 프리미엄을 비활성화하고 홈뱃지를 회수하며, 초과 장착 스킬은 효과 없는 잠금 상태로 보존하고 장착 가구 중 매력이 가장 낮은 초과 가구는 가구가방으로 회수한다. 재가입 시 빈 슬롯만큼 잠금 스킬을 다시 활성화하며, 프리미엄 종료 후에도 `/냠냠`으로 친밀도 레벨이 올라 기본 슬롯이 늘어나면 확보된 빈 슬롯 수만큼 순서대로 잠금을 해제한다. 이미 공간이 늘어난 기존 잠금 데이터는 해당 유저의 다음 정상 명령 처리 시 같은 기준으로 복구한다.
- 프리미엄 종료 후 기본 호이·초보패스가 없을 때만 자동탐험권을 회수하며, 프리미엄이 활성 상태인 동안 기본 패스 만료·삭제로 자동탐험권을 회수하지 않는다.
- DEV 명령에서는 기존 `resolveActiveDataPath` 흐름을 그대로 사용한다.

## Related Commands
- `/패스목록`
- `/패키지가방`
- `/퀘스트`, `/ㅋ`
- `/일퀘완료`, `/ㅇ`, `/ㅇㅇㅇ`, `ㅎㅎㅎ`
- `/포인트`, `/내정보`, `/정리`
- `/홈알림`, `/팔로워`, `/팔로잉`, `/내마음`
- `/펫정보`, `/펫스킬가방`, `/펫스킬장착`
- `/이체`
- `/펫무쌍준비`, `/펫무쌍시작`
- `ㅊㅊ`, `/자동출첵`

---

# /아아|/아아 [숫자]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/아아`
- Search in `main.js`: `GLOBAL_CONFIG.coffeePackage`

## Files

- `main.js`
- `member.json`
- `member_title.json`

## Related Helpers

- `getCoffeePackageSpecialIndex`
- `isExclusiveDataMutationCommandMessage`
- `ensureTitleUserData`
- `addTitle`
- `addItemToBag`
- `checkRank`

## Data Usage

- `GLOBAL_CONFIG.coffeePackage`
- `data.member[sender].bag`
- `titleData.member[sender].title.list`

## Save Flow

- `/아아` 또는 `/아아 [숫자]` consumes `아니 아이스아메리카노 주세요 ㅡㅡ(/아아 숫자)`, grants 200 coffee items per use, and separately draws one mutually exclusive special situation from a cumulative 15% table
- Special situations grant `미니펫뽑기🐹(/미니펫오픈)` and add the matching member title only when it is not already owned
- The command loads member data in the response flow and member-title data once, then saves `filePath` and saves `memberTitlePath` only when a new title is added
- `/아아`와 `/아아 [숫자]` are handled as exclusive multi-file mutation commands, including when entered through the DEV command context

## Related Commands

- `/아아`
- `/아아 [숫자]`
- `/판매 [아이템번호] [수량]`
- `/타이틀목록`
- `/미니펫오픈`

## AI Notes

- Exact/full-pattern guards allow only `/아아` or `/아아 [숫자]`; suffix guide text does not execute
- `/아아` uses one item, while `/아아 [숫자]` has no hard count cap and is limited only by the user's package inventory
- Bulk results group identical base/special outcomes, so at most six result-image messages plus one summary are sent
- Coffee items use the existing general `/판매` value of 100,000 points per item

---

# /펀치|/펀치순위|/펀치순위초기화

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/펀치|/펀치순위|/펀치순위초기화`

## Files

- `main.js`
- `punchRankData.json`
- `member_title.json`
- `member.json`

## Related Helpers

- `ensurePunchRankData`
- `updatePunchRankData`
- `ensureTitleUserData`
- `hasUserTitle`
- `givePunchLegendTitle`
- `getPunchResult`
- `addItemToBag`
- `checkRank`

## Data Usage

- `GLOBAL_CONFIG.punchMachine`
- `data.member[sender].bag[GLOBAL_CONFIG.punchMachine.itemName]`
- `data.member[sender].point`
- `punchRankData.member[sender]`
- `titleData.member[sender].title.list`

## Save Flow

- `/펀치` consumes `핵꿀밤🥊(/펀치)`, subtracts points, grants `미니펫뽑기🐹(/미니펫오픈)`, updates title data on first legend hit, and saves `filePath`, `memberTitlePath`, and `punchRankPath`
- `/펀치순위` reads `punchRankPath` and does not mutate data
- `/펀치순위초기화` is admin-only, resets `punchRankPath`, and does not mutate member or title data

## Related Commands

- `/펀치`
- `/펀치 [횟수]`
- `/펀치순위`
- `/펀치순위초기화`

## AI Notes

- `/펀치` uses exact/full-pattern guards, so suffix text after a valid count should not execute
- `GLOBAL_CONFIG.punchMachine.maxOpen` caps one batch, and available item count can reduce the actual open count
- Missing or invalid JSON files should follow the existing `loadJsonFile` error flow; helper functions do not perform file IO

---

# /펫스킬가방

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/펫스킬가방`

## Files

- `main.js`

## Related Helpers

- `formatSkillBagMessage`
- `getPetSkillData`

## Data Usage

- `petSkillData[user]`

## Save Flow

- Calls `saveJsonFile(petSkillData, petSkillDataPath)`

## Related Commands

- `/펫스킬`
- `/펫스킬정보`
- `/펫스킬장착`

## AI Notes

- Canonical full skill inventory display
- Best entry point for total skill count and bag listing format
- Top guide lines should point skill lookup to `/펫스킬정보 [스킬이름]`
- Each skill row displays the grade from `PET_SKILL_LIST` after the skill name.
- `getPetSkillData` retains only successful normalized-name matches to the first source definition on the function object. Unknown names and personal inventory are not cached; list reference/length changes invalidate the lookup. Source definitions are static and source reload creates a new lookup.
- `getPetSkillBagList` resolves definition positions once per positive-count bag name before the same native sort. Zero/one entry skips definition lookup as before. The existing `999` unknown position, alias ties, Korean comparison, bag numbering, initialization and save call remain unchanged. See `tools/test_pet_skill_lookup*.js` for parity/exception, Java-thread, reload and timing evidence.

---

# /펫스킬

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/펫스킬`

## Files

- `main.js`

## Related Helpers

- `formatPetSkillStatusMessage`
- `ensurePetSkillSystemData`, `initPetSkillUser`, `normalizePetSkillStoredNames`

## Data Usage

- equipped and bag skill state inside `petSkillData[user]`

## Save Flow

- Calls `saveJsonFile(petSkillData, petSkillDataPath)`
- 공통 진입의 `ensurePetSkillSystemData(data, petData, petSkillData, sender)`는 최신 시스템 버전일 때 등록된 발신자만 검사한다. 정상 구조는 JSON 변환 없이 검사하며 다른 회원의 누락 구조는 해당 회원 처리 시 보정한다. 시스템 버전이 다르거나 생략된 이전 데이터, 또는 발신자를 생략한 명시적 전체 호출은 기존 전원 초기화·이름/가방/컬렉션 정규화를 유지한다.
- 보정으로 변경된 경우 기존 공통 흐름에서 회원 → 펫 → 펫스킬 파일을 같은 저장 트랜잭션으로 저장한다. 정상 반복 입력은 이 보정을 위한 저장을 하지 않는다. 새 캐시·경로·저장 형식은 추가하지 않으며 DEV 컨텍스트와 실패 시 원본 복구를 유지한다.

## Related Commands

- `/펫스킬가방`
- `/펫스킬장착`
- `/펫스킬해제`

## AI Notes

- Summary view for equipped and available skills
- Use this when the user report is about equip slots rather than whole bag totals
- 기본 장착 슬롯은 친밀도 Lv.100당 1칸, 최대 30칸이며 `펫스킬 학개론📙` 장착 시 최대 33칸이다.
- 장착 중인 스킬과 장착 가능한 스킬은 이름 뒤에 `PET_SKILL_LIST` 기준 등급을 표시한다.
- 장착 가능 목록은 이미 장착된 스킬을 숨기되 `/펫스킬가방`의 원래 번호를 유지하므로 표시 번호를 `/펫스킬장착 [번호]`에 바로 사용할 수 있다.

---

# /펫스킬정보 [스킬명|닉네임]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/펫스킬정보`

## Files

- `main.js`

## Related Helpers

- `formatSkillBagMessage`
- `getPetSkillData`
- `buildPetSkillInfoMessage`
- `getTierPetSkillSearchName`
- `buildTierPetSkillInfoLine`
- `normalizePetSkillName`

## Data Usage

- `petSkillData`
- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫스킬가방`
- `/스킬정보 [닉네임]`

## AI Notes

- Dual-purpose lookup: skill effect lookup or admin user-bag lookup
- 창조림·엘리트 박사는 기존 획득 확률 0.3%·0.1%를 유지하며 `획득 확률`로 안내한다. 효과 설명에는 대표 100%·보조 50%와 양쪽 합산, 퍼센트 보너스 적용 전 수치를 표시한다.
- `무쌍신화📙[B]`는 고정 확률 0.5%이며, `무쌍귀신📙[A]`과 동시에 장착할 수 있다.
- `전설의 몽둥이📙[한정판]` 조회는 확률 줄 없이 한정판 등급과 레이드·캐슬 매력 50만 효과를 표시한다.
- 티어 전용 펫스킬은 선행 이모지를 입력하지 않아도 이름만으로 조회할 수 있다.
- 티어 전용 펫스킬 조회 결과에는 종합매력과 티어 스킬끼리는 중복 불가, 일반 종합매력 무기 펫스킬과는 중복 가능하다는 안내가 함께 표시된다.
- Check role gating when another user's skill bag is unexpectedly visible
- `장인의 숨결` applies to `/펫강화` failure only, preserving the required enhancement stone at 7%; elemental enhancement is retired.

---

# /종합순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/종합순위`
- Alias: `ㅈㅈㅈ`

## Files

- `Info.js`

## Related Helpers

- `initSweetHomeUser`
- `generateRanking`
- `buildWorldOverallRankingMessage`
- `buildCombinedServerRankingMessage`
- `buildServerRankingRows`
- `getMemberRank` (`/펫정보` 개인 순위), Main의 `isUserInTotalRankingTop` (미궁 9번 입장 조건)

## Data Usage

- `data.member`
- `petData`
- `homeData`
- `petSkillData`

## Save Flow

- Read-only in the confirmed branch
- `/펫정보`·`/ㅎ`·`ㅁㅁㅁ`는 같은 응답에서 계산한 본인 캐슬/레이드/강화 합계를 재사용한다. 표시의 기존 `parseInt`/NaN 처리와 순위용 원합계를 구분한다. `getMemberRank`의 마지막 선택 인자는 현재 응답의 유한한 본인 원합계이며 생략하면 기존처럼 계산한다. 본인을 제외한 회원은 기존 열거 순서로 모두 계산하고, 개인 순위는 항상 기존 Rhino 정렬을 유지한다.
- Main의 `isUserInTotalRankingTop`는 기존 순서대로 전체 점수를 계산한 다음 더 높은 점수 또는 동점 닉네임 오름차순으로 앞선 인원을 센다. 유한한 수치에서는 정렬을 생략하되 결과는 기존 상위 제한 판정과 같다. 비정상 점수는 기존 정렬로 돌아가며 파일 IO·영속 캐시·보상/입장권 변경을 추가하지 않는다. 수동/자동 탐험의 호출 위치·입장권 검사·보상·저장 코드는 그대로다.

## Related Commands

- `/펫정보`
- `/티어순위`

## AI Notes

- Top-level overall ranking view
- Ranking formula is conceptually tied to `/펫정보` total charm output
- ver_2.692 성능 개선은 계산 중복과 상위권 판정의 정렬 비용에만 한정한다. 월드/서버 전체 목록, 개인 순위의 엔진별 동점 순서, 기존 Main/Info의 서로 다른 동점 기준은 변경하지 않는다. `tools/test_ranking_calculation.js`, `tools/test_ranking_calculation_rhino.js`, `tools/ranking_calculation_validation.md`에서 기준 버전과 결과를 대조한다.
- ver_2.699: `getMemberRank`도 본인 이외 회원의 캐슬→레이드 한 쌍에 지역 `castleRaidCommon`을 전달한다. 본인 원합계 재사용·전체 열거 순서·기존 Rhino 정렬·반올림·예외는 유지한다. 모드별 스킬·별채 검증은 각각 실행한다.
- Pet upgrade contribution uses the rounded effective upgrade level after representative home badge option 3; `GLOBAL_CONFIG.pet.totalCharmPerUpgrade` is currently 1,000 total charm per effective level.
- `/종합순위`는 `/펫정보`와 같은 현재 캐슬·레이드·유효 펫강화 계산을 사용한다. 홈뱃지는 캐슬·레이드에 대표+보조 슬롯, 펫강화에 대표 슬롯만 반영하고 슬롯마다 프리미엄 +3%p를 적용하며, 길드공헌 큐브도 동일하게 합산한다.
- `/종합순위`와 `ㅈㅈㅈ`는 2026-10-08 사용자 롤백 요청의 기존 캡처에 맞춰 소속 서버 현황·서버 내 개인 TOP 10 통합 화면 → 월드 개인 순위 두 메시지로 출력한다. 전체 서버 목록만 있는 별도 메시지는 추가 출력하지 않는다. `/서버순위`의 현행 소속 서버 현황·개인 TOP 10·10개 서버 합산을 한 메시지로 표시하는 동작은 유지한다.
- 개인과 서버 합산은 같은 개인 종합매력 결과를 사용한다. `호이서버1-2[30]`은 서버1로, 구 서버6 `[2030]`은 `[30]`으로 집계한다.
- 통합 서버 메시지는 `🏠 우리 서버 개인 종합순위` 제목 다음에 `allsee`를 한 번 적용하고, 개인 TOP 10과 하단 서버 합산 목록을 함께 접는다. 월드 메시지는 3위 다음에 `allsee`를 적용한다. 조회별 응답·순서·정확한 두 별칭·접미 미실행·조회 데이터 무변경은 `tools/test_latest_server_display.js`의 실제 분기 실행으로 검증한다.

---

# /티어, /티어적용

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `msg === "/티어"`
- Search in `main.js`: `msg === "/티어적용"`

## Files

- `main.js`

## Related Helpers

- `buildTierProgressPlan`
- `buildTierProgressMessage`
- `applyRankBasedOnTicketsForUser`
- `buildPointShopPurchaseQuote`
- `addMemberExperienceWithTierBonus`

## Data Usage

- `data.member[sender].rank`
- `data.member[sender].bag`
- `data.member[sender].tierRewardClaims`
- `data.member[sender].tierExperienceRemainder`
- `petData[sender].petexp`

## Save Flow

- `/티어` is read-only.
- `/티어적용`은 복합 데이터 변경 쓰기 잠금 안에서 성공한 사용자 본인의 `data`와 `petData`를 저장한 뒤 승급 알림을 보낸다.
- 승급 실패·동일 티어 적용은 티어 보상을 변경하지 않는다. 단, 튜토리얼 2단계에서는 입력 시점에 티어 승급티켓🎟을 1개 이상 보유했다면 실제 승급 성공과 무관하게 `/티어적용` 입력을 진행 상태로 저장한다.

## Related Commands

- `/고급티켓조합`
- `/구매`
- `/티어순위`
- `/티어확인`

## AI Notes

- `/티어` shows the current tier, actual promotion target, shortages, ticket purchase estimate, benefits, and the next action; detailed rows follow `allsee`.
- `/티어`와 `/티어적용`의 티켓·재료·쿠폰 수량은 천 단위 쉼표로 표시한다. 인형 성공확률은 실제 뽑기와 같은 `getDollSuccessPercent`로 현재·목표 티어를 계산해 경험치 보너스 아래와 다음 혜택에 표시한다. 기본 5%를 다시 더하지 않는다.
- `buildTierProgressMessage`는 기본 화면의 금액·할인 안내와 기존 allsee 경계를 유지하면서 구분선·개행을 적용한다. 탐험 문구는 `적용`이며 상점 9,999개 분할 구매 안내만 제거한다. 실제 상점 한도·견적·쿠폰·조합·승급·보상은 변경하지 않는다. 승급 성공에도 현재·다음 인형 성공률을 표시하며 최고 티어에는 다음 목표를 표시하지 않는다.
- `/티어`의 포인트 상점 견적은 `탈세자📙`의 세금 70% 면제와 `티어 상승론📙`의 티켓 1% 추가 획득을 반영해 실제 최소 구매 수량과 결제액을 표시한다.
- `/티어적용` supports multi-tier promotion for the sender and does not downgrade other members.
- `checkRank`는 저장된 티어 이름을 현재 티어 표와 대조해 최신 이모지를 표시하며, 옛 `벚꽃` 표기는 `벛꽃` 티어로 호환한다.
- `/티어`, `/티어적용` 성공·실패, 전체 티어 승급 소식은 모두 저장 반영 후 `checkRank` 결과를 출력해 변경된 티어 이모지를 즉시 표시한다.
- `/티어` 제목은 `[checkRank]` 형식으로 표시하고, `/티어적용` 재료 부족 안내도 같은 사용자 표시명을 포함한다.
- 전체 1~51단계 티어는 경험치 지급 1건마다 1~238의 고정 EXP를 추가한다. 42~51단계는 기존 펫탐험 보너스와 1회성 매력 보상도 유지한다.

---

# /티어순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/티어순위`

## Files

- `Info.js`

## Related Helpers

- `getRankEmoji`

## Data Usage

- `data.member[*].bag["티어 승급티켓🎟"]`
- `data.member[*].bag["고급 티어 승급티켓🎫"]`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/티어확인`
- `/티어보상지급`

## AI Notes

- Ranking is based on bag ticket totals, not current displayed rank tier

---

# /티어보상지급

Status: VERIFIED

## Files

- main.js

## Related Helpers

- getTierRankingRows
- payTierRankingReward
- formatTierRewardLine
- addItem

## Data Usage

- data.member[*].bag["티어 승급티켓🎟"]
- data.member[*].bag["고급 티어 승급티켓🎫"]
- data.member[*].bag["펫스킬북 조각📙"]
- data.member[*].bag["다이아상자💎(/다이아상자오픈)"]
- data.tierReward.lastPaidDate

## Save Flow

- `/티어보상지급` mutates member bags and `data.tierReward`, then saves through `saveJsonFile(data, filePath)`.

## Related Commands

- `/티어순위`
- `/펫스킬북조합`
- `/다이아상자오픈`

## AI Notes

- Exact command guard: `/티어보상지급`.
- Admin/operator gated to `호이 남` or `오픈채팅봇`.
- Uses the same ticket score basis as `/티어순위`: regular ticket 1pt, advanced ticket 5pt.
- Prevents duplicate same-day payout through `data.tierReward.lastPaidDate`.

---

# /펫상태

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/펫상태`

## Files

- `Info.js`

## Related Helpers

- direct pet image selection logic in branch

## Data Usage

- `petData[sender].petimg`
- `petData[sender].newimg`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`

## AI Notes

- Minimal image/status output command
- Useful for debugging image field precedence between `newimg` and `petimg`

---

# /미니펫통계

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/미니펫통계`

## Files

- `Info.js`

## Related Helpers

- `getMiniPetGradeStats`
- `isElite`

## Data Usage

- `petData`
- `miniPetData.gradeTable`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/미니펫가방`

## AI Notes

- Aggregated ownership statistics by mini-pet grade
- Best anchor for grade-table mismatch issues
- Elite mini-pets are counted as `엘리트` before grade-table fallback and sorted immediately below `창조`

---

# /시련의탑순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/시련의탑순위`

## Files

- `Info.js`

## Related Helpers

- `trialTowerRanking`

## Data Usage

- `trialTower.user`
- `data.member`
- `petData`
- `guildData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/시련의탑`

## AI Notes

- Ranking companion to the main tower progression command
- Open `trialTowerRanking` first when sorting or display order is incorrect

---

# /길드공지 [내용]

Status: VERIFIED

## Files
- `main.js`

## Related Helpers
- `getMyGuildInfo`
- `canTransferGuildMaster`

## Data Usage
- `guildData.guilds[guildId].notice`
- `GLOBAL_CONFIG.guild.noticeMaxLength`

## Save Flow
- 길드마스터가 최대 100자의 공지를 설정하고 `guildData`를 저장한다.

## Related Commands
- `/길드정보`
- `/길드게시판`

## AI Notes
- `/길드공지` 단독 입력은 사용법을 표시하고, 공백 뒤 자유문자열만 공지 내용으로 처리한다.
- 100자를 초과하면 저장하지 않는다.

---

# /길드가입조건 [숫자]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드가입조건`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
## Data Usage
- current sender guild join-condition fields in `guildData.guilds`
## Save Flow
- Mutates guild join-condition state and saves `guildData`
## Related Commands
- `/길드정보`
- `/길드목록`

---

# /길드가입 [번호]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드가입`
## Files
- `main.js`
## Related Helpers
- `getJoinableGuildRows`
- `hasItem`
## Data Usage
- `guildData.guilds`
- `data.member[sender]`
- `userState[sender].guildJoin`
## Save Flow
- Starts staged join flow; persistence happens on confirmation branch
## Related Commands
- `/길드목록`
- `/가입한다`
- `/안한다`

## AI Notes
- 길드 정원 판정은 저장된 `g.maxMember`에 `징집명령📙` 길드마스터 보정 `+1`을 더한 기준을 사용한다

---

# /가입한다
Status: VERIFIED
## Command Anchors
- Search in main.js: `/가입한다`
## Files
- `main.js`
## Related Helpers
- `getMyGuildId`
- `hasItem`
## Data Usage
- `userState[sender].guildJoin`
- `guildData.guilds[guildId]`
- `data.member[sender].guild`
## Save Flow
- Finalizes join and saves both member data and `guildData`
## Related Commands
- `/길드가입`
- `/안한다`

---

# /안한다
Status: VERIFIED
## Command Anchors
- Search in main.js: `/안한다`
## Files
- `main.js`
## Related Helpers
- user-state cancellation only
## Data Usage
- `userState[sender].guildJoin`
## Save Flow
- No file save; clears staged join state only
## Related Commands
- `/길드가입`
- `/가입한다`

---

# /길드탈퇴
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드탈퇴`
## Files
- `main.js`
## Related Helpers
- `getMyGuildId`
- `hasItem`
## Data Usage
- `data.member[sender].guild`
- `guildData.guilds[myGid].members`
## Save Flow
- Mutates member and guild membership state and saves both stores
## Related Commands
- `/길드정보`
- `/길드상점`

---

# /길드인원마감
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드인원마감`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
## Data Usage
- `guildData.guilds[*].memberClose`
## Save Flow
- Mutates guild recruitment flag and saves `guildData`
## Related Commands
- `/길드인원마감해제`
- `/길드목록`

---

# /길드인원마감해제
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드인원마감해제`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
## Data Usage
- `guildData.guilds[*].memberClose`
## Save Flow
- Mutates guild recruitment flag and saves `guildData`
## Related Commands
- `/길드인원마감`
- `/길드목록`

---

# /길드마크변경 [이모지]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드마크변경`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
- `hasItem`
## Data Usage
- `guildData.guilds[*].mark`
- `data.member[sender].bag`
## Save Flow
- Consumes ticket, mutates guild mark, saves member data and `guildData`
## Related Commands
- `/길드정보`
- `/길드상점`

---

# /길드분배
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드분배`
## Files
- `main.js`
## Related Helpers
- `syncMemberGuild`
- `getMyGuildInfo`
- `ensureGuildWarehouseObj`
- `getGuildOrderedMemberKeys`
- `getGuildDistributionMembersByNumbers`
- `addDiamond`
## Data Usage
- guild warehouse/fund state
- member point/item state
- `guildData.guilds[*].warehouse.petSkillBook`
- `guildData.guilds[*].warehouse.pendant`
- `guildData.guilds[*].warehouse.diamond`
- `data.member[user].diamond`
- `currencyLogData.user[user].diamond`
## Save Flow
- Saves member data during sync and saves both member data and `guildData` after successful distribution.
- Saves `currencyLogData` when distributed resources include 다이아.
- 인자 없는 `/길드분배`는 전체 길드원을 대상으로 자원을 균등 분배한다.
- `/길드분배 [멤버번호] ...`는 `/길드정보`의 공헌도 순 멤버번호로 대상을 선택하며 지정 인원 수 제한은 없다.
- 길드 전체 인원 5명 이상 조건은 유지하고, 범위 밖 번호와 중복 번호는 지급 전에 차단한다.
- Guild warehouse normalization uses `warehouse.pendant` for `펜던트 강화석📿` and no longer creates a default `warehouse.ring` slot.
- `/길드분배` distributes `warehouse.petSkillBook` as `펫스킬북 조각📙`; `warehouse.elemental` is not used by the guild warehouse flow.
- `/길드분배` distributes `warehouse.pendant` as `펜던트 강화석📿`, then deducts only the evenly distributed share while leaving the remainder in the guild warehouse.
- Admin warehouse grants use `/길드펫스킬창고 [길드명] [숫자]` for `warehouse.petSkillBook`, `/길드펜던트창고 [길드명] [숫자]` for `warehouse.pendant`, and `/길드다이아창고 [길드명] [숫자]` for `warehouse.diamond`.
- Legacy `warehouse.ring` is removed by `/데이터정리`; it is not migrated to `warehouse.pendant`.
## Related Commands
- `/길드창고패키지오픈`
- `/길드정보`
- `/데이터정리`
- `/길드다이아창고`

---

# /길드다이아창고 [길드명] [숫자]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드다이아창고`
## Files
- `main.js`
## Related Helpers
- `parseGuildNameAndAmount`
- `addGuildResourceByAdmin`
- `findGuildIdByNameSafe`
- `ensureGuildWarehouseObj`
## Data Usage
- `guildData.guilds[*].warehouse.diamond`
## Save Flow
- Admin/Master-only command.
- Parses `[길드명] [숫자]`, adds the amount to `warehouse.diamond`, and saves `guildData` through `saveJsonFile(guildData, guildPath)`.
## Related Commands
- `/길드분배`
- `/길드정보`
- `/길드상세정보`

---

# /길드공헌, /길드공헌추가
Status: VERIFIED
## Files
- `main.js`
## Related Helpers
- `checkGuildLevelUp`
- `getMyGuildInfo`
- `ensureGuildWarehouseObj`
- `addItem`
- `saveJsonFile`
## Data Usage
- `guildData.guilds[*].exp`
- `guildData.guilds[*].level`
- `guildData.guilds[*].warehouse`
- `data.member[sender].bag`
- `data.member[sender].gContribCnt`
## Save Flow
- `/길드공헌` mutates member contribution counters, member bag rewards, guild EXP, and possible guild warehouse rewards, then saves member data and `guildData`.
- `/길드공헌추가` mutates target guild EXP and possible guild warehouse rewards, then saves member data and `guildData`.
- `checkGuildLevelUp` grants former guild 정령 warehouse rewards as `warehouse.petSkillBook` 펫스킬북 조각📙.
## Related Commands
- `/길드정보`
- `/길드창고`
- `/길드분배`

---

# 레벨업 보상
Status: VERIFIED
## Files
- `main.js`
## Related Helpers
- `addItem`
- `saveJsonFile`
## Data Usage
- `data.member[sender].lv`
- `data.member[sender].exp`
- `data.member[sender].point`
- `data.member[sender].bag`
- `petData[sender].petexp`
## Save Flow
- When a user levels up, the command flow mutates member EXP/point/bag and pet EXP, then saves member data and pet data in the surrounding attendance/action flow.
- `levelRewards` no longer grants `반지 강화석💍`; levels that only granted ring stones were removed from the reward table.
## Related Commands
- `ㅊㅊ`
- activity commands that add EXP before level-up processing

---

# /길드전체초기화
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드전체초기화`
## Files
- `main.js`
## Related Helpers
- `resetAllGuildData`
## Data Usage
- all guild/member guild linkage state
## Save Flow
- Resets broad guild state and saves both member data and `guildData`
## Related Commands
- `/길드정보`
- `/길드목록`

---

# /길드계급표
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드계급표`
## Files
- `main.js`
## Related Helpers
- `getGuildMasterRankTitle`
## Data Usage
- static guild rank-title mapping
## Save Flow
- Read-only
## Related Commands
- `/길드순위`

---

# /길드fund삭제
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드fund삭제`
## Files
- `main.js`
## Related Helpers
- admin/master-only cleanup path
## Data Usage
- guild fund/warehouse related fields in `guildData`
## Save Flow
- Mutates guild fund state and saves `guildData`
## Related Commands
- `/길드정보`
- `/길드분배`

---

# /길드창고패키지오픈 [개수]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드창고패키지오픈`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
- `ensureGuildWarehouseObj`
- `hasItem`
## Data Usage
- `guildData.guilds[*].warehouse`
- `data.member[sender].bag`
## Save Flow
- Consumes package item, mutates guild warehouse, saves member data and `guildData`
- Each package adds guild warehouse rewards: fund 50,000,000, petSkillBook 12, pendant 1, pet 15, miniPet 5.
## Related Commands
- `/길드분배`
- `/길드정보`

---

# /길드부스터공헌 [개수]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/길드부스터공헌`
## Files
- `main.js`
## Related Helpers
- `contributeGuildTerritoryBooster`
- `ensureGuildTerritoryBoosterCount`
- `getMyGuildInfo`
- `removeItem`
## Data Usage
- `data.member[sender].bag["길드영지 부스터🔮(/길드부스터공헌 숫자)"]`
- `guildData.guilds[*].guildTerritoryBooster`
- `guildData.guilds[*].members[sender].boosterContribution`
- `data.member[sender].gBoosterContribCnt`
## Save Flow
- Consumes the booster item from the member bag, adds the count to the user's guild, records the member's cumulative booster contribution and daily contribution flag, then saves member data and `guildData`.
- `/정리` also auto-contributes all held boosters only when the user belongs to a guild; guildless users keep the item.
## Related Commands
- `/길드정보`
- `/길드영지종료`
- `/영지보상안내`

---

# /당근 [받을유저닉] [가방번호] [수량]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/당근`
## Files
- `main.js`
## Related Helpers
- `generateBagOutput`
- `isTradableItem`
- `isMemberTierKing`
- `getCarrotTradeRequest`, `getCarrotTradeRows`, `validateCarrotTrade`, `findCarrotTradeConfirmedRow`
- `applyConfirmedCarrotTrade`, `buildCarrotTradeMessage`, `buildCarrotTradeNotice`, `startCarrotTradeExpiry`
## Data Usage
- `data.member[sender].bag`
- `data.member[receiver].bag`
## Save Flow
- 최초 요청은 검증과 확인창만 출력하며 거래 파일을 저장하지 않는다. 같은 계정·단체방 여부·방의 정확한 확인 응답만 처리한다.
- `거래한다`는 원래 명령으로 출석·계정정지·대전·장소 공통 검사를 거친 뒤 최신 대상으로 재검증한다. 기존 약관 범위와 펜던트의 부수 보상 차이도 유지한다.
- `carrotTradePending`은 DEV/PROD 계정별 1건이며 60초 자동 만료한다. `안한다`·만료·재검증/저장 실패는 대기를 끝내고 전송하지 않는다. 새 요청은 기존 대상·시간을 덮어쓰지 않는다.
- 실제 아이템 내용과 ID(있는 경우), 최초 순서/번호를 보존한다. 번호가 바뀌어도 대상을 식별하면 진행하며 식별 불가 시 취소한다.
- 확정 시 회원 저장 후 해당 pet/skill/home 파일을 기존 명령 트랜잭션으로 저장한다. 가구 원문은 변경 전 진입부에서 읽어 롤백 인수로 전달한다.
- 완료 응답은 모든 저장 뒤 전송하며 응답 실패가 완료된 이전을 되돌리지 않는다. 메모리 대기는 재컴파일 후 재실행되지 않으며, 새 영속 저널은 추가하지 않는다.
- 일반 아이템·미니펫·펫스킬·가구 거래 완료 안내는 관련 파일 저장이 모두 성공한 뒤 출력한다.
- 가구 거래는 진입부에서 읽은 원문 스냅샷을 사용하고 `saveJsonFile(homeData, homeDataFile, false, snapshot)`으로 검증 저장 및 명령 트랜잭션 롤백에 포함한다.
## Related Commands
- `/당근게시판`
- `/당근완료`
- `/미니펫당근`
- `/가구당근`
- `/펫스킬당근`
- `/펜던트당근`

## AI Notes
- Direct carrot trades require both sender and receiver to be currently tier `킹` or higher before inventory mutation.
- `/당근`, `/미니펫당근`, `/가구당근`, `/펫스킬당근`은 `isCarrotTradeCommand` 공통 판정과 `isCarrotTradeRoomAllowed` 실제 단체방 검사로 커뮤니티에서만 허용한다.
- `GLOBAL_CONFIG.carrotTrade.communityRoom`은 기존 `room5`의 `호이월드 커뮤니티[티어 킹 이상 입장가능]`이다. 회원의 소속 서버와 DEV 여부는 거래 장소 예외가 아니다.
- response의 패스·출석 검사 및 게임 데이터 변경 전에 차단한다. 패스 미보유 일대일톡에도 `buildCarrotTradeBlockedMessage`의 체크랭크·입장 링크·미소모 안내를 한 번 출력하고 종료한다.
- 차단 시 `member.json`, `member_pet.json`, 가구·펫스킬 데이터, 당근온도기 및 거래 횟수는 변경·저장하지 않는다. 안내용 member·pet·guild 로드는 command entry에서 수행한다.
- 개당 당근 기준은 일반 1개, 미니펫·가구 100개, 펫스킬·펜던트 300개이다. 일반/스킬은 기존 수량을 곱하고 미니펫·가구·펜던트는 기존 단건 전송이다.
- 실행 분기는 닉네임과 마지막 정수 인수를 전체 패턴으로 확인한다. 접미 안내 문구·음수·소수는 거래를 실행하지 않는다. 가구 번호 상한을 검사한다.
- `/당근게시판`, `/당근등록`, `/당근완료`, `/당근게시판삭제`, `/펜던트당근`, 자유시장은 이번 커뮤니티 전용 제한 대상이 아니다.

---


## Confirmation UI and Validation
- `buildCarrotTradeMessage`는 자유시장 miniPet/furniture 상세·펜던트 형식을 재사용하며 체크랭크 닉네임, 쉼표, 총 당근·잔여량을 표시한다.
- `haveCarrotTradeNumbersChanged`는 확인 이후·전송 이후 번호 변경이 실제로 확인된 경우에만 다음 가방 확인 안내를 추가한다.
- 만료 콜백은 응답과 같은 잠금 순서를 사용하고 거래 고유 ID가 일치하는 대기만 취소한다. 이전 거래 타이머는 새 거래/완료 거래를 건드리지 않는다.
- tools/test_carrot_confirmation.js: 실제 진입·검증·이전·저장·타이머·UI 16그룹. tools/test_carrot_confirmation_rhino.js: 전체 컴파일·실제 명령과 Java 잠금 20쌍(합성 파일 저장).

# /당근완료
Status: VERIFIED
## Command Anchors
- Search in main.js: `/당근완료`
## Files
- `main.js`
## Related Helpers
- carrot-board user filter in branch
## Data Usage
- `carrotBoard.memo`
## Save Flow
- Removes sender post and saves `carrotBoardPath`
## Related Commands
- `/당근게시판`
- `/당근`

---

# /당근게시판삭제
Status: VERIFIED
## Command Anchors
- Search in main.js: `/당근게시판삭제`
## Files
- `main.js`
## Related Helpers
- admin-only board reset
## Data Usage
- `carrotBoard.memo`
## Save Flow
- Resets board and saves `carrotBoardPath`
## Related Commands
- `/당근게시판`

---

# /편지 [내용]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/편지`
## Files
- `main.js`
## Related Helpers
- `hasLetterInBag`
- `useLetterInBag`
- `hasPetSkill`
## Data Usage
- `board.memo`
- sender bag stamp item state
## Save Flow
- Mutates board entries and sender bag state; saves board and member data in branch
## Related Commands
- `/편지삭제`

---

# /편지삭제
Status: VERIFIED
## Command Anchors
- Search in main.js: `/편지삭제`
## Files
- `main.js`
## Related Helpers
- master-only board reset
## Data Usage
- `board.memo`
## Save Flow
- Clears board and saves `boardPath`
## Related Commands
- `/편지`

---


# /가방속성 [유저명] [아이템번호] [갯수]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/가방속성`
## Files
- `main.js`
## Related Helpers
- `generateBagOutput`
- `checkRank`
## Data Usage
- `data.member[targetUser].bag`
## Save Flow
- Mutates target bag item counts; surrounding persistence should be checked in local save cycle
## Related Commands
- `/가방`
- `/가방추가`

---

# /가방추가 [유저명], [아이템명] [갯수]
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/가방추가`
## Files
- `main.js`
## Related Helpers
- `checkRank`
## Data Usage
- `data.member[targetUser].bag[itemName]`
## Save Flow
- Mutates target bag state; surrounding persistence should be checked in local save cycle
## Related Commands
- `/가방속성`

---

# /펫스킬가방추가 [유저], [펫스킬가방번호|스킬명] [개수]
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/펫스킬가방추가`
## Files
- `main.js`
## Related Helpers
- `normalizePetSkillName`
- `getPetSkillData`
- `getPetSkillBagList`
- `parseDirectGrantPetSkillRequest`
- `parsePetSkillBagGrantRequest`
- `getPetSkillBagRemainCount`
- `addPetSkillToBag`
## Data Usage
- `petSkillData[user].bag`
## Save Flow
- 숫자를 입력하면 대상 유저의 `/펫스킬가방` 번호에 해당하는 스킬을 찾는다.
- Mutates target skill bag and saves `petSkillData`
## Related Commands
- `/펫스킬가방`
- `/펫스킬일괄지급`

## AI Notes
- `전설의 몽둥이📙[한정판]` 지급 명령은 `호이 남`만 실행할 수 있다. `/펫스킬가방추가 [이름], 전설의 몽둥이` 입력 시 대상에게 1개, 뒤에 숫자를 입력하면 해당 수량만큼 지급하며 숫자 뒤 추가 문구는 차단한다.
- 일반 번호 지급은 `/펫스킬가방추가 [유저], [펫스킬가방번호] [개수]` 형식이며, 명령어 바로 뒤에 쉼표를 붙인 기존 형식은 실행하지 않는다.

---

# /펫스킬일괄지급
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬일괄지급`
## Files
- `main.js`
## Related Helpers
- `normalizePetSkillName`
- `getPetSkillData`
- `addPetSkillToBag`
## Data Usage
- multi-user `petSkillData[*].bag`
## Save Flow
- Bulk mutates skill bags and saves `petSkillData`
## Related Commands
- `/펫스킬가방추가`

## AI Notes
- 단독 지급 전용인 `전설의 몽둥이📙[한정판]`는 일괄 지급 대상에서 제외한다.

---

# /펫스킬전체판매
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬전체판매`
## Files
- `main.js`
## Related Helpers
- `initPetSkillUser`
- `getPetSkillBagList`
- `getPetSkillBagTotalCount`
- `formatPetSkillName`
## Data Usage
- `petSkillData[sender].bag`
- `data.member[sender].point`
## Save Flow
- Empties skill bag, adds points, saves member data and `petSkillData`
## Related Commands
- `/펫스킬판매`
- `/펫스킬가방`

---

# /펫스킬판매 [번호] [개수]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬판매`
## Files
- `main.js`
## Related Helpers
- `initPetSkillUser`
- `getPetSkillBagList`
- `removePetSkillFromBag`
## Data Usage
- `petSkillData[sender].bag`
- `data.member[sender].point`
## Save Flow
- Removes selected skill count, adds points, saves member data and `petSkillData`
## Related Commands
- `/펫스킬전체판매`

---

# /펫스킬북분해 [펫스킬가방번호] [분해개수]
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/펫스킬북분해`
## Files
- `main.js`
## Related Helpers
- `decomposePetSkillFromBag`
- `getPetSkillBagList`
- `removePetSkillFromBag`
- `addItem`
## Data Usage
- `petSkillData[sender].bag`
- `data.member[sender].bag["펫스킬북 조각📙"]`
## Save Flow
- 선택한 펫스킬을 요청 수량만큼 차감하고 스킬 1개당 조각 3~4개를 지급한 뒤 member data와 `petSkillData`를 각각 한 번 저장한다.
## Related Commands
- `/펫스킬가방`
- `/펫스킬북조합`
## AI Notes
- `/펫스킬가방`에 표시되는 정렬 번호를 사용한다.
- 정확히 숫자 인자 2개를 입력한 경우에만 분해 로직을 실행한다.

---

# /펫스킬확률
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬확률`
## Files
- `main.js`
## Related Helpers
- `getPetSkillActualRate`
- `getPetSkillRandomWeight`
- `getOpenablePetSkillCountByGrade`
- `getPetSkillFixedActualRateTotal`
- `formatPetSkillName`
## Data Usage
- `PET_SKILL_LIST`
- `PET_SKILL_FIXED_ACTUAL_RATES`
## Save Flow
- Read-only
## Related Commands
- `/펫스킬오픈`
- `/펫스킬정보`

## AI Notes

- 티어 전용 펫스킬북 30종은 `/펫스킬확률`과 랜덤 오픈 풀에 포함된다.
- `/펫스킬확률`은 SS/S/A/B/C/D 등급 테두리 안에 일반 펫스킬과 티어 전용 펫스킬을 함께 표시한다.
- 일반 등급 총 확률 아래 `한정판 등급` 구역에서 `전설의 몽둥이📙`, `베란다 확장📙`, `베란다 대확장📙`, `전설의 소매치기📙`, `광산에서 재벌까지📙`, `호월토벌대📙`를 별도로 표시하며, 이 스킬들은 일반 오픈 풀과 총 확률에 포함되지 않는다.
- 신규 레이드정복자·돌격대·타격대를 포함한 오픈 가능한 96종 기준으로 SS는 각 0.1%, S는 각 0.3%, A는 각 0.4%, B는 각 0.6%, C는 각 1.5%다. SS~C 합계 58.6%를 제외한 41.4%는 D등급 6종에 균등 배분해 각각 6.9%로 추첨한다.

---

# /펫스킬중복
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬중복`
## Files
- `main.js`
## Related Helpers
- `formatPetSkillName`
## Data Usage
- `PET_SKILL_COMPAT_GROUPS`
## Save Flow
- Read-only
## Related Commands
- `/펫스킬장착`

---

# /호월토벌대오픈

Status: VERIFIED

## Files

- `main.js`
- `Info.js` (장착 후 매력 계산)

## Related Helpers

- `hasItem`, `removeItem`, `getPetSkillBagRemainCount`, `addPetSkillToBag`
- `isExclusiveDataMutationCommandMessage`, `saveJsonFile`, `rollbackDataSaveTransaction`
- `getEquippedNonTierPetSkillExp`, `calculateRaidExp`, `calculateTotalExp`

## Data Usage

- `GLOBAL_CONFIG.petSkill.raidSubjugation`
- `data.member[sender].bag["호월토벌대📙 확정(/호월토벌대오픈)"]`
- `petSkillData[sender].petSkills.bag["호월토벌대"]`

## Save Flow

- 펫·아이템·스킬가방 여유를 확인하고 확정 아이템 1개를 스킬 1개로 교환한다.
- 명령 진입에서 읽은 데이터로 처리하며 회원 → 펫스킬 순서로 검증 저장한 뒤 성공 안내한다. 저장 실패 시 기존 명령 트랜잭션이 함께 복구한다.
- 정확 일치 명령만 실행하며 전용 쓰기 잠금을 사용한다. DEV는 기존 명령 컨텍스트의 경로 분리를 따른다.

## Related Commands

- `/펫스킬가방`, `/펫스킬장착 [번호]`, `/펫스킬소멸 [번호]`, `/펫스킬정보 [스킬이름]`

## AI Notes

- 오픈은 가방 지급만 하며 장착하지 않는다. 호월토벌대는 일반 추첨에서 제외한다.
- 레이드정복자(SS) 700만·호월토벌대(한정판) 300만·레이드돌격대(A) 200만·레이드타격대(B) 100만은 Main/Info에서 장착 중에만 레이드매력을 가산한다. 캐슬 가산은 없으며 기존 백분율 보너스 계산에 포함된다.
- 서로 다른 4종은 기존 슬롯 한도 안에서 함께 장착할 수 있고, 동일 스킬은 1개만 허용한다. 소멸하면 해당 매력이 즉시 빠진다.
- 신규 4종의 `/펫스킬정보`는 확률을 숨기고, 장착 성공 시 스킬별 대사를 출력한다.
- 기존 컬렉션 정책에 따라 4종 모두 등록 대상이다. 등급별 표시 번호는 일부 이동하지만 이름으로 저장한 기존 등록 수량은 유지한다.

---

# /베란다오픈
Status: VERIFIED
## Command Anchors
- Search in main.js: `msg === "/베란다오픈"`
## Files
- `main.js`
## Related Helpers
- `hasItem`
- `getPetSkillBagRemainCount`
- `addPetSkillToBag`
- `removeItem`
## Data Usage
- `data.member[sender].bag["베란다 대확장📙(/베란다오픈)"]`
- `petSkillData[sender].petSkills.bag["베란다 대확장"]`
## Save Flow
- 펫과 아이템, 스킬가방 여유를 확인한 뒤 아이템 1개를 소비하고 한정판 펫스킬 1개를 지급한다. 회원 데이터와 펫스킬 데이터를 각각 저장한다.
## Related Commands
- `/펫스킬가방`
- `/펫스킬장착 [번호]`
## AI Notes
- 명령어는 정확히 `/베란다오픈`일 때만 실행한다. 일반 `/펫스킬오픈`의 랜덤 추첨 대상이 아니다.

---

# /펫스킬오픈 [개수]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬오픈`
## Files
- `main.js`
## Related Helpers
- `getPetSkillBagRemainCount`
- `getPetSkillBagTotalCount`
- `addPetSkillToBag`
- `pickRandomPetSkill`
## Data Usage
- skill-book item in `data.member[sender].bag`
- `petSkillData[sender].bag`
## Save Flow
- Consumes books, grants skills, saves member data and `petSkillData`
## Related Commands
- `/펫스킬확률`
- `/펫스킬가방`

## AI Notes

- `pickRandomPetSkill`은 `getPetSkillRandomWeight`가 반환한 스킬별 실제 확률을 하나의 통합 풀에서 누적 추첨한다. SS~C는 등급별 스킬당 고정값을 사용하고, D는 100%에서 SS~C 합계를 뺀 잔여 확률을 오픈 가능한 D 스킬 수로 균등 배분한다.
- `/펫스킬오픈`은 인자 없는 명령 또는 숫자 하나의 전체 패턴만 실행한다.
- `openable === false`인 `전설의 몽둥이📙[한정판]`의 추첨 가중치는 항상 0이라 단건·다건 오픈 모두에서 획득할 수 없다.

---

# /펫스킬북조합
Status: VERIFIED
## Files
- main.js
## Related Helpers
- combinePetSkillBookFragment
- hasItem
- removeItem
- addItem
## Data Usage
- data.member[sender].bag["펫스킬북 조각📙"]
- data.member[sender].bag["펫스킬북📙(/펫스킬오픈)"]
## Save Flow
- Successful combination consumes 10 fragments per requested count, grants the same count of pet skill books, and saves member data through `saveJsonFile(data, filePath)`.
## Related Commands
- `/티어보상지급`
- `/펫스킬오픈`
- `/펫스킬가방`
## AI Notes
- Exact/full-pattern command guard: `/펫스킬북조합` or `/펫스킬북조합 숫자`.
- Invalid suffix text does not execute.

---

# /펫스킬장착 [번호]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬장착`
## Files
- `main.js`
## Related Helpers
- `getPetSkillBagList`
- `getPetSkillSlotCount`
- `initPetSkillUser`
- `hasPetSkill`
- `canEquipTierPetSkill`
- `getTicketTierOrderIndex`
- `isPetSkillCompatible`
- `removePetSkillFromBag`
## Data Usage
- `petSkillData[sender].bag`
- `petSkillData[sender].equipped`
- `data.member[sender].rank.tier`
## Save Flow
- Moves skill from bag to equipped and saves `petSkillData`
## Related Commands
- `/펫스킬`
- `/펫스킬가방`
## AI Notes
- `전투형 지휘관📙`, `기사단 증원📙`, `징집명령📙`은 장착 시점에 길드마스터 여부를 검사하는 전용 스킬이다
- `야호📙`은 신규 뽑기 목록과 `/알림` 효과가 주석 처리되어 더 이상 획득·사용되지 않는다. 기존 보유 데이터는 유지한다.
- 티어 전용 펫스킬은 `ticketTierData` 순서로 현재 티어가 요구 티어 이상인지 장착 시 검사하며, 티어책끼리는 한 종만 허용하고 일반 스킬과는 함께 장착할 수 있다.
- 장착 후 티어가 내려가도 자동 해제하지 않으며, 티어책이 장착 목록에서 빠지면 레이드·캐슬 매력 보너스도 즉시 사라진다.
- `무쌍귀신📙` 장착 성공 시 공통 `equipComment` 출력 흐름으로 `무쌍귀신📙 촹 촹 챙챙 슈슉 슈슉 윽! 악!`을 표시한다.
- `VIP블랙카드📙` 장착 성공 시 귀속 안내 대신 `“가격표는 보지 않습니다. 직원이 알아서 낮출 테니까요.”` 전용 문구를 표시한다.
- `기분탓📙`은 `?` 단일 채팅 입력 시 현재 계정이 존재하고 해당 스킬을 장착한 유저 전원의 연출 멘트를 출력하며 수치 변화는 없다
- `종의 본능📙`은 `이쁘다` 정확 일치 입력 시 현재 계정이 존재하고 해당 스킬을 장착한 유저 전원의 연출 멘트를 출력한다
- `/계삭진행`과 `/계정잠수삭제`는 공통 `cleanupDeletedAccountResiduals` 흐름에 실제 삭제 성공 대상을 명시해, 해당 계정의 펫스킬·미니펫 컬렉션/칭호·펫/홈·시련의탑·펀치·펫탐험·소셜/방명록·시장·게시판·계정 식별 로그를 함께 제거하고 각 저장소를 명령 흐름에서 한 번씩 저장한다. 이때 다른 회원 목록 외 식별자를 함께 자동 정리하지 않는다.
- `품행제로📙`은 `/결투 [아이디]` 입력 시 70% 확률로 승리 연출 멘트, 30% 확률로 실패 연출 멘트를 출력하며 실제 승패 수치 변화는 없다
- `망한건 맞아📙`는 장착 시 랜덤 연출 멘트만 출력하며 실제 효과는 없다
- `창조림📙`은 대표·보조의 `창조` 등급 조건을 각각 판정해 레이드/캐슬 기본 50만 보너스에 100%·50%를 적용한다. `getEquippedNonTierPetSkillExp`에서 한 번 가산하며 별도 하드코딩 가산은 하지 않는다.
- `전설의 몽둥이📙[한정판]`는 장착 목록에 있을 때 레이드·캐슬 매력 50만씩을 동적으로 적용하고 `/펫스킬소멸`로 제거되면 즉시 회수한다. 장착 성공 시 `오오.. 영롱하군요 너..빌런인가?` 멘트를 표시한다.
- `베란다 확장📙[한정판]`은 가구 장착 한도를 3칸 늘린다. 소멸 후 한도를 초과하면 장착 목록 하단 가구부터 가구가방으로 회수하며, 가방 공간이 부족하면 스킬과 소멸권을 소비하지 않는다.
- `베란다 대확장📙[한정판]`은 `/베란다오픈`으로만 지급되며 가구 장착 한도를 6칸 늘린다. 기존 베란다 확장과 함께 장착하면 총 9칸이고, 각각 소멸할 때 해당 보너스만 회수한다. 가구가방 공간 부족 시 소멸을 보류한다.
- 베란다 확장·대확장 소멸 시 펫홈과 장착 가구 상세 파일은 명령 실행 전 스냅샷을 등록한 검증 저장을 사용한다. 저장 오류가 나면 공용 명령 트랜잭션이 펫스킬·회원 데이터와 함께 저장 완료된 가구 파일을 역순 복구하며, 복구 자체의 오류도 기록한다.
- `전설의 소매치기📙[한정판]`을 장착하면 `/슈킹 [아이디]`를 사용할 수 있다. 기존 `전설의소매치기`·`전설의소매채기` 저장 이름은 시스템 버전 갱신 시 표준 이름으로 변환한다.
- `VIP블랙카드📙`와 `쇼핑광📙`은 함께 장착할 수 없다.
- `인플루언서📙`과 `셀럽📙`은 중복 장착 시 `/펫홈`, `/홈알림`, `/팔로워순위` 표시 팔로워에 합계 3,000명을 더하며 실제 팔로워 관계와 뱃지 누적값은 바꾸지 않는다.
- `망므📙` 장착 멘트는 `이건 내 망므야!`이며 일일 마음 한도를 5회 늘린다.
- 일반 종합매력 무기 스킬은 서로 중복 적용하고 해제 즉시 계산에서 빠진다. `엘리트 박사📙`는 대표·보조의 엘리트 조건에 100%·50%를 각각 적용하고, `아르카나 하우스📙`는 가방·배치 합산 아르카나 루미에르 가구가 5개 이상일 때만 발동한다.

---

# /슈킹 [아이디]
Status: VERIFIED
## Files
- `main.js`
## Related Helpers
- `hasPetSkill`
- `getLegendaryPickpocketDailyData`
- `formatLegendaryPickpocketMessage`
- `addPoint`
- `checkRank`
## Data Usage
- `data.member[sender].point`
- `data.member[target].point`
- `data.member[sender].legendaryPickpocket.count`
- `data.member[sender].legendaryPickpocket.targets`
- `petSkillData[sender].petSkills.equipped`
## Save Flow
- 유효한 대상에 대한 확률 판정부터 일일 횟수와 동일 대상 기록을 소비하고 `saveJsonFile(data, filePath)`로 한 번 저장한다.
- 성공하면 대상 포인트 100만을 시도자에게 이동하고, 실패하면 포인트를 변경하지 않는다.
- `/리셋`에서 모든 회원의 `legendaryPickpocket` 일일 기록을 제거한다.
## Related Commands
- `/펫스킬장착 [번호]`
- `/펫스킬소멸 [번호]`
- `/리셋`
## AI Notes
- `전설의 소매치기📙` 장착이 필요하며 하루 2회, 동일 대상 하루 1회로 제한한다.
- 존재하지 않는 대상, 자기 자신, 일일 제한 초과, 동일 대상 재시도, 대상의 100만 미만 포인트는 확률 판정 전에 거절하므로 횟수를 소비하지 않는다.
- 유효한 시도는 성공·실패 모두 횟수를 소비하며 성공 확률은 50%다.
- 전체 인자 문자열을 회원 키로 사용하고 명령 접미 텍스트를 별도 인자로 허용하지 않는다.

---

# /휴면계정

Status: VERIFIED

## Files
- main.js

## Related Helpers
- ensureDormantAccounts
- isDormantAccount
- buildDormantAccountListMessage
- ensureAccountSuspensions
- removeAccountLifecycleEntriesOnDelete
- cleanupDeletedAccountResiduals
- collectDeletedAccountNames
- buildAccountSuspensionListMessage
- formatDormantDateText
- getDormantDays

## Data Usage
- data.dormantAccounts
- data.accountSuspensions.users
- data.member[target]

## Save Flow
- `/휴면계정 [아이디]` registers `data.dormantAccounts[target]` and saves `data` through `saveJsonFile(data, filePath)`
- `/휴면해제 [아이디]` deletes `data.dormantAccounts[target]` and saves `data` through `saveJsonFile(data, filePath)`
- `/계삭진행` skips targets registered in `data.dormantAccounts` and reports them under `휴면보호`
- `/계정잠수명단` and `/계정잠수삭제` exclude registered dormant accounts from removal candidates
- `/계정잠수삭제` reports dormant accounts that matched the sleep condition but were protected
- `/계삭진행`과 `/계정잠수삭제`에서 실제 삭제된 아이디는 `data.accountSuspensions.users`와 `data.dormantAccounts`에서도 함께 제거한다.
- `/휴면계정리스트` and `/계정정지리스트` are read-only and do not save member data

## Related Commands
- `/휴면계정 [아이디]`
- `/휴면해제 [아이디]`
- `/휴면계정리스트`
- `/계정정지리스트`
- `/계삭진행 [아이디1, 아이디2, ...]`
- `/계정잠수명단`
- `/계정잠수삭제 [숫자]`

## AI Notes
- 휴면계정 보호 목록은 별도 파일이 아니라 `data` 안의 `dormantAccounts`에 저장한다.
- 휴면계정 등록/해제는 계정 삭제 대상 제외 목록만 변경하며 기존 회원 데이터는 변경하지 않는다.
- 기존 `/휴면리스트`는 제거되었으며 입력해도 반응하지 않는다.
- 계정정지 목록은 `data.accountSuspensions.users`를 휴면 목록과 같은 날짜 표시 형식으로 읽고 `allsee` 전체보기를 지원한다.

---

# /펫스킬당근 [닉] [번호] [개수]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/펫스킬당근`
## Files
- `main.js`
## Related Helpers
- `getPetSkillBagList`
- `initPetSkillUser`
- `getPetSkillBagRemainCount`
- `addPetSkillToBag`
- `removePetSkillFromBag`
- `isMemberTierKing`
## Data Usage
- sender/receiver `petSkillData[*].bag`
## Save Flow
- Moves skills between users and saves `petSkillData`
## Related Commands
- `/펫스킬가방`
- `/당근`

## AI Notes
- 공통 커뮤니티 제한과 정확한 인수 검사는 `/당근` 항목을 참고한다. 수량당 당근 300개와 기존 양쪽 킹 이상·스킬가방 한도 조건을 유지한다.

---

# /미니펫장착 [번호]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/미니펫장착`
## Files
- `main.js`
## Related Helpers
- `refreshMiniPetSortIndex`
- `formatPetInfo`
- `setMiniPetEquipState`
## Data Usage
- `petData[sender].miniPetBag`
- `petData[sender].miniPet`
- `userState[sender].miniPet`
## Save Flow
- Starts confirmation flow; final persistence happens on confirmation branch
## Related Commands
- `/귀속해제`
- `/미니펫가방`

---

# /미니펫조합 [번호] [번호] / /미니펫조합태초+|창세|창조
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/미니펫조합`
## Files
- `main.js`
## Related Helpers
- `getMiniPetCombinationConfig`
- `getMiniPetCombinationConfigByGrades`
- `createMiniPetFromCombination`
- `removeMiniPetsFromBag`
- `refreshMiniPetSortIndex`
## Data Usage
- `petData[sender].miniPetBag`
- `miniPetData.miniPet`
- `miniPetData.gradeTable`
## Save Flow
- Consumes source mini-pets, creates result mini-pet, saves `petData`
## Related Commands
- `/미니펫가방`
## AI Notes
- `/미니펫조합 [번호] [번호]` auto-detects same-grade materials and supports `초월+ 2개 -> 태초`, `태초 2개 -> 태초+`, `태초+ 2개 -> 창세`, and `창세 2개 -> 창조`
- `태초` rewards are selected from `miniPetData.miniPet` because `MINI_PET_COMBINATION_REWARDS` has no dedicated `태초` table

---

# /미니펫조합엘리트
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/미니펫조합엘리트`
## Files
- `main.js`
## Related Helpers
- `isEliteMiniPetCombinationMaterial`
- `pickEliteMiniPetCombinationReward`
- `createEliteMiniPetFromCombination`
- `removeMiniPetsFromBag`
- `refreshMiniPetSortIndex`
## Data Usage
- `petData[sender].miniPetBag`
- `data.member[sender].point`
## Save Flow
- Failure consumes only 500억 points and saves `filePath`
- Success consumes 500억 points, removes the selected two 창조 300강 mini-pets, adds one 엘리트 mini-pet, saves `filePath` and `memberPetPath`
## Related Commands
- `/미니펫조합엘리트 [미니펫가방번호] [미니펫가방번호]`
- `/미니펫가방`
- `/미니펫강화`
## AI Notes
- `컬렉션창조 미니펫🐹(+1💕)[창조]` is explicitly excluded from elite-combination materials
- Elite reward pool contains 아르케, 카오스, 데미우르고스, 아이온, 로고스
- Elite-combination material checks rely on 창조 mini-pets reaching 300강; current mini-pet upgrade cap supports that path

---

# /미니펫조합마스터
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/미니펫조합마스터`
## Files
- `main.js`
- `Info.js`
## Related Helpers
- `isMasterMiniPetCombinationMaterial`
- `pickMasterMiniPetCombinationReward`
- `createMasterMiniPetFromCombination`
- `buildMasterMiniPetGuideMessage`
- `buildMasterMiniPetCombinationConditionFailMessage`
- `buildMasterMiniPetCombinationFailMessage`
- `buildMasterMiniPetCombinationSuccessMessage`
## Data Usage
- `data.member[sender].point`
- `petData[sender].miniPetBag`
## Save Flow
- Failure consumes only 350억 points and saves `filePath`
- Success consumes 350억 points, removes the selected five 엘리트 300강 mini-pets, adds one 마스터 mini-pet, saves `filePath` and `memberPetPath`
## Related Commands
- `/미니펫조합마스터 [미니펫가방번호] [미니펫가방번호] [미니펫가방번호] [미니펫가방번호] [미니펫가방번호]`
- `/미니펫가방`
- `/미니펫강화`
- `/미니펫판매`
## AI Notes
- The command and its guide are available to every registered user in every room.
- The command accepts exactly five numeric, non-duplicate bag indexes; suffix guide text does not execute.
- Master reward pool contains 영겁의 템푸스, 무한의 인피니타, 천상의 엠피레온 with equal selection probability after the 5% combination succeeds.
- Master mini-pets gain 15,000 charm per successful upgrade, support up to 300 upgrades, and sell for 5000억 points.

---

# /관리자명단|관리자추가|관리자삭제|관리자일당|부방상여
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/관리자명단`, `/관리자추가`, `/관리자삭제`, `/관리자일당`, `/부방상여`
## Files
- `main.js`
## Related Helpers
- `getAdminPayoutUsers`
- `buildAdminListMessage`
## Data Usage
- `data.admin`
- `data.member[*].point`
- `data.member[*].bag[입력한 아이템이름]`
## Save Flow
- `/관리자추가` and `/관리자삭제` mutate `data.admin` and save `filePath`
- 실제 관리자 등록·해제 성공 시 대상 회원 가방에 서버이동권을 1개 지급하고 같은 `filePath`에 저장한다. 중복 등록·삭제에는 지급하지 않는다.
- `/관리자일당` reads `data.admin`, gives existing members `GLOBAL_CONFIG.admin.dailyPayoutPoint` (3억) points, reports actual paid count, and saves `filePath`; 인증 수당 누계에는 합산하지 않는다.
- `/부방상여 아이템이름/갯수`는 마지막 `/숫자`를 수량으로 해석하고, `data.admin`의 실제 가입 유저에게 입력 아이템을 지급한 뒤 대상 수와 지급 내역을 출력하고 `filePath`를 저장한다.
## Related Commands
- `/관리자명단`
- `/관리자추가`
- `/관리자삭제`
- `/관리자일당`
- `/부방상여 아이템이름/갯수`
## AI Notes
- Payout commands no longer keep separate hardcoded recipient arrays
- `isAdmin` requires both `data.admin` membership and execution in `호이월드 GM 관리자방`, `원탁의 호월`, `팻 테스트방`, `통합스텝`, or `서버관리자`
- `isMaster` requires both `data.master` membership and execution in `팻 테스트방`, `서버관리자`, `원탁의 호월`, or `호이월드 GM 관리자방`
- `GLOBAL_CONFIG.permissions.additionalServerAdminRooms`는 원탁의 호월·호이월드 GM 관리자방·주문기록방을 관리한다. Main·Info에 동일하게 적용하고, Main의 `isServerAdminRoomOperator`를 사용하는 길드영지·펫무쌍 시작 권한도 서버관리자방과 동일하게 허용한다. 일반 유저는 방에 들어가도 관리자·MASTER 권한을 얻지 않는다.
- 2026-10-20 주문기록방: `isOrderLogRoomBot`는 정확한 방명과 기존 `오픈채팅봇` 이름으로만 판별한다. 해당 방의 봇에는 Admin/Master 및 신원 권한을 허용하며, 기존 운영자 닉네임 직접 검사 관리 조건 133곳과 경매마감·후원지급 목록 검사도 이 예외를 연결한다. 원래 발신자·회원 키를 바꾸거나 명단에 영구 등록하지 않는다. 다른 방의 봇·일반 사용자와 게임 횟수 특례·전역 이벤트 명령 제한은 유지한다. 이후 관리 명령은 공통 역할 함수와 추가 운영방 목록을 사용한다.
- `/주기리셋` and `/자동탐험시작` additionally allow an Admin or `오픈채팅봇` in `호이월드 GM 관리자방`; their existing Master access remains available in Master-authorized rooms
- `/관리자일당` authorization remains `호이 남` and `오픈채팅봇`
- `/부방상여` authorization remains `호이 남`
- 인자 없는 `/부방상여`는 사용법만 출력하며 지급하지 않는다. 아이템명 내부의 `/관련명령어` 표기는 유지하고 마지막 `/숫자`만 지급 수량으로 분리한다.

---

# 서버 레이드대전

Status: PARTIAL

## 2026-10-11 수정요청서 반영 (ver_2.623)

- 기획: `서버레이드대전 수정요청서_2026-10-12` (`fc0393bdd7aa83db847f8167f9164a77`). 사용자 요청으로 예정일보다 먼저 반영한다.
- `/레이드전적`은 개인 누적·최근 참가 보상, `/레이드순위`는 현재 소속 서버 유저의 누적 순위다. `/서버대전`은 준비·진행·정산 중인 현재 회차만 조회한다. 종료 후에는 진행 중인 대전이 없다고 안내한다.
- `buildServerRaidCurrentRows`는 현재 회차의 정상 공격 계정을 서버별로 집계해 등록 10개 서버를 모두 표시한다. 같은 계정은 한 명이며 0데미지 정상 공격도 참가자로 포함한다. 데미지 합산·비교는 기존 정수 문자열 연산, 동점은 기존 공동 순위다. 누적 기록·회원·회차 원본을 변경하거나 저장하지 않는다.
- `buildServerRaidCurrentStatus`는 실제 소속·KST 종료 시각·승수·데미지·참가 인원을 출력한다. 준비 중에는 준비 종료 시각과 공격 시작 후 마감 확정 안내를 표시한다. 마감 또는 정산 중에는 공격 진행 중이라고 표시하지 않는다. `📂 전체 서버 실시간 순위 펼쳐보기` 바로 뒤에 ALLSEE를 둔다.
- 새 회차는 기본 5회+서공권 추가 최대 10회로 총 15회다. 시작 시 복사한 회차 정책을 사용해 이미 진행 중인 추가 5회 회차는 기존 한도를 유지한다. 한도 안의 공격은 초과 시도가 아니며 초과 3회 무료·4회째 1천만 규칙은 유지한다.
- `/레이드턴`·`ㄹㄹ`은 남은 횟수·현재 보유량·마감 뒤에 공격·전적·우리 서버 순위·현황 안내를 표시한다. `/서버레이드전체순위`는 추가하지 않는다.
- 검증: `tools/test_server_raid.js`는 이전 회차 정책의 130개 회귀 그룹을 유지한다. `tools/test_server_raid_oct12.js`는 실제 새 설정으로 15회 경계·이전 정책 보존·누적/현회차 구분·참가 계정 중복 제외·큰 정수·ALLSEE·7인수 콜백·DEV·저장 실패/재시도를 검증한다. 기기 실행은 운영자 영역이다.

## 2026-10-09 공격권·핸디캡 변경 (ver_2.617)

- 기획: `서버_레이드대전_공격권_핸디캡보상_최종기획서 (1)` (`b02393bdd7aa821a99f1812e8f6d29da`). 아래 과거 5회·초과 2회부터 5천만 설명은 기준 미기록 기존 회차에만 적용한다.
- ver_2.617 당시 회차는 기본 5회 후 `서버레이드공격권👾` 1개당 추가 1회, 계정당 회차 최대 5회 추가했다. ver_2.623 새 회차의 한도는 위 최신 수정 내용을 따른다.
- `createServerRaidRoundPolicy`가 시작 시 횟수·아이템명·패널티·핸디캡 지급표를 복사한다. `getServerRaidRoundPolicy`는 기준 미기록 이전 회차에 기존 5회·초과 2회부터 5천만·핸디캡 없음 기준을 적용한다. 진행·정산 중 회차와 과거 완료 회차에는 새 지급 기준을 소급하지 않는다.
- `getServerRaidAttackAvailability`는 정상 공격 목록에서 기본·추가 사용 횟수를 분리하고, 추가 가능 횟수는 `min(가방 보유 수량, 회차 남은 추가 한도)`로 계산한다. `getServerRaidTicketCount`는 문자열·소수·음수·안전 정수 초과 수량을 거부하고 누락 가방은 미보유로 읽는다. 헬퍼에 파일 IO가 없다.
- `/레이드공격`은 기존 자격·방·회차·마감·이벤트 검사 뒤 공격권·포인트·데미지·정상 공격·이벤트 완료 기록을 같은 회원 파일 저장으로 확정한다. 저장 실패 복구와 확장 원본 ID 재전송 방지는 기존 트랜잭션을 유지한다. 기본 7인수 콜백은 이전 승인대로 호출마다 별도 시도로 처리한다.
- 이용 가능한 공격이 없을 때 초과 3회까지 무료, 4회째부터 매회 1천만을 차감한다. 부족하면 차감 없이 초과 횟수만 기록한다. 중간에 공격권을 얻어 정상 추가 공격을 하더라도 초과 누적 횟수는 유지한다. 초과 입력은 데미지·공격 보상·정상 누적 공격에 포함하지 않는다.
- 공격 결과는 기본·추가 남은 횟수와 공격 직후 서공권 수량·소모 여부를 저장 결과로 표시한다. `/레이드턴`·`ㄹㄹ`은 실제 현재 가방으로 같은 추가 한도를 조회하고 자동 종료 시각을 유지하며 저장하지 않는다.
- 기존 허용 목록에 `/이체`, `/이체 대상 금액`, `/펫정보`를 추가했다. 이체 대상의 공백과 기존 숫자 형식만 통과하며 접미 설명·수수료 변경·`/ㅎ`·`ㅁㅁㅁ`는 새 예외가 아니다. Main·Info의 기존 가입·출석·계정정지·일대일 패스·티어·다른 대전 제한을 유지한다.
- 종료 시 정상 공격 1회 이상 참여자의 공격 당시 서버 최종 공동 순위로 핸디캡 수량을 고정한다. 1위 0개, 2~3위 1개, 4~6위 2개, 7~9위 3개, 10위 4개다. 기존 상금과 공격권·지급 완료 상태를 같은 저장으로 처리하고 이미 완료된 참가자는 건너뛴다. 닉네임·현재 소속 변경은 원래 참가 서버의 지급 기준을 바꾸지 않는다.
- 종료 UI는 기존 ALLSEE 1회를 유지하고 상금 아래 핸디캡을 표시한다. 삭제 계정 등 미지급 대상은 실제 지급 인원을 함께 안내하며 아무도 받지 못한 서버에는 지급됐다는 수량 줄을 출력하지 않는다. 미참여 계정·서버에는 지급하지 않는다.
- `node tools/test_server_raid.js`는 기존 기준 108개 회귀와 새 기준 22개를 합쳐 130개 그룹을 검증한다. 새 테스트는 실제 7인수 콜백, 0/1/4/5/10개, 초과 3/4회와 잔액 경계, 추가 획득, 저장·응답 실패, 재시작·닉변·DEV 분리, 공동 순위·0데미지·미참여, 부분 정산·삭제 계정·수량 초과, 실제 이체 분기와 Info 펫정보 자격 검사, 치명타 UI·공격 횟수와 무관한 보상·자동/수동 종료 경합·전체 초기화까지 포함한다. 기기 실행·펫정보 전체 렌더링은 이 합성 테스트의 검증 범위가 아니다.
- 2026-10-09 최종 검증: 130개 그룹 5회 반복 통과, `tools/test_latest_server_display.js` 통과, Main·Info·테스트 문법 검사와 수정 파일 UTF-8·diff 검사 통과. 버전·개발자노트는 ver_2.617로 동기화하며 노션 실제 반영 속성은 원격 운영 소스 검증 후 기록한다.

## Files / Commands

- `main.js`: `/서버대전시작`, `/서버대전종료`, `/서버대전전체초기화`, `/레이드공격`, `/레이드전적`, `/레이드순위`, `/서버대전`, `/레이드턴` (별칭 `ㄹㄹ`).
- 남은 턴 UI는 남은 공격 줄 바로 아래에 저장된 `autoEndAt`을 `formatServerRaidKstTime`으로 변환한 자동 종료 시각을 표시한다. 0회에도 같은 위치에 표시하고 종료 시각이 없는 이전 회차에는 임의 마감을 만들지 않는다. DEV는 해당 DEV 회차의 마감을 사용한다.
- 남은 턴 조회 기획: `서버레이드대전_남은턴조회_기획서` (`e4b393bdd7aa8301ae678187407aba00`). `/레이드턴`·`ㄹㄹ`만 앞뒤 공백 제거 후 정확히 판별한다. 모든 운영방에서 본인 계정만 조회하며 기존 일대일 패스·출석·정지 조건을 유지한다. DEV는 팻 테스트방으로 한정한다. 일반 잠금·공격 초과 패널티 전에 반환한다.
- 실행 명령은 인수 없이 정확히 입력한다. 이전 `/레이드기록`은 `/레이드전적`, `/서버레이드기록` 및 `/서버레이드순위`는 `/레이드순위`만 안내하며 기록 조회·파일 IO를 수행하지 않는다. `/서버레이드순위 서버명`도 변경 안내만 출력한다.
- 사용자 후속 결정으로 운영 `/서버대전시작`, `/서버대전종료`는 모든 방·일대일톡에서 허용하며 기존 MASTER·인증된 운영봇 권한을 유지한다. 초기화·공격은 단체방 `공성전`과 `팻 테스트방`에서 허용한다. `/레이드전적`, `/레이드순위`, `/서버대전`는 모든 운영방·일대일톡에서 준비·진행·정산 중에도 조회한다. 조회의 일대일 호이패스·출석·계정정지 조건은 유지한다. DEV 명령은 `팻 테스트방`으로 한정한다. 다른 방의 공격·초기화는 데이터 로드·저장 전 차단하며 두 공격방의 계정당 공격 한도는 새 회차 기본 5회+추가 최대 10회로 합산 15회다.
- `Info.js`: 기존 정보·순위의 잠금 및 서버 누적 우승 표시.
- 기획: `서버_레이드대전_개발기획서_초안` (`83c393bdd7aa8266843001b9d40ca710`). 본문은 보존하며, 원격 운영 반영 확인 후 상태·실제 반영일·버전을 갱신한다.
- 종료 UI 기획: `서버_레이드대전_상금표시_allsee_수정기획서` (`86f393bdd7aa83beb61301637c06ccfd`). 공격 보상은 2026-10-06 사용자 수정 요청을 적용한다.
- 추가 수정 기획: `서버_레이드대전_추가_수정_기획서` (`aae393bdd7aa83acbb3c81809e181067`). 명령어방은 사용자가 확정한 공성전·팻 테스트방이며 대전 중 일반 명령 잠금은 기존 정책을 유지한다.
- 최신 공격 UI 기획: `서버_레이드대전_공격결과_UI_개선_기획서` (`7a2393bdd7aa828bac708180f5be72ad`). 공격 UI를 유지하며 최종 수치 조정 기획에 따라 새 공격의 보상은 치명타 전 레이드매력의 3%다. 기존 지급 기록은 보존한다.
- 최신 순위 UI 기획: `서버_레이드순위_UI_allsee_최종기획서` (`346393bdd7aa839b9a4c01bac2e5da26`). 누적 기록·최근 회차를 분리하고 요약 아래 ALLSEE를 한 번 사용한다. 사용자 결정으로 운영 조회 2종은 모든 방에서 허용한다.
- 이전 수치 조정 기획: `[최종본]서버_레이드대전_권한_및_자동종료_기획서 (1)서버 레이드대전 수치 조정 기획서` (`dce393bdd7aa821b916f016d21e5df86`). 치명타 전 레이드매력의 3%, 서버 1~10위 참여자 1인당 3억부터 3천만씩 감소한 상금은 유지한다. 당시 시작 명령부터 준비 포함 15분 정책은 다음 최신 기획으로 대체한다. 이미 시작한 회차의 마감과 확정된 상금·공격 지급 기록은 보존한다.
- 과거 수정 기획 (ver_2.615): `[최종최종]레이드대전_수정_기획서 (1)` (`05f393bdd7aa8234a214811a6061a605`). 준비 60초와 별도로 실제 공격 활성화부터 30분 진행한다. 당시 `/레이드순위`(현재 `/레이드전적`)의 기여도 아래·순위 위에 정상 누적 공격횟수를 표시하고 기존 ALLSEE 위치를 유지한다. 회차별·계정별 첫 초과 시도는 경고와 0포인트, 두 번째부터 매회 5천만 포인트를 차감한다. 사용자 확정으로 잔액이 부족하면 차감 없이 안내하고 초과 횟수만 기록한다. 실패·초과 시도는 정상 누적 횟수·데미지·보상에서 제외한다.
- 명령 제한 안내 기획: `서버_레이드대전_명령어_제한_안내_수정_기획서` (`bc4393bdd7aa83cd98218174d4985a63`). `buildServerRaidLockMessage`는 입력자의 기존 채크랭크와 저장된 회차 마감을 KST `YYYY.MM.DD HH:mm`으로 표시한다. 일반 게임·단축 명령은 실행 전에 안내 1회 후 종료한다. 마감에 도달한 차단 입력은 기존 `closeServerRaid`로 자동 종료 상태를 저장하고 예약 정산을 재개한다. 정산 중에는 대전 참여 안내 대신 종료 처리 안내를 출력하며 정산 완료 후 잠금을 해제한다. 일반 채팅·허용된 순위 조회·공격·운영 종료의 기존 동작은 유지한다.
- 추가 허용 기획: `서버_레이드대전_사용_가능_명령어` (`fde393bdd7aa83568600012f8c15e410`). 준비·진행·정산 중 기존 레이드 명령에 더해 `ㅊㅊ`, `/미정`, `/정보`, `/주기리셋`, `/펫탐험정산`, `/포인트`, `/패키지지급`, `/패키지가방`, `/패키지사용`, `/가방`을 기존 처리로 통과시킨다. 기존 대상 이름·패키지 번호·수량 인수 형식만 허용하며 접미 설명·유사 명령·미지정 별칭은 잠금을 유지한다. 원래 권한·출석·정지·일대일 패스·다른 대전 제한은 계속 검사한다. DEV `dev/ㅊㅊ`는 기존 출석 단축어로 정규화한다.

## Related Helpers

- 회차: `createServerRaidState`, `startServerRaid`, `activateServerRaid`, `closeServerRaid`, `resetServerRaid`.
- 추가 예외: `isServerRaidAdditionalCommand`, `GLOBAL_CONFIG.serverRaid.commands.additionalExact`. 레이드 진입부의 일반 잠금만 제외하고 기존 명령 처리로 연결한다. Info는 `isInfoServerRaidAdditionalCommand`와 해당 파일의 설정으로 `/정보`·`/포인트`·포인트 단축키 `ㅍㅍㅍ`를 통과시킨다. 두 판별 함수에는 파일 IO·저장·권한 변경이 없다. DEV `dev/ㅍㅍㅍ`는 Main·Info 모두 기존 포인트 단축어로 정규화한다.
- 남은 턴: `isServerRaidTurnQueryCommand`, `buildServerRaidTurnMessage`, `getServerRaidCurrentParticipant`. ACTIVE이면서 저장된 마감 전인 회차의 동일 계정·소속 기간 `attacks.length`만 읽어 저장된 회차 정책 기준의 기본 남은 횟수와 서공권 보유량/추가 한도를 표시한다. 누적·초과 시도는 제외한다. 준비·정산·완료·마감 도달은 미진행 안내를 출력한다. 조회 중 계정/참여 기록 생성·포인트 차감·저장·예약 작업 재개를 하지 않는다.
- 자동 종료: `isServerRaidAutoEndDue`, `getServerRaidWorkDelay`, `buildServerRaidTimeNotice`, `GLOBAL_CONFIG.serverRaid.timers.durationMs`. 준비·자동 종료·공지 재시도 중 가장 이른 시각으로 기존 환경별 타이머 1개를 재사용한다.
- 공격: `getServerRaidAttackCheck`, `applyServerRaidAttack`, 기존 `calculateRaidExp`, `calculateCriticalDamage`, `calculateEffectivePetUpgradeLevel`.
- 초과 시도: `applyServerRaidExcessAttempt`, `buildServerRaidExcessMessage`, `GLOBAL_CONFIG.serverRaid.penalties`. 정상 공격 계산 전에 별도 분기로 처리하고 저장한 실제 차감·부족 결과로 안내한다. 두 헬퍼는 파일 IO가 없다.
- 수신 식별값: `getServerRaidCallbackEvent`, `getServerRaidNativeId`, `getServerRaidEventId`, `createServerRaidAttackEvent`.
- 명령방: `isServerRaidCommandRoom`, `isServerRaidQueryCommand`, `GLOBAL_CONFIG.serverRaid.rooms`. 운영 시작·종료·조회는 방 제한에서 제외한다. 시작·종료는 기존 MASTER 명단의 `isMasterIdentity`와 인증된 운영봇 권한을 검사한다. 레이드 조회는 대전 잠금에서 제외하며 시작·종료의 기존 중복 처리 정책은 유지한다. 일반 명령의 추가 예외는 별도 판별 함수를 사용한다.
- 순위·정산: `buildServerRaidResults`, `rankServerRaidRows`, `settleServerRaidParticipant`, `buildServerRaidAccountIndex`, `finishServerRaidSettlement`.
- 정확한 합계·기여도: `addServerRaidInteger`, `compareServerRaidInteger`, `serverRaidPercent`.
- 이동·조회: `applyServerRaidMembershipChange`, `buildServerRaidPersonalRecord`, `buildServerRaidServerRecord`.
- 공통 누적 조회: `getServerRaidCurrentParticipant`, `buildServerRaidCumulativeRecord`, `appendServerRaidOwnRecord`. 같은 현재 소속·기간·계정 집합에서 정산 누적과 미지급 진행 회차를 한 번만 합산한다. 개인·서버의 데미지·기여도·순위가 같은 기준이다.
- 최근 참가 조회: `getServerRaidLatestRecord`, `getServerRaidAttackRewardGuide`. 진행·정산 회차에 참여했으면 해당 회차를 우선하며, 과거 공격은 당시 실제 지급 기준을 안내한다. 조회 헬퍼는 파일 IO·지급·저장을 하지 않는다.
- 출력: `formatServerRaidServer` / `formatInfoServerRaidServer`, `isServerRaidLocked` / `isInfoServerRaidLocked`.
- 상금 출력: `formatServerRaidPrize`, `getServerRaidResultPrize`, `buildServerRaidResultNotice`. 종료 시 확정된 참가자 1인당 지급액을 사용하고, 이전 저장 형식은 참가자의 확정 금액을 읽는다. 출력 헬퍼는 지급하거나 저장하지 않는다.

## Data Usage / Save Flow

- 기존 `member.json`의 `data.serverRaid`에 초기화 세대, 회차 번호, 준비·진행·정산 상태, 완료 회차 수, 서버 우승, 공식 결과, 원본 이벤트 처리 상태, 방별 공지 완료 상태를 저장한다.
- 새 회차의 준비 단계에는 `requestedAt`, `prepareUntil`, `durationMs`, `durationBasis: "activeStart"`를 저장한다. 준비 60초 이후 실제 활성화 시 `startedAt`과 `autoEndAt = startedAt + durationMs`를 함께 최초 확정한다. 활성화 저장이 실패하면 준비 상태를 유지하며 성공한 재시도 시각부터 계산한다. 준비 중 중단이 길어져도 새 회차는 실제 활성화 후 30분을 확보한다. 활성화 뒤 미발송 준비 안내는 취소하여 오래된 60초 안내를 보내지 않는다. 설정 변경·중복 시작·공지 재시도로 마감을 연장하지 않는다. 표시 기준이 없는 기존 회차는 저장된 마감을 유지하며 종료 시각 없는 이전 회차에는 새 시간을 소급하지 않는다.
- `data.member[user].serverRaidAccount`는 내부 UUID·소속 기간·최근 개인 기록·현재 서버 누적 참가 기록이다. 닉네임 키가 바뀌어도 같은 회원 객체의 UUID를 재사용하고 새 회원은 새 UUID를 받는다.
- 공격마다 R(레이드매력), D(치명타 포함 최종 데미지), P(버림 처리한 R의 3%)를 구분해 저장한다. `calculateServerRaidAttackReward`는 몫·나머지 계산으로 큰 안전 정수에서도 정확히 버린다. 새 공격은 `rewardBasis: "raidCharm"`, `rewardPercent: 3`을 저장하고 `getServerRaidAttackPercent`는 이전 비율 미기록 공격을 당시 1%로 읽는다. 이전 `damage`·R1% 공격과 혼합 기록은 당시 지급액·기준·비율을 유지하며 재전송 시 재계산·추가 지급하지 않는다. 실제 치명타 판정은 기존 `calculateCriticalDamage`의 선택 결과 인수로 함께 받아 0매력에서도 유지한다. 기존 호출의 숫자 반환값은 유지한다. D 합계는 십진 정수 문자열로 정확히 계산한다. 개별 R·D·포인트는 기존 Number 안전 정수 범위를 검사하며 초과 시 차감·지급하지 않는다.
- R은 기존 `calculateRaidExp`로 계산하며 가방의 레이드타격대인장(개당 +600)과 홈뱃지·길드 큐브·레벨·퀘스트 보너스를 포함한다. 종합매력을 사용하지 않으며 포함된 보너스를 중복 가산하지 않는다.
- 공격·종료·초기화는 명령 쓰기 잠금과 기존 데이터 트랜잭션 잠금으로 직렬화한다. 공격 횟수·포인트·데미지·이벤트 완료 상태를 `member.json`에 한 번에 저장한다.
- 공격 안내는 `buildServerRaidResults(round, false, true)`로 서버 순위 집계 뒤 개인 순위 정렬을 생략한다. 조회/종료 정산은 기존 정렬을 유지하며 `freeze === true`는 생략 인수와 무관하게 개인 결과를 확정한다. `tools/test_raid_ranking.js`와 `tools/test_raid_ranking_rhino.js`에서 서버/개인 정산·메시지 일치를 대조한다.
- 분리 저장은 `stringifyMemberSplitStore`로 비교용 JSON 본문을 재사용한다. `readMemberSplitStore`의 비열거 `__memberSplitSourceText`는 방금 검증한 분리 원문을 해당 백업 호출에서 재사용하며 파일 형식에는 추가하지 않는다. `saveJsonFile`은 같은 저장 잠금에서 읽고 검사한 회원 원문/파싱 결과를 `writeVerifiedJsonFile`/`preserveMemberSplitBackupStores`에 전달한다. 명령 간 캐시·백업/fsync 생략 없이 중복 작업만 줄인다. 검증 근거는 `tools/storage_io_reuse_validation.md`를 따른다.
- 추가 허용 명령은 기존 공통 전처리·권한 검사·파일 로드·저장·복구 흐름을 사용하며 레이드 공격/보상 기록과 마감을 직접 수정하지 않는다. 패키지 지급·사용은 기존 회원 파일과 패키지 로그 저장 트랜잭션을 유지한다. 수동 탐험의 `stopAllIntervals`는 탐험 `intervalIDs`만 정리하며 별도 `serverRaidWorkTimers`의 자동 종료 예약은 보존한다.
- 대전 중 차단된 `/펫탐험자동정산`은 `exploreInterval` 실행 표시를 해제한다. 이전 자동 탐험 예약이 다음 허용 명령에서 의도치 않게 실행되지 않도록 하며, 대전 종료 후 자동 정산과 수동 `/펫탐험정산`의 기존 흐름은 유지한다.
- 초과 시도는 참가자의 `excessAttempts`, `excessEvents`에 횟수·실제 차감액·부족 여부·당시 비용을 기록하고 `eventReceipts`에 회차·계정·초과 구분을 함께 저장한다. 회원 포인트와 같은 저장 단위로 확정한 뒤 안내한다. 저장 실패는 모두 복구하며 응답 실패 후 같은 원본 ID를 재전송해도 재차감하지 않는다. 부족 결과 재전송은 이후 입금돼도 다시 차감하지 않는다. 이전 참가자의 새 필드가 없으면 첫 초과부터 기록하며 다음 회차 참가자는 초과 0회로 생성한다. 정상 공격 목록·데미지·공격 보상은 변경하지 않는다.
- 정산은 미지급 참가자의 포인트와 완료 상태를 묶어 한 번 저장한 뒤 우승·완료 횟수·확정 결과를 저장한다. 이미 지급된 계정은 재시도 시 건너뛴다. 조회용 기록은 서버와 소속 기간이 모두 일치할 때만 작성한다.
- 누적 조회는 미지급 진행 참가자의 정상 공격·참가 1회를 추가하고, 지급 완료된 참가자는 이미 기록된 누적만 사용해 부분 정산·재시작에서도 중복되지 않는다. 개인 화면의 `🎯 누적 공격: N회`는 정상 공격만 세 자리 쉼표로 표시하며 서버 화면의 기존 요약은 유지한다. 최근 회차가 진행·정산 중이면 확정 보상 합계·지급 완료 문구를 표시하지 않는다. 기록 없는 화면에는 ALLSEE를 생략하고 0 데미지 기여도는 0.00%로 표시한다. 현재 소속 기간의 이동·초기화 정책은 유지한다.
- `scheduleServerRaidWork`는 준비·마감·정산의 예약 진입점이다. 준비 마감, 초기화 세대, 회차 번호, 타이머 식별값을 재검사하고 공지는 `scheduleServerRaidNoticeWork`/`runServerRaidNotices`에 맡긴다. 일반 계산·변경 헬퍼에는 파일 IO가 없다.
- 일반 명령은 회원 파일을 읽은 뒤 미완료 작업을 재예약하며 레이드 운영 명령은 권한 검사 뒤 재예약한다. 권한 없는 시작·종료·초기화는 상태·타이머를 바꾸지 않는다. 재시작 후 허용된 명령이 잠금·중복 종료 안내로 조기 반환돼도 DEV/PROD 준비·자동 종료·정산·공지를 재개한다. 이미 예약된 환경에는 타이머를 추가하지 않는다.
- 종료 시각 이후 공격은 타이머 실행 여부와 관계없이 거부한다. 수동·자동 종료는 동일한 정산 절차와 회차·세대·타이머 식별값 검사로 중복 지급을 막는다. 종료 때 미발송 준비·시작 안내에는 `cancelled`를 기록해 오래된 공지를 생략하되 실제 발송 상태는 보존한다.
- 공지는 기존 `noticeMsg` 대상 목록을 재사용하고 입력방을 중복 제외한다. 저장된 완료 방은 재발송하지 않는다. API 발송 성공과 완료 상태 저장 사이의 종료·저장 실패에는 실제 전달 여부가 불명확하여 공지 중복 가능성이 남는다. 공지 재시도로 보상을 다시 지급하지 않는다.
- 2026-10-20 공지 격리·저장 개선: 전투 예약과 환경별 단일 공지 작업을 분리한다. 공지 API는 전용 Java 스레드에서 데이터 잠금 밖으로 호출하며, 실패 방의 후속 공지만 보류한다. 전송이 대기해도 공격·자동 종료·지급은 진행한다. 같은 방의 종료→결과 순서는 유지하되 보상 지급은 전송 완료를 기다리지 않는다.
- 발송 성공은 보호 JSON `serverRaidNoticeReceipts.json`에 `{version:1,generation,sent}`로 즉시 검증 저장한다. 키는 `[공지 ID,방명]`의 JSON 문자열이며 재시작 때 성공한 방을 생략한다. 처음 설치할 때만 파일 생성과 레이드의 `noticeReceiptsVersion:1`을 같은 트랜잭션으로 저장한다. 설치 후 누락·손상·버전·세대 불일치는 초기화로 숨기지 않는다. 전체 초기화는 실행 작업을 취소 표시하고 새 세대의 첫 전송에서 설치한다. 이미 실행 중인 API 한 건은 반환할 때까지 남을 수 있다.
- 완료 상태는 묶어서 최신 회원·레이드에 저장한다. 묶음 중 회원 게시 번호가 바뀌면 다시 로드하고 영수증을 합쳐 공격·정산을 덮어쓰지 않는다. 게시 번호는 회원 파일의 검증 교체·롤백 때 갱신되는 메모리 값이며 디스크 데이터의 대체가 아니다. 변경 없는 운영 로그의 동일 버전 백업은 반복 복사하지 않고, 정기 2차 회전의 원본 검증 및 명시적 백업 재구성은 유지한다.
- `tools/test_server_raid_delivery.js`는 새 VM·합성 디스크 재시작, `tools/test_server_raid_io.js`는 전송 중 변경·영수증 오류·대용량 논리 I/O, `tools/test_server_raid_delivery_rhino.js`는 실제 Java 스레드·잠금에서 API 정지 중 공격/조회/자동 정산의 완료를 검증한다. 실제 Android 앱의 세션 재획득·기기 속도는 운영자 확인 영역이다. API 성공 뒤 영수증 저장 전 강제 종료는 기존과 같이 공지가 중복될 수 있다.
- 전체 초기화는 이미 지급한 포인트·일반 가방을 유지한다. 서버이동은 확정 결과·우승·기존 지급 상태를 유지한다. DEV 저장과 공지는 기존 컨텍스트로 분리한다.

## Legacy Callback / Operator Scope

- 기본 `response(room, msg, sender, isGroupChat, replier, imageDB, packageName)`만으로 시작·공격·종료할 수 있다. 확장 인수는 필수가 아니다. 레거시 지원 버전에서 9번째 `logId`, 10번째 `channelId`, 11번째 `userHash`가 제공되면 `arguments`에서 읽고 앱·방·메시지 범위의 문자열 ID를 사용한다.
- 네이티브 ID를 Number로 변환하거나 텍스트·시간 해시로 대체하지 않는다. Number로 들어온 ID도 거부한다. 신뢰된 내부 어댑터가 8번째 인수로 제공하는 `{ id: 원본 이벤트 ID 문자열, operatorId: 인증된 운영 주체 ID 문자열 }`도 지원한다.
- 원본 ID가 없는 기본 콜백의 공격은 호출마다 저장용 UUID를 생성한다. 이 UUID는 재전송 식별값이 아니다. 2026-10-06 사용자 승인에 따라 같은 알림이 다시 전달되어도 별도 시도로 처리하며, 방 이동·재시작 여부와 관계없이 계정당 정상 5회 한도를 유지한다. 한도 이후 호출은 새 초과 시도이며 두 번째부터 패널티 대상이다. 원본 ID가 제공되는 경우에는 정상 공격·초과 시도의 재전송 차단을 유지한다. 제공된 확장 ID가 손상됐거나 Number이면 시작·공격을 차단한다.
- 운영봇은 `GLOBAL_CONFIG.serverRaid.authentication.operatorIds`의 등록값과 앱·방·사용자 해시로 구성한 `operatorId`가 일치해야 한다. 초기 등록 목록은 비어 있어 MASTER만 운영 권한을 갖는다. 기본 콜백에서도 MASTER가 모든 방·일대일톡에서 시작·종료할 수 있다. 운영봇의 기존 단체방 인증 조건과 등록 ID 검사는 유지하며 닉네임 `오픈채팅봇`만으로 운영 권한을 부여하지 않는다.
- 시작·종료 이미지 공유 링크를 기존 텍스트 메시지에 넣었으며 실제 기기의 이미지 표시는 미검증이다. 운영 기기에 직접 연결하지 않는다.
- 공식 이력과 이벤트 처리 기록을 임의로 삭제하지 않는다. 장기 운영 데이터 규모와 Rhino 기기 처리 시간은 운영 전 검증 항목이다.
- 레거시 콜백 호환 수정 버전은 `ver_2.600`이며 소스 버전과 개발자노트를 함께 갱신했다. 실제 기기의 수신·표시·처리 시간 검증은 별도로 남아 있다.
- 재시작 후 조기 반환 경로의 작업 재개 보완 버전은 `ver_2.601`이다.
- 명령어방·치명타 포함 공격 보상·상금 UI·조회 명령 이름 보완 버전은 `ver_2.602`이다. 운영 기기 업로드·컴파일·실행 검증은 운영자 범위이며 Codex 작업에 포함하지 않는다.

## Validation

- `node tools/test_server_raid.js`: 실제 명령 진입·예약 작업·보호 저장 함수를 합성 데이터와 메모리 파일시스템에서 실행한다.
- 97개 검증 그룹으로 기본 7인수 시작·공격·5회 한도·저장 실패·응답 실패·재시작·중복 정산·DEV 분리를 검증한다. 실제 `response(...)` 전체 콜백의 잠금·컨텍스트 해제와 DEV 헤더·저장 실패 처리, 예약 유실 후 준비·정산 재개도 실행한다. 실제 Main/Info 레이드 계산에서 인장·홈/길드 큐브·레벨·퀘스트 합산을 대조하며, 제보 치명타 수치·이전 지급 기록·확정 상금 표시·명령 이름·방 제한도 검증한다. 기존 UI 유지·R3%·0매력 치명타·D/R 및 1%/3% 혼합 지급 기록·모든 운영방 조회·여러 회차 누적 일치·부분 정산 재시작·ALLSEE 위치를 검증한다. 실제 활성화부터 30분·기존 10/15분 유지·마감 경계·수동/자동 경합·공지/저장 실패·중복 시작·재시작·늦은 준비 안내 취소·권한 없는 타이머 미변경을 검증한다. 첫 초과 경고·2회부터 각 5천만 차감·잔액 경계·부족 시 기록만·원본 ID 재전송·닉네임 변경·다음 회차·초기화·DEV 분리·정상 누적 횟수/콤마를 검증한다.
- 남은 턴 조회 8개 그룹은 별칭·공백·접미 거부·5/3/0회·반복 무차감·전체 운영방/DEV 제한·가입/출석/정지/패스·마감 경계·회차/닉네임/소속 기간·로드 실패를 실제 7인수 콜백과 합성 파일 IO로 검증한다.
- 추가 허용 11개 그룹을 포함해 총 108개 그룹을 검증한다. 준비·진행·정산의 10종/인수 통과, 접미·숫자·별칭 거부, 기존 명령 유지, 실제 패키지 지급/사용/두 파일 저장 실패 복구, 출석/조회/권한, 탐험 정산·주기 리셋의 레이드 예약 보존과 자동 종료 상금, DEV 저장 분리, 실제 자동 탐험 콜백 차단 후 다음 허용 명령의 불필요한 탐험 실행 방지, `/포인트`·`ㅍㅍㅍ` 동일 출력·기존 자격 검사·무저장·DEV 단축어 정규화를 확인한다. 새 명령 통합 검증은 실제 진입부·자격 검사·명령 분기·저장 함수에 합성 보상/표시 의존성을 연결하며 전체 공통 전처리·기기 실행을 대신하지 않는다.
- DEV 데이터가 없는 최초 백업도 기존 권한과 생성 흐름을 유지한다.

---

# 신규 ROOM · 호이서버6 유입

Status: VERIFIED

## Files / Related Helpers

- `main.js`: `room15`, `roomToServer`, `assignUnspecifiedMemberServer`, `/모험시작`·`출발한다`, `recordLightAttendanceOnly`, `migrateLightAttendanceToMember`, `getNoticeTargetRooms`.
- 기획: `신규_ROOM_추가_호이서버6_유입고정_기획서` (`e13393bdd7aa82a4b8210159aa111931`).

## Data Usage / Save Flow

- `🚨 30대 반말방｜도파민 폭주구역 💣🔥`를 기존 호이서버6[30]으로 연결한다. 서버 수와 기존 ROOM 매핑은 유지한다.
- 신규 방의 단체 채팅에서 이미 생성된 회원의 미지정 소속만 지정한다. 짧은 채팅·미출석 상태도 유입 지정이 가능하며 기존 소속·재화·레이드 기록은 유지한다. 일반 채팅으로 미가입 계정을 생성하지 않는다.
- 신규 방에서 모험을 시작하면 기존 가입 대기 파일에 `server`를 보존한다. 다른 방에서 `출발한다`를 입력해도 가입 완료 시 그 소속을 적용한다. 대기 소속이 없으면 가입 완료 방이 신규 방일 때만 해당 유입을 적용한다.
- 회원 변경은 기존 진입 흐름에서 `filePath`에 저장하며 가입 완료는 기존 초기화·경량 출석 이관·가입 대기 제거 순서를 따른다. 헬퍼는 이미 로드한 회원 데이터만 변경하고 파일 IO가 없다. DEV는 기존 경로 컨텍스트를 사용한다.
- 신규 방을 공통 공지·대승급 공지·출첵 시작 알림 대상에 추가한다. 레이드 공격·전체 초기화 허용방은 공성전·팻 테스트방으로 유지하며 운영 시작·종료는 모든 방에서 허용한다.
- `node tools/test_room_server6_ingress.js`: 실제 가입·초기화·경량 출석 분기/함수를 합성 데이터로 실행해 7개 검증 그룹을 검증한다. 신규/기존 계정·반복 채팅·방 이동·일대일·DEV 분리·저장 실패·서버 순위 집계를 포함한다.

---

# /서버변경 · /서버순위 · 표시 감추기

Status: VERIFIED

## Files

- `main.js`: `/서버변경`, `/관리자감추기`, `/이모지감추기`
- `Info.js`: `/서버순위`

## Related Helpers

- `normalizeHoiServerLabel`, `normalizeInfoServerLabel`, `normalizeRankServerName`
- `buildServerRankingRows`, `getAuthorityTitleBadge`, `getVisibleRankEmoji`

## Data Usage / Save Flow

- 서버이동권 판매가는 `data.shop[GLOBAL_CONFIG.serverTransfer.itemName]`에 저장된 값을 사용한다. `/상점추가`로 등록·가격 수정하며, 일반 입력이나 재시작에서 고정 금액으로 덮어쓰거나 자동 등록하지 않는다. `/서버변경`의 부족 안내도 실제 저장 가격을 표시한다.
- 서버 변경은 대상 계정의 `server`와 이동권 1개를 함께 변경하고 `filePath`에 저장한다. 안내·실패·같은 서버 요청은 변경하지 않는다.
- `/서버변경`과 관리자 `/서버이동`의 실제 소속 변경은 `applyServerRaidMembershipChange`를 통해 개인 레이드 조회 기록을 지우고 소속 기간을 증가시킨다. 실패 시 소속·이동권·레이드 조회 기록을 함께 유지하며 완료 응답 전에 저장한다.
- 관리자·순위 이모지 표시 설정은 계정의 `displaySettings`에 별개로 저장하며 실제 관리자 권한과 순위 수치는 유지한다.
- `/서버순위`는 조회 전용이며 소속 서버의 전체 회원 매력을 합산한다.
- `/서버순위`와 `/종합순위`·`ㅈㅈㅈ`의 통합 서버 화면은 소속 서버 요약 아래 개인 TOP 10과 전체 서버 합산 순위를 더보기 안에 표시한다. `/종합순위`·`ㅈㅈㅈ`는 이 화면 뒤 월드 개인 순위를 출력한다. 기존 종합매력 공식·정렬은 유지하고 출력 단계에서만 레이드 누적 우승 `⭐N`을 붙인다.
- `/서버이동`, `/서버변경`, 신규 소속 매핑과 순위 집계는 서버6을 `호이서버6[30]`으로 통일한다. 기존 `[2030]` 소속값도 서버6으로 합산한다.
- 개인 정보와 길드 화면의 서버명도 최신 표기로 출력하며 기존 저장 데이터는 조회만으로 변경하지 않는다.
- `/서버변경`은 기존 이동권으로 호이서버1~7과 `호이월드 커뮤니티`를 선택한다. 관리자 `/서버이동`도 커뮤니티를 허용하며 채팅방 입장만으로 기존 소속을 변경하지 않는다.
- `/이모지감추기`의 `hideRankEmoji` 설정이 켜져 있으면 `getVisibleRankEmoji`와 `getMemberRankEmojiForDisplay`가 `getTierEmojiForMember`로 현재 티어 이모지를 표시한다. 꺼지면 특별 순위 표시를 복원한다.

---

# /미니펫전체정리
Status: VERIFIED
## Command Anchors
- Search in main.js: `/미니펫전체정리`
## Files
- `main.js`
## Related Helpers
- `refreshMiniPetSortIndex`
- `checkRank`
## Data Usage
- all users `petData[*].miniPetBag`
## Save Flow
- Admin bulk cleanup mutates many mini-pet bags and saves `petData`
## Related Commands
- `/미니펫가방정리`

---

# /미니펫판매 [번호]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/미니펫판매`
## Files
- `main.js`
## Related Helpers
- `checkRank`
## Data Usage
- `petData[sender].miniPetBag`
- `data.member[sender].point`
## Save Flow
- Removes selected mini-pet, adds points, saves member data and `petData`
## Related Commands
- `/미니펫가방`
- `/미니펫가방정리`
- `/미니펫지정판매`

---

# /미니펫지정판매 [시작]~[끝]
Status: VERIFIED
## Command Anchors
- Search in `main.js`: `/미니펫지정판매`
## Files
- `main.js`
## Related Helpers
- `checkRank`
- `addPoint`
- `refreshMiniPetSortIndex`
## Data Usage
- `petData[sender].miniPetBag`
- `data.member[sender].point`
## Save Flow
- Removes mini-pets whose `sortIndex` is within the inclusive range
- Adds the summed sale price to member points
- Saves member data and `petData`
## Related Commands
- `/미니펫가방`
- `/미니펫판매`
- `/타이틀지정판매`
## AI Notes
- Accepted as `/미니펫지정판매 [start]~[end]`; suffix guide text must not execute.
- Uses the same default mini-pet sale price fallback as `/미니펫판매`.

---

# /귀속해제
Status: VERIFIED
## Command Anchors
- Search in main.js: `/귀속해제`
## Files
- `main.js`
## Related Helpers
- `hasItem`
- `removeItem`
## Data Usage
- `petData[sender].miniPet`
- `petData[sender].miniPetBag`
- sender bag unbind-ticket item
## Save Flow
- Mutates mini-pet equipped/bag state and member bag state; re-check surrounding persistence when editing
## Related Commands
- `/미니펫장착`
- `/미니펫가방`

---

# /미니펫컬렉션등록 [번호...]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/미니펫컬렉션등록`
## Files
- `main.js`
## Related Helpers
- `sanitizeMiniPetCollectionData`
- collection registration helpers in nearby branch
- `getMiniPetCollectionAutoUpgradePlan`
- `tryAutoUpgradeMiniPetForCollection`
## Data Usage
- `petData[sender].miniPetBag`
- `miniPetCollectionData.member[sender]`
- `miniPetTitleData`
## Save Flow
- Registers selected mini-pets, mutates collection/title/member/pet data, saves all touched stores
## Related Commands
- `/미니펫컬렉션만능`
- `/미니펫컬렉션순위`

## AI Notes
- Collection registration auto-upgrade uses `MINI_PROB`, `MINI_COST`, and `getCharmGainFor`; these tables now support 1~300강
- Auto-upgrade guard allows enough attempts for 300강 low-probability ranges before stopping as abnormal
- 미니펫 컬렉션 시즌1은 +80💫 단계까지 등록할 수 있다. `/미니펫컬렉션` 현황 최상단에는 `[시즌 1 종료 80단계까지 등록 가능]`을 표시하고, 80단계 완료 후 일반 등록·만능열쇠 등록을 차단하며 완료 결과에 `시즌1 종료 / 시즌2에서 뵐게요` 안내를 표시한다.

---

# /미니펫컬렉션|/미니펫컬렉션만능 [미니펫컬렉션번호] ...
Status: VERIFIED
## Command Anchors
- Search in main.js: `/미니펫컬렉션`, `/미니펫컬렉션만능`
## Files
- `main.js`
## Related Helpers
- `sanitizeMiniPetCollectionData`
- `ensureMiniPetCollection`
- `getMiniPetCollectionAutoUpgradePlan`
- `tryAutoUpgradeMiniPetForCollection`
## Data Usage
- `miniPetCollectionData.member[sender]`
- `miniPetCollectionInfo.stageReward`
- `petData[sender].miniPetBag`
- `data.member[sender].bag["미니펫컬렉션 만능 열쇠🗝️(/미니펫컬렉션만능 번호)"]`
## Save Flow
- 인자 없는 명령은 현황을 조회하며 필요하면 컬렉션 데이터를 정리해 저장한다.
- `/미니펫컬렉션만능 [번호] ...`는 일반 미니펫 보유 여부와 관계없이 만능 열쇠만 선택하며, 한 번에 최대 10개를 `등록` 확인 상태로 만든다.
- 입력 순서로 현재 단계 완성 여부를 미리 계산하므로 한 명령에서 다음 단계 컬렉션까지 연속 선택할 수 있다.
- 현황 UI는 단계 보상 다음에 만능열쇠 등록 `/미니펫컬렉션만능`과 등급 등록 `/미니펫컬렉션등록`을 안내한 뒤 상세 컬렉션을 표시한다.
- `등록` 성공 시 기존 컬렉션·타이틀·회원·미니펫 저장 흐름을 재사용한다.
- 한 명령에서 80단계를 완료한 뒤 81단계 재료까지 이어서 소비하지 않으며, 80단계 이후에는 등록 재료와 만능열쇠를 차감하지 않는다.
## Related Commands
- `/미니펫컬렉션등록`
- `/미니펫컬렉션순위`

---

# /소식 및 소식 관리 명령

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `processWorldNewsCommand`
- User command: `/소식`
- Admin/Master commands: `/소식작성`, `/소식관리`, `/소식픽 [번호] [번호] [번호]`, `/소식픽해제`, `/소식수정 [번호]`, `/소식삭제 [번호]`, `/소식등록`, `/소식취소`

## Files

- `main.js`

## Related Helpers

- `ensureWorldNewsData`
- `sanitizeWorldNewsPickIds`
- `getWorldNewsValidPickIds`
- `formatWorldNewsPickStatus`
- `selectWorldNewsFeaturedPost`
- `buildWorldNewsPickGuide`
- `drawWorldNewsReward`
- `markWorldNewsPostsRead`
- `buildWorldNewsUserMessage`
- `buildWorldNewsJackpotBroadcast`
- `buildWorldNewsManageMessage`
- `processWorldNewsCommand`
- `noticeMsg`
- `checkRank`

## Data Usage

- `data.worldNews.posts`
- `data.worldNews.nextId`
- `data.worldNews.pickIds`
- `data.member[sender].worldNewsLotteryPlayed`
- `data.member[sender].worldNewsLastReadId`
- `data.member[sender].point`
- `worldNewsDraftState` (작성·수정 중인 5분 임시 상태만 메모리 보관)

## Save Flow

- `/소식`은 설정된 유효 픽 중 1개를 균등하게 선택하고, 픽이 없으면 최신 글을 표시한다. 현재 가장 큰 글번호를 마지막 확인 번호로 기록하며 복권 첫 참여 시 포인트와 참여 완료 상태도 함께 변경해 `member.json`을 한 번 저장한다.
- `/리셋`은 전 유저의 소식복권 참여 완료 상태를 다른 일일 횟수와 함께 제거한다.
- 게시글 등록·수정·삭제와 소식픽 설정·해제는 소식 저장 구조를 변경하고 `member.json`을 한 번 저장한다.
- 제목·내용·링크 입력과 미리보기 단계는 영구 데이터를 변경하지 않는다.
- 10억 당첨 전체알림은 포인트와 참여 날짜 저장 성공 뒤에만 전송한다.

## Notes

- 복권은 계정당 `/리셋` 주기마다 1회이며 1,000만 50%, 5,000만 30%, 1억 15%, 5억 4%, 10억 1%로 꽝 없이 지급한다. 자정이 지나도 `/리셋` 전에는 다시 참여할 수 없다.
- 설정된 소식픽이 있으면 그중 1개를 한 번 선택해 기본 화면에 표시하고, 나머지 글은 선택된 글만 제외해 `allsee` 뒤에 최신순으로 표시한다. 픽이 없으면 최신 글을 기본 화면에 표시한다.
- 최신 글의 안내 링크와 `최근 등록된 소식` 사이에 구분선을 표시한다.
- `최근 등록된 소식`은 현재 보관 중인 전체 글 수를 표시한다.
- 소식 수정은 기존 글번호·작성일·노출 순서를 유지하며, 마지막 확인 번호는 일일 `/리셋` 대상이 아니다.
- 게시글은 최대 100개를 보관하며 101번째 등록부터 가장 오래된 글을 제거한다. 삭제·자동 제거된 글번호는 소식픽에서도 제외하며 삭제된 글번호는 재사용하지 않는다.
- `/소식픽`은 서로 다른 기존 글번호 3개로 기존 설정 전체를 교체하고, `/소식픽해제`는 픽을 비워 최신 글 표시로 돌아간다.
- 수정은 글번호·최초 작성일·작성자 수식어·노출 순서를 유지한다.
- 관리자 작성 상태는 관리자 계정과 채팅방 조합별로 분리하며 5분 미입력 시 폐기한다.

---

# /미니펫컬렉션초기화 [아이디]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/미니펫컬렉션초기화`

## Files

- `main.js`

## Related Helpers

- `isMaster`
- `getMiniPetCollectionData`

## Data Usage

- `miniPet_collection.json -> member[아이디].collection`
- `userState[아이디].miniPetCollection`

## Save Flow

- MASTER가 지정한 가입 유저의 컬렉션 진행 상태만 삭제한 뒤 `miniPet_collection.json`을 한 번 저장한다.
- 기존 지급 보상·미니펫 타이틀·소비된 미니펫은 변경하지 않는다.

## Related Commands

- `/미니펫컬렉션`
- `/미니펫컬렉션등록`
- `/미니펫컬렉션만능`

---

# /미니펫컬렉션순위
Status: VERIFIED
## Command Anchors
- Search in main.js: `/미니펫컬렉션순위`
## Files
- `main.js`

## Related Helpers
- `sanitizeMiniPetCollectionData`
- `buildMiniPetCollectionRankingMessage`
## Data Usage
- `miniPetCollectionData.member`
## Save Flow
- Primarily read-only; may sanitize then save collection data
## Related Commands
- `/미니펫컬렉션`

---

# /자랑
Status: VERIFIED
## Command Anchors
- Search in main.js: `/자랑`
## Files
- `main.js`
## Related Helpers
- `hasPetSkill`
- `checkRank`
## Data Usage
- equipped pet-skill state for `롤렉스`
## Save Flow
- Read-only
## Related Commands
- `/펫스킬`

---

# /알림 [내용]
Status: VERIFIED
## Command Anchors
- Search in main.js: `/알림`
## Files
- `main.js`
## Related Helpers
- `checkRank`
- `hasItem`
- `removeItem`
- `isHoiPassPremiumActive`
- `getHoiPassPremiumHeader`
- `noticeMsg`
## Data Usage
- `guildData.territoryWar.active`
- `data.member[sender].noticePremiumCount`
- `data.member[sender].noticeItemCount`
- `data.member[sender].bag["확성기📢(/알림 내용 30자)"]`
## Save Flow
- 호이패스 프리미엄 이용자가 최대 40글자의 알림을 전체방에 전송한 뒤 무료 횟수 또는 확성기 아이템 사용 횟수를 반영하고 `member.json`을 저장한다.
## AI Notes
- 일반 `/알림`의 전체방 전송은 디버깅모드 여부와 무관하며, DEV 컨텍스트 공지는 기존 테스트방 격리를 유지한다.
## Related Commands
- `/길드영지시작`
- `/길드영지종료`
- `/영지공격`
## AI Notes
- 호이패스 프리미엄 이용자는 하루 3회까지 아이템 없이 사용하고 이후에는 기존 확성기 아이템 흐름을 사용한다. 일반 이용자는 명령 실행 전 프리미엄 전용 안내를 받는다.
- 무료 횟수는 메시지가 정상 전송된 뒤 증가하며 일일 초기화에서 삭제된다. 재가입해도 같은 날 사용 기록은 유지한다.

---

# /포인트
Status: VERIFIED
## Command Anchors
- Search in Info.js: `/포인트`
- Alias: `ㅍㅍㅍ`
## Files
- `Info.js`
## Related Helpers
- `checkRank`
- `numberWithCommas`
- `hasInfoPrivateChatPass`
- `getInfoUnreadPetHomeAlertCount`
## Data Usage
- `data.member[sender].point`
- `data.member[sender].diamond`
- `petHomeActivityData.alerts[sender][].read`
## Save Flow
- Read-only
## Related Commands
- `/레벨`
- `/포인트확인`
## AI Notes
- `/포인트` and `ㅍㅍㅍ` show held 다이아 from the same `data.member[sender].diamond` field used by `/내정보`; active hoi/newbie pass users additionally see the unread home-alert count only when it is greater than zero, without marking alerts as read.
- `/포인트`·`ㅍㅍㅍ` 모두 서버 레이드대전 준비·진행·정산 중 허용되며 기존 출석·정지·일대일 패스 조건을 검사한다. DEV `dev/포인트`·`dev/ㅍㅍㅍ`는 같은 DEV 회원 데이터로 조회한다.

---

# /구매 [번호] [개수]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/구매`

## Files

- `main.js`

## Related Helpers

- `hasPetSkill`
- `buildPetSkillMsg`
- `buildPointShopBuyMessage`
- `applyTax`
- `buildPointShopPurchaseQuote`
- `isPointShopSafeAmount`
- `isPointShopSafeCount`
- `isPointShopTaxSettlementSafe`
- `buildTicketEventCouponPurchasePlan`
- `consumeTicketEventCouponPlan`
- `buildTicketEventCouponUsageMessage`

## Data Usage

- `data.shop`
- `data.HoiCastle.taxRate`
- `data.member[sender].point`
- `data.member[sender].bag`
- `data.member[sender].diamondBoxBuyCount`
- `petSkillData`
- `data.member[sender].bag["티켓이벤트할인쿠폰🎟️(10~50%)"]`

## Save Flow

- Deducts point-shop cost from member points
- Applies castle tax earnings through `applyTax(itemPrice, data, guildData)` when tax is not exempt
- `applyTax` also adds the non-guild tax share to `data.hoiHappyFoundation.totalAmount`
- Saves updated member state through `saveJsonFile(data, filePath)` after successful purchase
- Saves updated pet state through `saveJsonFile(petData, memberPetPath)` after successful purchase
- 구매·쿠폰·보너스·펫 외형/성격 변경 완료 메시지는 길드·회원·펫 저장이 끝난 뒤 출력한다. 저장 실패 시 기존 명령 트랜잭션이 세금·차감·쿠폰·지급을 되돌린다.
- 티켓 이름을 포함한 상품은 구매 수량만큼 보유 쿠폰을 높은 할인율부터 티켓 1개당 1장씩 적용하고, 구매가 성공한 뒤 할인율별 적용 수량을 차감한다. 보유 쿠폰이 부족하면 보유 수량까지만 할인하며 실패·취소된 구매에는 쿠폰을 차감하지 않는다.
- `applyTax(itemPrice, data, guildData)` saves changed guild state through `saveJsonFile(guildData, guildPath)` when tax is not exempt

## Related Commands

- `/상점`
- `/길드상점`
- `/길드상점구매`

## AI Notes

- `쇼핑광📙`은 20%, `VIP블랙카드📙`는 30%를 할인하며 두 스킬은 호환 그룹으로 중복 장착할 수 없다. 기존 비정상 데이터에 둘 다 있으면 VIP 할인만 적용한다.
- 티켓이벤트 쿠폰 할인은 티켓별로 높은 할인율부터 적용한 뒤 펫스킬 할인을 적용하고, 두 할인 뒤의 상품가를 기준으로 세금을 계산한다.
- 펫스킬 할인 안내는 구매와 데이터 저장이 성공한 뒤에만 출력한다.
- `탈세자📙` reduces tax by 70% only in the point-shop `/상점` → `/구매` flow, so the user pays 30% of the original tax.
- `티어 상승론📙` adds `floor(quantity * 0.01)` bonus only when the point-shop `/구매` item is `티어 승급티켓🎟`.
- Command guard accepts only `/구매` or `/구매 숫자 [숫자]`; suffix guide text does not enter purchase logic.
- 구매 수량은 생략 시 1개, 명시 입력은 1~9,999개만 허용한다. 관리자도 같은 1회 제한을 적용하며, 0개나 큰 정수/Infinity로 변환되는 입력에는 차감·지급하지 않는다.
- 입력 문자열은 진입에서 `Number`로 한 번 변환한다. 이후 견적·쿠폰·티어 보너스에서는 숫자를 `parseInt`로 재해석하지 않는다.
- 상품가·결제액·보유 포인트·지급 후 수량·사용할 쿠폰·일일 구매 기록·세금 적립 결과의 유한성과 안전 범위를 검사한다. 숫자가 아닌 보유값을 자동 초기화하거나 바꾸지 않는다.
- 0원 상품은 기존 정책을 유지한다. 기존 스킬 할인율·쿠폰 적용 순서·세금 반올림은 유지하며, 백분율 계산 순서를 조정해 불필요한 소수 오차를 줄인다.
- `/티어`의 총 필요 수량 견적은 9,999개보다 커도 유지하고 1회 한도에 맞춰 나눠 구매하도록 안내한다. `/상점`은 `Info.js`에서 같은 한도를 표시한다.
- 검증: `node tools/test_point_shop_purchase.js` (실제 명령·견적·세금·저장·트랜잭션 함수, 합성 파일시스템).
- Buying a point-shop item whose name contains both `다이아` and `상자` is limited to `GLOBAL_CONFIG.pointShop.limits.diamondBoxDailyBuy` per day before cost/tax processing.

---

# /타이틀목록

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/타이틀목록`
- Search in `Info.js`: `/타이틀목록` target-user admin path

## Files

- `Info.js`

## Related Helpers

- `checkRank`
- `isAdmin`

## Data Usage

- `titleData.member[sender].title.list`
- `titleData.member[sender].title.num`
- `titleData.member[targetUser].title.list`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/정보 [닉네임]`
- `/펫타이틀목록`

## AI Notes

- Primary member-title inventory viewer
- Admin path can inspect another user's title list without impersonating sender

---

# /펫타이틀목록

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/펫타이틀목록`
- Search in `Info.js`: `/펫타이틀목록` target-user admin path

## Files

- `Info.js`

## Related Helpers

- `checkRank`
- `isAdmin`

## Data Usage

- `petTitleData.member[sender].title.list`
- `petTitleData.member[sender].title.num`
- `petTitleData.member[targetUser].title.list`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/펫상태`
- `/타이틀목록`

## AI Notes

- Pet-title inventory viewer parallel to `/타이틀목록`
- Useful when checking title-equip state mismatches between pet profile output and title storage

---

# /출석목록

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/출석목록`

## Files

- `Info.js`

## Related Helpers

- local attendance row formatter in `/출석목록`

## Data Usage

- `data.attend_list`
- `data.member[user].rank.emoji` when the member/rank data exists

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`

## AI Notes

- Simple attendance snapshot output
- Missing member/rank data falls back to a blank rank emoji so stale attendance rows do not crash the command
- Good first anchor when debugging daily attendance ordering or missing users

---

# /상점

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/상점`

## Files

- `Info.js`

## Related Helpers

- `numberWithCommas`
- `getMyGuildInfo`

## Data Usage

- `data.shop`
- `data.HoiCastle.taxRate`
- `data.HoiCastle.lord`
- `guildData.guilds`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/구매 [번호] [개수]`
- `/길드상점`

## AI Notes

- Canonical read path for point-shop item list and visible tax text
- If shop tax or lord-guild display looks wrong, inspect this branch before `/구매`

---

# /펫강순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/펫강순위`

## Files

- `Info.js`

## Related Helpers

- `generatePetUpgradeRanking`

## Data Usage

- `petData`
- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/펫매력순위`

## AI Notes

- Ranking output focused on pet upgrade values
- Best first anchor when upgrade-based ordering and displayed ranking diverge

---

# /누좋순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/누좋순위`

## Files

- `Info.js`

## Related Helpers

- `generatelike2Ranking`

## Data Usage

- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/종합순위`

## AI Notes

- Legacy cumulative-like ranking output
- Good quick anchor for total-like counter sorting bugs

---

# /누렙순위

Status: VERIFIED

## Command Anchors

- 레벨 리뉴얼로 제거됨

## Files

- `Info.js`

## AI Notes

- 환생과 누적 레벨 체계 폐기에 따라 `/누렙순위`와 `generate2Ranking`을 제거했다.

---

# /영주수익순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/영주수익순위`

## Files

- `Info.js`

## Related Helpers

- `generateEarningsRanking`

## Data Usage

- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/종합순위`
- `/길드정보`

## AI Notes

- Ranking output for stored lord-earnings totals
- Good first anchor if castle/lord income leaderboard and member summaries disagree

---

# /정령컨텐츠보상 · /레이드매력오픈 숫자 · /캐슬매력오픈 숫자

Status: VERIFIED

## Files

- `main.js`, `Info.js`
- `data/itemInfo.json`: 보상 산정용 기존 정령 등급별 기본 매력·강화 증가량 (보존)
- `data/itemList.json`, `data/packageInfo.json`: 강화확률뽑기 목록·패키지 지급 제거, 보상 매력 아이템 판매 보호

## Related Helpers

- `buildSpiritRetirementPlan`, `applySpiritRetirementPlan`
- `countSpiritRetirementSources`, `buildSpiritRetirementCleanupPlan`, `buildServerRaidAccountIndex`
- `getSpiritCharmOpenRequest`, `openSpiritCharmItem`
- `getSpiritOpenedCharm`, `requireSpiritRetirementCount`
- `calculateItemInfoAll`, `calculateItemInfo`, `isNeverSellItemWithList`

## Data Usage

- `GLOBAL_CONFIG.spiritRetirement`: 공식 아이템명, 일회성 보상 기록·백업명, 이벤트박스 치킨 100개·야구 치킨 2개
- `petData[사용자].elemental`: 보상 확정 후 기록·백업·현재 계정과 일치하는 원본만 삭제. 실전 매력 계산·정보창·순위·신규 지급에서 제외
- `data.member[사용자].bag`: 매력 1당 해당 보상 아이템 1개. 지급 자체로 매력 증가 없음
- `data.member[사용자].spiritCharm`: 오픈한 캐슬·레이드 매력. 기존 퍼센트 보너스 적용 전 합산
- `data.spiritRetirement20261023`: 전체 보상 완료와 대상별 등급·강화·보상량 기록

## Save Flow

- MASTER가 정확히 `/정령컨텐츠보상` 입력: 기존 방·정지·레이드 제한 통과 후 전체 회원과 펫 원본을 `spirit_retirement_before_20261023_<UUID>.json`으로 안전 저장·재읽기 대조한다. 재시도마다 새 백업을 만들고 완료 기록에 경로를 남긴다.
- 전체 대상의 등급·강화·안전 정수 수량을 먼저 확인하고, 가방 지급·강화확률뽑기 전량 삭제·전체 완료 기록을 한 번의 `saveJsonFile(data, filePath)`로 확정한다. 실패 시 기존 저장 트랜잭션으로 복구하며, 재시작 후 완료 기록이 있으면 재지급하지 않는다.
- 지급 저장을 먼저 확정하고 별도 저장 단위로 정령 원본만 `saveJsonFile(spiritPets, memberPetPath)`에서 삭제한다. 삭제 실패·중단 후 재실행은 정리만 수행하며, 이미 지급된 가방·오픈 매력·완료 기록은 바꾸지 않는다. 완료 응답 실패도 확정 저장을 취소하지 않는다.
- 기지급자는 기록의 현재 환경 백업을 재읽고 상세 지급량을 원본과 대조한다. 기존 계정 ID로 닉변을 확인하거나 ID가 없으면 동일 이름·원본 일치를 확인한 경우만 삭제한다. 계정 불일치·변경 원본·미지급 원본은 보존하고 남은 건수를 안내한다. 백업이나 기록이 잘못되면 삭제 없이 기존 오류 흐름을 따른다.
- 전체 정리 후 반복 실행은 백업·회원·펫 무저장이며, 보상 전 백업과 재지급 방지 기록은 유지한다. 분리 회원 저장의 레이드·운영 로그 슬롯도 유지한다.
- 두 매력 오픈 명령은 정확한 양의 정수 수량만 사용한다. 보유량 초과·0·음수·소수·문자·추가 안내 문구는 아이템을 사용하지 않는다. 소모량과 영구 매력은 같은 회원 저장 단위다.
- 세 명령은 기존 단독 실행 잠금을 사용하며 DEV 컨텍스트의 백업·회원·펫 저장은 DEV 경로로 분리한다.
- `/정령강화`, `/정령이름`, `/정령순위`, `/강화뽑기`, `/정령조합`, `/정령이름조합`, `/정령속성`, `/정령정보`, `/전체조합2`, `/정령패키지,` 실행 분기는 제거했다.
- `ㅇㅇㅇ`·`/전체조합`의 정령 조각 조합만 종료하며 다른 오픈·판매 처리는 유지한다. 기존 정령상자·정령박스는 치킨을 지급한다. 복주머니의 지급 수량은 유지하고, 야구는 1개당 치킨 2개를 지급한다.
- 이벤트박스는 현행 샵오픈·던전 입장권을 유지하면서 치킨 100개를 함께 지급한다. 호이패스·프리미엄·패키지의 강화확률뽑기 지급과 안내는 제거하며, 과거 패키지 구성에도 지급/안내 필터를 적용한다.
- 정령조각·이름변경권·강화석의 기존 재고 판매와 보상 아이템 거래 제한은 운영자 별도 처리이며 자동 판매/포인트 지급을 추가하지 않는다.

---

# /반지순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/반지순위`

## Files

- `Info.js`

## Related Helpers

- `generateRingRanking` remains in source for legacy reference but is no longer called by the command branch.

## Data Usage

- `petData`
- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/종합순위`

## AI Notes

- Command now replies that ring ranking has ended for the pendant transition.
- Legacy ring enhancement exp is converted to `반지매력보상🎁(/보상받기)` through `/반지보상받기`; do not re-enable ring ranking for migrated users.

---

# /반지보상받기

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/반지보상받기`

## Files

- `main.js`

## Related Helpers

- `calculateItemInfo`
- `addItem`
- `saveJsonFile`

## Data Usage

- `petData[sender].ring`
- `petData[sender].ringRewardMigration`
- `data.member[sender].bag`

## Save Flow

- Calculates legacy ring reward as `ring raidExp + ring castleExp`.
- Adds `반지매력보상🎁(/보상받기)` to the member bag.
- Deletes `petData[sender].ring` and records one-time migration metadata in `petData[sender].ringRewardMigration`.
- Saves both member data and `petData`.
- Starter pet creation no longer creates `petData[user].ring`; existing rings remain only for reward migration.

## Related Commands

- `/보상받기`
- `/펫정보`
- `/반지강화`

---

# /반지보상통계

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/반지보상통계`

## Files

- `main.js`

## Related Helpers

- `calculateItemInfo`
- `numberWithCommas`

## Data Usage

- `petData[*].ring`
- `petData[*].ringRewardMigration`
- `data.member[*].bag["반지매력보상🎁(/보상받기)"]`

## Save Flow

- Admin/Master-only exact command.
- Read-only statistics command; no save calls.
- Counts claimed users by `ringRewardMigration.claimed === true`.
- Counts pending users by remaining `petData[user].ring` without a claimed migration flag.

## Related Commands

- `/반지보상받기`
- `/보상받기`

---

# /보상받기

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/보상받기`

## Files

- `main.js`

## Related Helpers

- `removeItem`
- `saveJsonFile`

## Data Usage

- `data.member[sender].bag`
- `petData[sender].petexp`

## Save Flow

- Consumes `반지매력보상🎁(/보상받기)` and increases `petData[sender].petexp` by the consumed count.
- Uses 1 item by default when no count is provided.
- Saves both member data and `petData`.

## Related Commands

- `/반지보상받기`
- `/펫정보`

---

# /티어확인

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/티어확인`

## Files

- `Info.js`

## Data Usage

- `data.member[*].rank.tier`
- `ticketTierData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/티어순위`
- `/내정보`

## AI Notes

- Bucketed view of current member tier distribution
- Best first anchor when tier assignment looks present in data but wrong in grouped output

---

# /펫매력순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/펫매력순위`

## Files

- `Info.js`

## Related Helpers

- `generatePetRanking`

## Data Usage

- `petData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/펫강순위`
- `/캐슬매력순위`

## AI Notes

- Pure pet-charm leaderboard
- Good anchor when pet-only charm should be isolated from castle/raid/home bonuses

---

# /캐슬매력순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/캐슬매력순위`

## Files

- `Info.js`

## Related Helpers

- `loadJsonFile`
- `initSweetHomeUser`
- `generateCastleRanking`
- `calculateCastleExp`
- `getGuildContributionCubeMemberPercent`

## Data Usage

- `petData`
- `data.member`
- `homeData`
- `guildData.guilds[*].cubeOptions.castle`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬전적`
- `/레이드매력순위`
- `/펫매력순위`

## AI Notes

- Castle-focused charm leaderboard that depends on loaded home data
- `generateCastleRanking`은 명령 흐름에서 로드된 `petSkillData`를 받아 `calculateCastleExp`로 각 유저의 최종 매력을 한 번 계산한다. 펫스킬·홈뱃지·길드 큐브·레벨·퀘스트 보너스가 반영된 같은 값으로 정렬과 표시를 처리한다.
- Re-check `initSweetHomeUser` when home normalization affects ranking totals

---

# /레이드매력순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/레이드매력순위`

## Files

- `Info.js`

## Related Helpers

- `loadJsonFile`
- `initSweetHomeUser`
- `generateRaidRanking`
- `calculateRaidExp`
- `getGuildContributionCubeMemberPercent`

## Data Usage

- `petData`
- `data.member`
- `homeData`
- `guildData.guilds[*].cubeOptions.raid`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬매력순위`
- `/펫매력순위`
- `/종합순위`

## AI Notes

- Raid-focused charm leaderboard parallel to `/캐슬매력순위`
- `generateRaidRanking`은 명령 흐름에서 로드된 `petSkillData`를 받아 `calculateRaidExp`로 각 유저의 최종 매력을 한 번 계산한다. 펫스킬·홈뱃지·길드 큐브·레벨·퀘스트 보너스가 반영된 같은 값으로 정렬과 표시를 처리한다.
- Good anchor when raid total calculations diverge from displayed pet/home state

---

# /가구통계

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/가구통계`

## Files

- `Info.js`

## Related Helpers

- `loadJsonFile`
- `numberWithCommas`

## Data Usage

- `homeData[*].furnitureBag[*].grade`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/가구가방`
- `/가구순위`
- `/가구정보 [닉네임]`

## AI Notes

- Aggregate furniture-grade distribution viewer across all users
- Best first anchor for furniture-grade count mismatches before per-user bag inspection

---

# /서버통계 · /서버확인 [서버명]

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/서버통계`
- Search in `Info.js`: `/서버확인`

## Files

- `Info.js`

## Related Helpers

- `getServerMemberGroups`
- `buildServerMemberListMessage`
- `numberWithCommas`

## Data Usage

- `data.member[*].server`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/종합순위`

## AI Notes

- Aggregates server-name distribution from member profiles
- Missing or blank `member.server` values are folded into unknown counts
- 두 명령은 `getServerMemberGroups`에서 동일하게 집계한다. 서버6의 과거 `[2030]` 값은 `[30]`으로 묶고, 그 밖의 원래 소속값은 유지한다. `/서버확인`은 서버6의 과거 표기로 조회해도 최신 `[30]` 명단을 반환한다.
- `/서버확인`은 현재 Admin/Master 명단을 갱신한 뒤 기존 채팅방별 권한을 판정하며, 기존 출석·게임·1:1 제한을 따른다. 입력은 전체 서버명을 사용한다.
- 제목 바로 뒤에 `allsee`를 넣고 해당 서버의 전체 닉네임을 가나다순으로 번호를 붙여 표시한다. 미가입 출첵 이용자는 포함하지 않는다.
- 인자 없음·잘못된 서버·등록 유저 없는 서버는 안내만 출력하며 데이터를 저장하지 않는다. 커뮤니티를 포함한 현재 10개 서버, 과거 표기·운영 서버와 실제 회원 소속에 저장된 서버명을 조회할 수 있다.

---

# /캐슬전적

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/캐슬전적`

## Files

- `Info.js`

## Related Helpers

- `checkRank`
- `numberWithCommas`
- `calculateCastleItem`
- `calculateItemInfoAll`
- `getGuildContributionCubeMemberPercent`
- `getCastleBattleRank`
- `getCastleBattleRankEmoji`

## Data Usage

- `data.member[sender].battle.win`
- `data.member[sender].battle.lose`
- `data.member[sender].battle.score`
- `petData[sender].miniPet.castleExp`
- `castleBattleData`
- `guildData.guilds[*].cubeOptions.castle`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬대전순위`
- `/캐슬매력순위`

## AI Notes

- Primary self-profile for castle battle record and CP display
- Good first anchor when win-rate, castle rank emoji, or CP totals look inconsistent
- The displayed castle charm adds the current valid guild's cube percentage to the existing record-display base value.

---

# /캐슬대전순위

Status: VERIFIED

## Command Anchors

- Search in `Info.js`: `/캐슬대전순위`

## Files

- `Info.js`

## Related Helpers

- `sortCastleBattle`
- `getCastleBattleRankEmoji`
- `getRankEmoji`
- `checkRank`

## Data Usage

- `data.member[*].battle.score`
- `castleBattleData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬전적`
- `/캐슬매력순위`

## AI Notes

- Ranking view for castle battle CP standings
- Open `sortCastleBattle` first when order or top-rank badge output is wrong

---

# /이체

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `parseSafePointAmount`
- `isSafePointValue`
- `calculateTransferFee`
- `ensureHappyFoundationData`
- `addPoint`
- `addHappyFoundationFee`

## Data Usage

- `data.member[sender].point`
- `data.member[targetUser].point`
- `data.hoiHappyFoundation.feeRate`
- `data.hoiHappyFoundation.totalAmount`
- `data.hoiHappyFoundation.captain`

## Save Flow

- On successful transfer, subtracts transfer amount plus the configured fee from sender and adds transfer amount to target; `호이행복재단 회원권` still applies its existing half-fee benefit, and collected fees are added to the happy foundation ledger/captain before saving `member.json`
- Reloads `member.json` immediately after save and verifies sender/target point values

## Related Commands

- `/이체수수료변경`
- `/호이행복재단`

## AI Notes

- Exact/full-pattern command guard: `/이체 [유저] [숫자]`
- The sender must be tier `킹` or higher before any point mutation; the recipient can receive points regardless of tier.
- Amount input is rejected when the transfer amount, fee, or total required point exceeds the safe range used for point arithmetic; existing held balances are not used as a separate safe-range blocker
- Fee calculation must never use `total - amount` as the primary fee value; oversized or negative fee/total values must be rejected before mutating points

---

# /상점추가 [물건] [가격]

Status: VERIFIED

## Files / Helpers

- `main.js`: MASTER 전용 상품 등록·가격 수정. 정확한 명령 형식과 0 이상 안전 정수 가격만 허용한다. 회원 파일 저장 후 성공 응답을 보내며 저장 실패는 기존 트랜잭션으로 복구한다. 실행 명령은 쓰기 잠금으로 직렬 처리한다.
- 일반 진입점에서 서버이동권을 고정 가격으로 덮어쓰거나 자동 등록하지 않는다. 기존 저장 가격·삭제 상태를 유지하며 `/상점추가`에서만 상품을 등록하거나 가격을 수정한다.
- `/상점`과 `/구매`는 실제 `data.shop` 가격을 사용한다. `/서버변경`의 이동권 부족 안내도 같은 가격을 표시한다. 세금·할인·쿠폰·1회 9,999개 제한은 유지한다.
- 관련 기획: `서버이동권_가격변경_기획서` (`704393bdd7aa8277bc00013cc569550a`). 사용자 후속 요청으로 자동 가격 덮어쓰기는 제거한다. 3,000억으로 변경할 때도 운영자의 `/상점추가` 명령으로 저장한다.

## Save Flow

- `data.shop[아이템이름]`은 기존 `loadJsonFile` / `saveJsonFile`의 DEV/PROD `filePath`로 저장한다. 등록·가격 수정으로 보유 아이템은 변경하지 않는다. 별도 가격 전환 플래그를 추가하지 않는다.

---

# Registry Expansion Queue

Status: PARTIAL

## Recommended Next Commands To Verify

- `/상점삭제 [번호]`
- `/영주수익순위초기화`
- `/타이틀지급`
- `/타이틀제거`
- `/펫타이틀지급`
- `/펫타이틀제거`
- `/출석`
- `/캐슬대전`
- `/가구장착 [번호]`
- `/가구판매 [번호]`

## Known Gaps

- Most mutation-heavy commands are not indexed yet
- Admin-only maintenance commands are not indexed yet
- Save-flow cross-file interactions are only documented for representative commands

---

# /자유시장

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/자유시장`
- Registration search: `가방거래등록`, `미니펫거래등록`, `가구거래등록`, `스킬거래등록`
- Purchase/cancel search: `/자유시장구매`, `/자유시장취소`, `/거래소강제취소`

## Files

- `main.js`
- `data/freeMarket.json`

## Related Helpers

- `ensureFreeMarketData`
- `getFreeMarketActiveListings`
- `addFreeMarketListing`
- `returnFreeMarketItemToOwner`
- `addFreeMarketCompletedLog`
- `removeFreeMarketDataByUser`
- `generateBagOutput`
- `refreshMiniPetSortIndex`
- `initSweetHomeUser`
- `initPetSkillUser`
- `addHappyFoundationLedgerAmount`
- `isMemberTierKing`

## Data Usage

- `freeMarketPath`
- `data.member[*].bag`
- `data.member[*].point`
- `petData[*].miniPetBag`
- `homeData[*].furnitureBag`
- `petSkillData[*].petSkills.bag`
- `data.hoiHappyFoundation.totalAmount`

## Save Flow

- `/자유시장` and `/자유시장현황` read `freeMarketPath`
- `/자유시장생성` creates `freeMarketPath` only when the file does not already exist
- Registration saves `freeMarketPath` and the mutated owner storage file
- Purchase saves `freeMarketPath`, `filePath`, and the purchased item storage file
- Cancel/force-cancel saves `freeMarketPath`, `filePath`, and the restored item storage file
- ver_2.659 captures the market JSON text at command entry and passes it to `saveJsonFile` as the rollback snapshot. Furniture registration/purchase/cancellation also captures the home JSON before mutation, so later save errors roll back both ownership and the listing. Missing/invalid JSON still fails naturally. Pendant registration sends success only after all saves pass.
- Account deletion removes related free-market listings/logs and saves `freeMarketPath`

## Related Commands

- `/가방거래등록 [가방번호] [갯수] [판매금액]`
- `/미니펫거래등록 [미니펫가방번호] [갯수] [판매금액]`
- `/가구거래등록 [가구가방번호] [갯수] [판매금액]`
- `/스킬거래등록 [스킬가방번호] [갯수] [판매금액]`
- `/펜던트거래등록 [펜던트가방번호] [판매금액]`
- `자유시장거래`
- `자유시장거래취소`
- `/자유시장구매 [번호]`
- `/자유시장취소 [번호]`
- `/거래소강제취소 [번호]`
- `/자유시장생성`
- `/자유시장현황`
- `/자유시장거래현황`
- `ㅅㅅ`
- `/펜던트거래정보 [자유시장번호]`

## AI Notes

- Free-market storage is isolated in `freeMarket.json`; item ownership still mutates the original owner/buyer storage files
- Active listing numbers are display-order numbers from recent-first `/자유시장`; purchase confirmation stores the immutable listing id to avoid buying a shifted listing
- Registration and purchase commands show a confirmation UI first; `자유시장거래` re-runs validation before mutation, and `자유시장거래취소` clears the pending request
- Mini-pet same-item matching includes name, emoji, grade, upgrade, battleExp, castleExp, and raidExp
- Completed logs keep only sold trades, newest first, capped at 100 entries
- Registration fees consume `🥕당근이세요?` immediately; cancel/force-cancel refunds the stored `carrotFee` only when the seller currently holds `자유시장회원권🏪`
- Sale fee is paid by the seller from proceeds and recorded to the foundation ledger without paying the foundation captain account; base fee is 17%, and sellers holding `자유시장회원권🏪` use 10%
- `/자유시장거래현황` displays the original completed trade price (`price`), while settlement still uses `sellerReceive`
- `/자유시장거래현황` appends the logged member fee rate only when `memberFeeApplied: true`; old 5%/7% rows keep their recorded rate.
- `/자유시장` and `/자유시장거래현황` display listing prices as full comma-formatted point amounts with an `억` helper for 1억 or more, e.g. `🅟350,000,000(3.5억)`, not Korean short units such as `35,000만(3억)`
- `/자유시장` and `/자유시장거래현황` append `[개당 ...]` to item text only when quantity is 2 or more, using `Math.floor(price / quantity)` and `formatKoreanShort`
- `/자유시장` displays active listing registration time from `createdAt/createdAtMs` as `MM/DD HH:mm`; `/자유시장거래현황` displays completed sale time from `completedAt/completedAtMs` as `MM/DD HH:mm`
- Free-market registration requires tier `킹` or higher; purchase re-checks that both buyer and seller are currently tier `킹` or higher before points or items move.
- Free-market active listing-count limit is additive: base 1 + equipped `타고난 장사꾼📙` 2 + `자유시장회원권🏪` 7, so ticket-only allows 8 active listings and both active bonuses allow 10 active listings; listing quantity itself is not capped by this limit
- `자유시장회원권🏪` checks tolerate bag-name suffixes such as parenthesized guide text
- `/펜던트거래등록 [펜던트가방번호] [판매금액]` is handled before the common invalid registration usage guard so it does not require a quantity argument.
- `/펜던트거래등록 [펜던트가방번호] [판매금액]` now follows the same confirmation flow as other free-market registrations: confirmation message first, `자유시장거래` to register, `자유시장거래취소` to cancel.
- Invalid `/가방거래등록`, `/미니펫거래등록`, `/가구거래등록`, `/스킬거래등록`, and malformed `/펜던트거래등록` input replies with the registration usage guide
- Furniture listings display furniture charm as `(+n💕)[grade]` in free-market item text when payload furniture data exists

# /탐

Status: VERIFIED

## Files
- main.js

## Related Helpers
- buildExploreBetMessage
- buildPetExploreStatusMessage
- doPetExploreInterval
- doChuseokExploreInterval
- getPetExploreBaseExperience
- grantPetExploreExperience
- buildPetExploreLevelUpSummary
- isPetExploreEventMineActive
- moveEventMineBetsToRandomMine
- migratePetExploreContentSlots
- calcExploreSuccessPercent
- getExploreSuccessPenaltyPercent
- getExploreTraitBonusPercent
- getRandomRegularMineExploreSlot
- isRegularMineExploreSlot
- isRegularDungeonExploreSlot
- isMazeExploreSlot
- hasPetSkill

## Data Usage
- data.member[*].bag
- data.member[*].exp
- data.member[*].boostercnt
- data.member[*].tierExperienceRemainder
- data.member[*].point
- data.member[*].bag["펫던전 입장권🌋"]
- data.member[*].bag["미궁 입장권🕋"]
- petExploreData.bet
- petExploreData.userBet
- petExploreData.record
- petExploreData.eventMine
- petSkillData[*].petSkills.equipped

## Save Flow
- `/탐` updates `petExploreData` and saves through `saveJsonFile(petExploreData, petExplorePath)`
- `/탐` also saves `data` through `saveJsonFile(data, filePath)`
- 튜토리얼 6단계는 정상 `/지도` 조회 후 명시적 `/탐 [번호]`로 이용 가능한 탐험지를 실제 지정해야 한다. 이벤트·입장 조건으로 거절된 입력이나 번호 없는 `/탐`은 인정하지 않는다. 같은 탐험지가 이미 설정되어 있으면 번호를 다시 입력해 확인할 수 있다.
- 지정한 탐험지의 정각 정산 결과를 받은 뒤 성공·실패 모두 목표로 인정한다. 길드·포인트·입장권 등의 사유로 정산되지 않은 경우는 인정하지 않으며, 일반/이벤트 정산은 보상과 함께 `member.json`에 진행 상태를 저장한다.
- `doPetExploreInterval` saves reward/member changes through `saveJsonFile(data, filePath)` and exploration state through `saveJsonFile(petExploreData, petExplorePath)`

## Related Commands
- `/탐`
- `/탐 [1~9]`
- `/탐 8`
- `/탐 9`
- `/탐 10` when the guild raid event is active
- `/탐 11` when the Chuseok moon-rabbit event is active
- `/지도`
- `/탐험알림`
- `/탐험유저확인`
- `/탐 0` when the event mine is active
- `/펫탐험이벤트활성화`
- `/펫탐험이벤트비활성화`
- `/레이드이벤트활성화`
- `/레이드이벤트비활성화`
- `/추석이벤트활성화`
- `/추석이벤트비활성화`
- `/달토끼상점`
- `/달토끼상점구매 [번호] [횟수]`
- `/황금당근오픈 [숫자]`
- `/황금당근수정 [아이디] [수량|+수량|-수량]`
- `/달토끼상점추가 [상품명] [상품수량] [가격] [계정당한도]`
- `/달토끼상점삭제 [번호]`
- `/레이드박스오픈`
- `/펜던트미궁박스오픈`
- `/대마법박스오픈`
- `/자동탐고정 0` when the event mine is active
- `/자동탐고정 9`
- `/자동탐고정 10` when the guild raid event is active
- `/자동탐고정해제`

## AI Notes
- `calcExploreSuccessPercent` is used for the reservation/status display and the actual settlement success roll
- `/탐 [숫자]` 예약 안내와 `/지도`의 상단 성공확률·상세 수식 최종값은 `formatPercent1`로 소수점 둘째 자리에서 반올림해 소수점 한 자리까지 표시한다.
- `doPetExploreInterval` uses the shared success-rate calculation immediately before consuming the selected probability-UP item and rolling the result, so premium, pendant, home-badge, and penalty values match the displayed formula and the final rate remains capped at 100%
- 일반 광산 1~3에서 이벤트 던전 `E` 보상으로 전환되어도 성공률은 입장권 재확인까지 끝난 원래 광산 기준으로 계산하므로 `광산탐험가📙` 효과가 사라지지 않는다.
- `moveEventMineBetsToRandomMine` moves existing `/탐 0` participants to random regular mines 1~3 when `/펫탐험이벤트비활성화` runs
- `getExploreTraitBonusPercent` applies `광산탐험가📙` only to `/탐 1~3`, `던전탐험가📙` only to `/탐 4~7` plus event guild raid `/탐 10`, and one +5% explorer bonus to `/탐 11` when either explorer skill is equipped.
- The trait check must be based on the selected dungeon range first, so users with both `광산탐험가📙` and `던전탐험가📙` still receive the correct +5% for each range
- Event mine slot `0` rewards `다이아광산박스💎(/다이아박스오픈)` and is shown above regular mines in `/지도` while active.
- `/펫탐험이벤트활성화` and `/펫탐험이벤트비활성화` toggle `petExploreData.eventMine.active` and save `petExploreData`.
- Guild raid uses separate dungeon key `10`, is entered with `/탐 10`, can be fixed with `/자동탐고정 10`, requires guild membership and `펫던전 입장권🌋`, rewards `길드레이드던전박스👾(/레이드박스오픈)`, and is toggled by `/레이드이벤트활성화` / `/레이드이벤트비활성화`.
- 추석 이벤트가 활성화되면 일반 탐험 선택·정산을 일시 중지하고 길드 가입 유저의 `/탐 11`만 받는다. 수동 `/탐 11` 등록은 다음 정산 1회 후 초기화된다. 자동 참여는 자동탐험권을 보유하고 `/자동탐고정 11`을 설정한 사용자에게만 적용된다. 매시간 정각 현재 길드 가입과 5천만 포인트 보유를 다시 확인하며, 실제 참가자는 5천만 포인트를 내고 기존 유저별 성공률과 확률UP 로직을 적용한다. 성공하면 황금당근 1~3개를 같은 확률로 받고 실패하면 황금당근을 받지 않는다.
- `/탐 11` 예약 화면은 상세 성공률을 표시한다. 이벤트 `/지도`는 저장된 수동 참여자와 `자동탐험권 보유 + /자동탐고정 11` 사용자를 합쳐 다음 정각의 현재 참여 인원을 계산하며, 자신의 자동고정 상태와 해제 명령을 함께 표시한다. 기본·티어·매력·영주·펫스킬·펜던트·호이패스·홈뱃지·확률UP·디버프의 상세 성공률은 `allsee` 뒤에 표시한다.
- `/황금당근오픈 [숫자]`는 복합 데이터 변경 쓰기 잠금 안에서 `황금당근🌕(/황금당근오픈 숫자)` 아이템을 같은 수량의 달토끼상점 전용 잔액으로 바꾸고 `member.json`과 `petExploreData.json`을 한 번씩 저장한다. 추석 이벤트 활성화·비활성화, 상점 상품 추가·삭제·구매도 같은 쓰기 잠금을 사용한다.
- `/황금당근수정 [아이디] [수량|+수량|-수량]`은 Master 전용이며 부호가 없는 수량은 증가로 처리한다. 복합 데이터 변경 쓰기 잠금 안에서 기존 가방 잔액을 이벤트 잔액으로 합친 뒤 황금당근을 증감하고, 음수 결과와 안전 정수 범위 초과는 저장 전에 차단하며 `member.json`과 `petExploreData.json`을 함께 저장한다.
- `/탐 11`은 길드 가입 여부와 5천만 포인트 보유 여부를 선택 시점에 먼저 확인하며, 조건을 충족하지 못하면 탐험지에 등록하지 않는다.
- `/달토끼상점`은 비길드 유저도 열람할 수 있지만 구매는 현재 길드 가입 유저만 가능하다. 이벤트 잔액과 기존 가방의 황금당근을 합산해 표시하고, 첫 구매나 이벤트 보상 지급 시 이벤트 잔액으로 옮긴다. 황금당근 차감, 계정별 누적 구매 한도, 구성품 지급을 한 번에 저장하며 이벤트 종료 시 이벤트 잔액·기존 잔액·미개봉 황금당근 아이템과 정산 시간 기록을 비우고 `/탐 11` 참가자를 1~3번 광산으로 이동하며 전체 자동탐험 고정 설정을 초기화한다. 상품별 구매 이력과 비활성 상품 번호는 보존한다.
- `/자동탐고정` 안내는 자동탐험권 자격 패스로 호이패스, 초보패스, 호이패스 프리미엄을 함께 표시한다.
- `/자동탐고정해제`는 저장된 자동탐험 고정 번호를 삭제한다. 추석 이벤트 중 11번 자동 등록 상태였다면 해당 자동 등록도 제거하지만, 사용자가 직접 신청한 `/탐 11` 참여는 유지한다.
- 펫탐험은 성공·실패와 관계없이 실제 정산까지 완료한 계정에 일반 광산 3 EXP, 일반·무작위 이벤트 던전 5 EXP, 미궁 7 EXP를 지급한다. 다이아 광산(`/탐 0`), 길드레이드던전(`/탐 10`), 달토끼 탐색(`/탐 11`)은 각각 10 EXP를 지급한다. 입장 실패·미참여에는 지급하지 않으며, 입장권 부족으로 광산 이동이 발생하면 최종 실제 탐험지 종류를 기준으로 한다. 기본 EXP에 현재 티어의 고정 EXP를 더한 뒤 호월신의 가호를 적용한다.
- 펫탐험 정산 메시지는 실제 기본·티어·가호 합산값을 `📊 총 획득 경험치`로 표시한다. 레벨업·승급·대승급 안내는 결과 보고서의 `allsee` 앞에 별도 표시해 접힌 상세 결과에 가려지지 않게 한다.
- 달토끼 탐색 결과 상단은 참여·성공·실패 인원을 한 줄에 표시한다. 성공한 참가자를 먼저 표시하고 실패한 참가자를 그 뒤에 표시하며, 각 그룹 안에서는 기존 참가 처리 순서를 유지한다. 미참여·길드 미가입·포인트 부족 인원 요약 아래에는 길드 미가입 유저와 포인트 부족 유저의 닉네임을 각각 표시한 뒤 참가자 상세용 `allsee`를 연결한다.
- 달토끼 탐색은 매 정각 현재 길드 가입과 참가비 보유 조건을 다시 확인하고, 같은 정각의 자동 중복 차감·보상과 0명 결과 재출력을 막는다. 포인트 부족자는 처리 완료로 기록하지 않아 충전 후 다음 정각에 참여할 수 있다. 관리자 수동 `/펫탐험정산`은 기존 Master·`오픈채팅봇`과 `호이월드 GM 관리자방`의 Admin이 실행할 수 있으며, DEV·운영 모두 입력할 때마다 새로운 탐험 회차로 실행한다.
- 달토끼 탐색의 시작 알림과 지도 참여 인원은 현재 길드 가입·참가비 조건을 충족한 등록자만 집계한다. 실제 참여자가 0명이면 0명 출발 알림과 대기를 생략하고, 접힌 빈 상세 없이 탐험 선택 유지와 다음 정각 참여 조건을 안내한다.
- `/자동탐험시작`은 기존 타이머를 정리하고 명령 입력 시각을 자동 주기 기준으로 저장한 뒤 첫 자동 정산을 60분 후 실행한다. 시작 명령에서는 정산·출발 대기를 수행하지 않고 즉시 종료한다. 관리자 `/펫탐험정산`은 즉시 한 회차를 정산하고, 기존 타이머를 정리한 뒤 정산 완료 시각을 다음 자동 정산의 60분 기준시각으로 다시 설정한다. 참가자 유무와 관계없이 실제 정산 함수가 끝난 뒤 명령 실행 방에 정산 완료와 다음 자동 정산까지 60분 안내를 출력한다. 수동·자동 정산은 같은 참가자 판정·보상·저장 함수를 사용하며, 수동 추석 정산만 즉시 새 회차 실행을 위해 같은 시간대 처리 기록을 초기화한다. 이후 타이머는 별도 채팅 입력을 기다리지 않고 정산 응답을 직접 실행하며, DEV에서 시작한 타이머는 DEV 데이터 경로를 유지한다.
- Regular mines are `/탐 1~3`: 펫강화, 친밀도, 행운. Random `/탐` selects one of these three without an entry ticket and applies a `-5%` success penalty.
- Dungeon entries are `/탐 4~7`: 전도르, 양계장, 땅문서, 샵오픈. They apply a `-15%` success penalty and check `펫던전 입장권🌋` at settlement.
- `/탐 6` rewards `땅문서던전박스📜(/땅문서박스오픈)` 1개, and `/탐 7` rewards `샵오픈던전박스🏡(/샵오픈박스오픈)` 1개 on success.
- `/땅문서박스오픈` grants `땅문서📜` 1개 per box, and `/샵오픈박스오픈` grants `펫스윗홈인테리어샵🖼️(/샵오픈)` 70개 per box; both boxes are auto-opened by `/정리`.
- Maze entries `/탐 8~9` require `미궁 입장권🕋` and apply a `-45%` success penalty.
- `/탐 8` rewards `펜던트미궁박스💎(/펜던트미궁박스오픈)` on success.
- `/탐 1` 강화박스는 `펫 강화석⭐` 70~100개, `/탐 2` 펫먹이박스는 `펫먹이🍼` 40~50개, `/탐 3` 행운의박스는 `럭키박스🍀(/럭키오픈)` 5개를 지급한다.
- `/탐 8` 펜던트미궁박스는 `펜던트 강화석📿` 3~4개와 독립 1% 확률의 `펜던트 복원석🔷` 1개를 지급한다.
- `/탐 9` requires `/종합순위` top 20, can be fixed with `/자동탐고정 9`, and auto-opens `대마법사의 유적박스📜(/대마법박스오픈)` on success to grant `펫스킬북 조각📙` 3~5개 with an independent 1% chance for `펫스킬북📙(/펫스킬오픈)`.
- 이벤트 던전의 `이벤트박스✡️(/이벤박스오픈)`는 샵오픈 100개와 펫던전 입장권 1개를 고정 지급하며 `/이벤트박스오픈✡️`도 같은 박스를 여는 별칭이다.
- `migratePetExploreContentSlots` runs once through `initPetExploreData`, moves existing participation and auto-fixed selections to the reworked slots, and marks `contentRework20260721` for persistence through the existing migration save flow.
- `initPetExploreData` preserves current visible participants and only records the old `pendantMazeSlotResetV2191` / `currentExploreSlotOneResetV2192` migration flags when they are missing.
- `/탐험유저확인` is an operator-only command. It loads `petExploreData`, removes deleted-account leftovers from `bet`, `userBet`, `autoFixedDungeon`, and `record`, saves only when cleanup occurs, then reports current participants and fixed auto-explore users.

# /맞짱필드

Status: VERIFIED

## Files

- `main.js`
- `Info.js`
- `data/currencyLog.json`
- `data/hoiBotChangeLog.json`

## Related Helpers

- `ensureMatzangFieldData`
- `ensureDiamondMemberData`
- `ensureCurrencyLogData`
- `ensureCurrencyLogUser`
- `ensureMatzangParticipant`
- `addDiamond`
- `buildMatzangParticipantList`
- `getMatzangPointRanking`
- `getMatzangBattleProfile`
- `runMatzangBattle`
- `getMatzangRankReward`
- `buildTotalExpTimeCheckDetail`
- `calculateTotalExp`
- `difftypeBuff`
- `calculateCriticalDamage`
- `isMatzangAllowedDuringFieldCommand`
- `isMatzangOperatorCommandMessage`
- `isMatzangBlockedPlainCommandAlias`
- `isMatzangInfoOperatorCommandMessage` in `Info.js`
- `formatMatzangRestRemainingTime`

## Data Usage

- `data.matzangField.active`
- `data.matzangField.resting`
- `data.matzangField.restUntil`
- `data.matzangField.participants`
- `data.matzangField.participants[*].totalExp`
- `data.matzangField.participants[*].totalExpUpdatedAt`
- `data.matzangField.shop`
- `data.member[*].diamond`
- `currencyLogData.user[*].diamond`
- `currencyLogData.user[*].usedDiamond`
- `currencyLogData.user[*].useHistory`
- `currencyLogPath`
- `petData[*]`
- `homeDataFile`
- `petSkillData`

## Save Flow

- Uses `filePath` member data for field state, participant event PT, battle point rewards, diamond balances, and diamond shop
- Uses `currencyLogPath` for cumulative earned diamond, used diamond total, and usage history logs
- `/맞짱`, `/참여`, `/맞짱시작`, `/맞짱종료`, `/휴식`, `/다이아상점구매`, `/다이아상점추가`, `/다이아상점삭제`, `/다이아추가`, `/다이아차감`, and `/다이아전체초기화` save `data` through `saveJsonFile(data, filePath)`
- `/맞짱종료` and `/다이아추가` save cumulative diamond data through `saveJsonFile(currencyLogData, currencyLogPath)`
- `/다이아상점구매` and `/다이아차감` save cumulative used diamond totals and usage history through `saveJsonFile(currencyLogData, currencyLogPath)`
- `/다이아상점구매`는 상점의 짧은 홈뱃지뽑기 [1·2·3] 이름을 실제 `/홈뱃지오픈` 계열 아이템명으로 지급하고, `홈뱃지 큐브💟 50개` 묶음은 사용 가능한 큐브 50개로 지급한다. 구매 전 가격 확인과 기존 두 파일 저장 흐름은 유지한다.
- `/맞짱` loads `homeDataFile` once for the command flow and passes the loaded data into battle calculation helpers
- `/맞짱시간체크 [닉네임]` loads `homeDataFile` and measures the named user's 종합매력 runtime with detailed component timings
- `/참여` calculates and stores the user's `totalExp`; `/맞짱` uses the stored participant `totalExp` for faster battle resolution
- `/맞짱` only reloads `homeDataFile` to repair older active participant data when a participant has no stored `totalExp`
- `/맞짱시간체크 [닉네임]` is an anytime read-only Admin/Master diagnostic path and does not run battle, select an opponent, or save match count, PT, diamond, or field data
- Active 맞짱필드 blocks non-matzang command flows in `main.js` and `Info.js` outside rest time; Admin/Master/오픈채팅봇 bypass only the confirmed field-operation and management command roots rather than every slash command, and the shared known plain-command list makes aliases and state inputs such as `ㅊㅊ`, `ㅈㅈ`, and `ㅈㅈㅈ` receive the same allowed-command guide as slash commands
- `Info.js` reads `data.member[*].diamond` for 종합 정보 display

## Related Commands

- `/맞짱시작`
- `/참여`
- `ㅊㅇ`
- `/맞짱`
- `ㅁㅁ`
- `/맞짱시간체크 [닉네임]`
- `/휴식`
- `/맞짱종료`
- `/맞짱필드목록`
- `/맞짱순위`
- `/다이아순위`
- `/다이아상점`
- `/다이아상점구매 [번호] [갯수]`
- `/다이아상점추가 [상품명] [상품갯수] [다이아갯수]`
- `/다이아상점삭제 [번호]`
- `/다이아추가 [아이디] [갯수]`
- `/다이아차감 [아이디] [갯수]`
- `/다이아전체초기화`

## AI Notes

- `/맞짱` and `ㅁㅁ` are exact commands; suffix text does not execute battle logic
- 맞짱은 참여 시점 종합매력에 상성·크리티컬을 적용한 최종 매력을 직접 비교하며, 동률이면 방어자가 승리한다.
- 상세보기는 양측 기본/상성/최종 매력, 크리티컬, 비교식과 매력 차이를 카드형 UI로 표시한다.
- `/맞짱시간체크 [닉네임]` measures only the named user's 종합매력 calculation and reports response-entry total, diagnostic-branch, home-load, total calculation, response common processing timings for data loads/normalizers, and detailed component timings for castle, raid, equipment, home, pet, mini-pet, intimacy, pet skill, and upgrade bonus; 0ms detail rows are hidden; it does not select an opponent or run `runMatzangBattle`
- `buildTotalExpTimeCheckDetail`은 명령에서 로드된 `guildData`를 전달받아 티어 스킬도 합산한다. 실전과 공통인 `getPetModeCharmPercent`·`applyPercentWithExactFloor`로 최종 합계를 계산하며 퍼센트 적용 전 합계도 별도로 표시한다. 반환하는 `castleBase`, `raidBase`, `rows`는 매력 버프 진단에서도 사용한다. 시간체크 화면은 기존처럼 0ms 행을 숨기지만 `rows`에는 모든 항목을 유지한다. 세부 항목을 다시 로드하거나 저장하지 않는다.
- Event PT is granted only to the user who entered `/맞짱` or `ㅁㅁ`; wins grant 10~15pt, losses grant 5~7pt, and the matched opponent can be K.O. without receiving PT from that command
- K.O. users remain active and can continue `/맞짱` or `ㅁㅁ` without re-entering while their event count remains
- Users who are already active in the field cannot re-enter with `/참여` or `ㅊㅇ`
- A participant's base battle charm is fixed at entry/re-entry time through `totalExp`, while critical chance and multiplier use the current effective pet-upgrade level at battle time; the participation UI tells users the base battle charm uses entry-time total charm.
- `/휴식` sends start/end notices through `noticeMsg`, includes the siege-room link in both notices, allows general commands during the 3-minute break, and stores a rest end time so `/맞짱` and `ㅁㅁ` resume even if the delayed notice/save timing is late; `/맞짱` shows the remaining break time and tells users to prepare with `/참여` or `ㅊㅇ`, while `ㅊㅇ` shows the remaining break time before the participation card
- A user who reaches 10 event matches is marked field-out and receives the `[✅완료]` message instead of the participation guide
- Each `/맞짱` or `ㅁㅁ` run grants the acting user 50,000,000 points on a win or 25,000,000 points on a loss. `/맞짱종료` still pays event PT rank rewards in diamonds to 1~100: 1st~10th receive 20 down to 11, 11th~20th receive 10, 21st~30th receive 5, and 31st~100th receive 3.
- `/맞짱종료` clears all participant data and rest state after rank rewards and reports the cleared participant count. If the field is already inactive but legacy participant rows remain, the same command clears and saves those stale rows without issuing rewards again.
- `/맞짱순위`는 `/맞짱시작`부터 현재까지 PT를 획득한 참가자를 누적 PT 내림차순으로 보여주며, 동점은 이름 오름차순으로 정렬한다. 조회만 수행하며 데이터를 저장하지 않는다.
- While the field is active outside rest time, normal users may use only `/참여` (`ㅊㅇ`), `/맞짱` (`ㅁㅁ`), `/맞짱필드목록`, and `/맞짱순위`; confirmed management commands such as `/휴식`, `/맞짱종료`, `/미정`, `/정보`, `/미니펫정보`, and `/패키지리스트` require the Admin/Master/오픈채팅봇 command-specific bypass. Operators no longer bypass the lock for ordinary slash commands. `/맞짱` outside the siege room includes the siege-room link.
- `/맞짱시작`, `/휴식`, and `/맞짱종료` recognize existing Admin/Master/오픈채팅봇 authority in the dedicated siege room without expanding global Admin/Master room permissions. This room allowance does not bypass the active territory-war command lock.
- Cumulative 맞짱 win/lose storage is intentionally not used
- `/다이아순위` uses cumulative earned 다이아 from `currencyLog.json` `user[유저명].diamond`; current held 다이아 remains in `data.member[*].diamond`
- 다이아 사용 누적은 `currencyLog.json` `user[유저명].usedDiamond`에 저장하며 `/다이아상점구매`는 구매 금액, `/다이아차감`은 실제 차감된 금액만 기록한다
- 다이아 사용내역은 `currencyLog.json` `user[유저명].useHistory`에 시간, 구분, 사용량, 메모만 간단히 누적 저장한다
- `/다이아전체초기화`는 마스터 전용이며 모든 유저의 보유 다이아와 `currencyLog.json` 누적 기록을 초기화한다
---

# /다이아상자오픈

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/다이아상자오픈`

## Files

- `main.js`

## Related Helpers

- `runDiamondBoxOpen`
- `parseOpenCountFromMsg`
- `resolveOpenCount`
- `hasItem`
- `removeItem`
- `addDiamond`

## Data Usage

- `data.member[sender].bag["다이아상자💎(/다이아상자오픈)"]`
- `data.member[sender].diamond`
- `currencyLogData.user[sender].diamond`

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)`
- Saves cumulative diamond data through `saveJsonFile(currencyLogData, currencyLogPath)`

## AI Notes

- Exact/full-pattern command guard: `/다이아상자오픈` or `/다이아상자오픈 숫자`
- One box grants `다이아💎 1개`; numeric use opens up to the held box count.

---

# /다이아조합

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `hasItem`
- `removeItem`
- `addPoint`
- `addItem`

## Data Usage

- `data.member[sender].bag["전설의 돌맹이🗿"]`
- `data.member[sender].point`
- `data.member[sender].bag["다이아상자💎(/다이아상자오픈)"]`

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)` after successful combination

## AI Notes

- Exact/full-pattern command guard: `/다이아조합` or `/다이아조합 숫자`
- Each count consumes `전설의 돌맹이🗿` 1개 and `🅟500,000,000`, then grants `다이아상자💎(/다이아상자오픈)` 1개.

---

# /다이아패스

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `processUserIDCommand`
- `addItem`

## Data Usage

- `data.member[*].pass.diamond`
- `data.member[*].bag["다이아상자💎(/다이아상자오픈)"]`

## Save Flow

- Uses surrounding member data save flow after list or item mutations

## Related Commands

- `/다이아패스추가, 아이디`
- `/다이아패스삭제, 아이디`
- `/다이아패스구독`

## AI Notes

- `/다이아패스구독`은 사용 중단 안내만 출력하며, 활성 다이아패스 보상은 `/구독패스지급`에서 함께 처리한다.

---

# /펫스킬컬렉션|/펫스킬컬렉션만능 [번호]|/펫스킬컬렉션등록 [번호] ...

Status: VERIFIED

## Command Anchors
- Search in `main.js`: `/펫스킬컬렉션`, `/펫스킬컬렉션만능`, `/펫스킬컬렉션등록`

## Files
- `main.js`

## Related Helpers
- `ensurePetSkillCollection`
- `getPetSkillCollectionCount`
- `buildPetSkillCollectionProgressLines`
- `buildPetSkillCollectionMessage`
- `buildPetSkillCollectionConfirmMessage`
- `getPetSkillCollectionTargetList`
- `normalizePetSkillStoredNames`
- `getPetSkillBagList`
- `removePetSkillFromBag`

## Data Usage
- `petSkillData.json -> [user].petSkillCollection[skillName]`
- `petSkillData.json -> [user].petSkills.bag[skillName]`
- `member.json -> member[user].bag["홈뱃지 큐브💟"]`
- `member.json -> member[user].bag["펫스킬컬렉션 만능 열쇠📚(/펫스킬컬렉션만능 번호)"]`

## Save Flow
- `/펫스킬컬렉션`은 SS~D 현황과 통합 컬렉션 번호를 출력한다.
- `/펫스킬컬렉션만능 [번호] ...`는 일반 펫스킬북 보유 여부와 관계없이 만능 열쇠로 한 번에 최대 10개를 등록한다.
- 같은 컬렉션 번호도 남은 최대 등록 수량 안에서는 반복 입력할 수 있다.
- `/펫스킬컬렉션등록`은 `/펫스킬가방` 기준 최대 10개의 서로 다른 가방 번호를 받는다.
- 선택한 가방 번호의 펫스킬북을 등록 재료로 사용한다.
- `한정판` 펫스킬은 종류별 최대 10개까지 등록할 수 있고, 등록 1개당 `홈뱃지 큐브💟` 300개를 지급한다.
- 현황 UI는 컬렉션 보상표 앞에 `🗝️ 만능열쇠 등록`과 `/펫스킬컬렉션만능 [펫스킬컬렉션번호] ...`를 표시하고, 보상표는 SS~D 다음 한정판 순서를 유지한다.
- 이전 표기 형태로 저장된 펫스킬북은 등록 재료 확인과 소모 전에 현재 표준 이름으로 병합한다.
- `등록` 성공 시 컬렉션·펫스킬가방을 `petSkillData.json`에, 보상·만능 열쇠를 `member.json`에 저장한다.
- 등록 완료 결과는 `allsee` 접기 없이 등록 성공 상세를 바로 이어서 표시한다.
- 두 파일은 기존 1·2세대 자동 백업과 명령 단위 롤백 보호 흐름을 재사용한다.

## Related Commands
- `/펫스킬가방`
- `등록`
- `ㄴㄴ`

---

# /만능상자오픈 [숫자]

Status: VERIFIED

## Command Anchors
- Search in `main.js`: `/만능상자오픈`, `runUniversalBoxOpen`

## Files
- `main.js`

## Related Helpers
- `runUniversalBoxOpen`
- `addItem`
- `removeItem`
- `noticeMsg`

## Data Usage
- `member.json -> member[user].bag["만능상자🔐(/만능상자오픈 숫자)"]`
- `member.json -> member[user].bag["펫스킬북📙(/펫스킬오픈)"]`
- `member.json -> member[user].bag["펫스킬컬렉션 만능 열쇠📚(/펫스킬컬렉션만능 번호)"]`
- `member.json -> member[user].bag["미니펫컬렉션 만능 열쇠🗝️(/미니펫컬렉션만능 번호)"]`

## Save Flow
- 상자마다 70%·25%·5%를 독립 추첨한 뒤 보상을 합산하고, 상자 차감과 보상 지급을 한 번 저장한다.
- 미니펫컬렉션 만능 열쇠가 하나 이상 나오면 저장 후 전체 알림을 시도한다.
- 개봉 결과는 실제 획득한 보상 종류에만 순번을 붙이고, 아이템의 관련 명령어는 가방 저장명에 유지하되 결과 표시명에서는 제외한다.

---

# /봉인금고

Status: VERIFIED

## Command Anchors
- Search in `main.js`: `/봉인금고`, `/봉인금고오픈`, `runSealedVaultCommand`, `runSealedVaultOpen`

## Files
- `main.js`
- `Info.js`

## Related Helpers
- `isSealedVaultCommandMessage`
- `isSealedVaultMutationCommandMessage`
- `runSealedVaultCommand`
- `runSealedVaultOpen`
- `drawSealedVaultWeightedReward`
- `ensureSealedVaultUserState`
- `ensureSealedVaultRootData`
- `appendSealedVaultRareRecord`
- `appendSealedVaultAdminLog`
- `addItem`
- `removeItem`
- `noticeMsg`

## Data Usage
- `member.json -> member[user].bag["호이의 봉인금고🔒(/봉인금고오픈 숫자)"]`
- `member.json -> member[user].bag["해방의 열쇠🗝️(/봉인금고오픈 숫자)"]`
- `member.json -> member[user].sealedVault`
- `member.json -> sealedVault.monthlyRewards`
- `member.json -> sealedVault.rareRecords`
- `member.json -> sealedVault.adminLogs`

## Save Flow
- `/봉인금고오픈 [숫자]`는 요청 횟수만큼 `호이의 봉인금고🔒(/봉인금고오픈 숫자)`와 `해방의 열쇠🗝️(/봉인금고오픈 숫자)`를 모두 보유한 회원만 실행할 수 있다.
- `/봉인금고오픈 [숫자]`는 1~100개의 봉인금고와 열쇠를 한 번에 사용하며, 각 회차를 순서대로 추첨한 뒤 두 아이템 차감·보상·누적 상태·희귀 기록을 `member.json`에 한 번 저장한다.
- 30번째 개봉마다 해당 회차의 일반·플래티넘·초대형 최종 보상을 2배 지급하고 부스터 누적을 초기화한다.
- 플래티넘이 199회 연속 나오지 않으면 200번째 개봉에서 플래티넘을 확정한다. 초대형 보상은 플래티넘 미등장 누적을 초기화하지 않는다.
- 플래티넘과 초대형 보상은 개인·전체 희귀 기록에 남기고, 저장 완료 후 전체 알림을 시도한다.
- `/해방열쇠조합 [숫자]`는 열쇠 1개당 봉인금고 100개를 소모한다. 성공 결과에 사용자 체크랭크, 소모·획득 수량, 남은 호봉과 현재 열쇠 수량을 표시한다. `runSealedVaultKeyCombine`은 메모리만 변경하고 기존 명령 진입부에서 `member.json`에 한 번 저장한다. 재료 부족·0·계산 범위 초과는 차감하지 않고 후행 안내문이 붙은 입력은 실행하지 않는다.
- `해방열쇠조합` 또는 `/해방열쇠조합`은 사용법만 안내한다. 열쇠 부족 안내에 조합 안내를 추가하고 봉인금고 부족 안내는 일일퀘스트 획득 경로를 표시한다.
- 일일퀘스트 보상은 `claimQuestReward`의 기존 중복 수령 방지와 저장 경로를 재사용하며 main·Info 퀘스트 창과 지급 결과에 봉인금고 1개를 표시한다.
- `/봉인금고`, `/봉인금고확률`, `/봉인금고기록`은 조회 전용이다.
- `/봉인금고`는 보유 호봉금고와 해방의 열쇠 수량, 부스터·플래티넘 확정까지의 남은 횟수와 진행 게이지를 함께 표시하고, 하단 명령어 목록에 `확인: /봉인금고`를 안내한다.
- `/봉인금고오픈 [숫자]` 결과 제목 아래에는 `/봉인금고` 확인 명령어와 현재 부스터·플래티넘 보상 기록 확인 안내를 표시하며, 플래티넘·초대형 보상 당첨 여부, 남은 열쇠·호봉금고 수량, 부스터·플래티넘 확정까지의 남은 횟수와 진행 게이지를 안내한다.
- 같은 아이템도 일반 획득분과 2배 부스터 적용분을 별도 합산해 일반 줄 다음에 `🔥2배` 줄을 표시한다. 플래티넘·초대형 전체 알림도 실제 최종 지급량과 부스터 적용 여부를 같은 기준으로 표시하며, 당첨 요약은 횟수를 함께 안내한다.
- 플래티넘 금고에서 획득한 보상은 일반 보상과 별도로 합산하고 해당 보상 줄 바로 아래에 `└ 플래티넘 금고💎 당첨`을 표시한다. 2배 부스터가 함께 적용되면 최종 지급 수량 뒤의 `🔥2배` 표시도 유지한다.
- 관리자 명령은 열쇠 지급·회수, 계정 상태 조회, 부스터·천장 누적 조정, 월별 초대형 보상 설정, 전체 희귀 기록 조회를 지원한다.
- `해방의 열쇠🗝️`는 가방 특수 아이템에 표시하며 판매·당근 거래를 막는다.
- 데이터 변경 명령은 기존 회원 데이터 명령 단위 잠금과 저장 실패 롤백 흐름을 재사용한다.

## Related Commands
- `/봉인금고확률`
- `/봉인금고기록`
- `/봉인금고기록전체`
- `/해방열쇠지급 [아이디] [숫자]`
- `/해방열쇠회수 [아이디] [숫자]`
- `/봉인금고상태 [아이디]`
- `/봉인금고부스터설정 [아이디] [숫자]`
- `/봉인금고천장설정 [아이디] [숫자]`
- `/봉인금고보상설정 [YYYY-MM] [만능상자] [홈뱃지큐브] [다이아상자]`

---

# /재벌도전

Status: VERIFIED

## Command Anchors
- Search in `main.js`: `/재벌도전`, `runDiamondTycoonChallenge`

## Files
- `main.js`

## Related Helpers
- `getDiamondTycoonDailyData`
- `buildDiamondTycoonResultMessage`
- `runDiamondTycoonChallenge`
- `hasPetSkill`

## Data Usage
- `petSkillData.json -> [user].petSkills.equipped`
- `member.json -> member[user].diamondTycoon`
- `member.json -> member[user].bag["다이아상자💎(/다이아상자오픈)"]`

## Save Flow
- 장착 여부와 하루 10회 제한을 확인한 뒤 단일 난수로 로또·일반 성공·실패를 판정한다.
- 모든 판정은 도전 횟수를 1회 사용하며, 성공 보상과 일일 상태를 함께 `member.json`에 저장한다.
- 로또 결과는 저장 후 전체 알림을 시도하고, 알림 실패가 저장된 보상을 되돌리지 않는다.

---

# /길드해산 [길드명]

Status: VERIFIED

## Command Anchors
- Search in `main.js`: `/길드해산`

## Files
- `main.js`

## Related Helpers
- `disbandGuildByExactName`
- `removeDisbandedGuildTerritoryReferences`
- `findGuildIdByNameSafe`

## Data Usage
- `guildData.json -> guilds[guildId]`, `nameToId`, `territoryWar`
- `member.json -> member[user].guild`

## Save Flow
- MASTER 권한과 길드명 완전 일치를 확인한 뒤 회원 길드 참조와 길드·버프·영지전 참조를 정리한다.
- 성공 시 `guildData.json`과 `member.json`을 저장한다.

## Related Commands
- `/길드해지`
- `/길드정보`

---

# /구독패스지급

Status: VERIFIED

## Command Anchors
- Search in `main.js`: `/구독패스지급`

## Files
- `main.js`

## Related Helpers
- `grantAllSupportPassDailyRewards`
- `grantSupportPassDailyRewards`
- `grantHoiPassPremiumDailyRewards`
- `buildSupportPassPayoutResultMessage`
- `getActiveSupportPassUsers`
- `appendTerritoryPassPayoutLogs`

## Data Usage
- `member.json -> member[user].pass[premium|hoi|newbie|contribution|diamond|territory]`
- `member.json -> member[user].bag`
- `member.json -> supportPassPayoutLogs`
- 각 패스의 `dailyRewardLastDate`로 당일 중복 지급을 방지한다.

## Save Flow
- MASTER 또는 `오픈채팅봇`만 실행 가능하며, 6종 패스의 실제 지급 건수 또는 영지기습패스 중복 제외 로그가 있을 때 `member.json`을 한 번 저장한다.
- 영지기습패스는 `영지기습공격권🔥(40%)` 2개, `영지절대방어권🛡(50%)` 2개, `🌪️ 전쟁불안정 증폭권(/불안정)` 1개, `다이아상자💎(/다이아상자오픈)` 1개, `피뢰침⚡(자동 벼락 방지)` 1개를 지급하며, 성공·당일 중복 제외 내역을 최근 500건까지 기록한다.

## Related Commands
- `/호프구독`
- `/호이패스구독`
- `/초보패스구독`
- `/공헌패스구독`
- `/다이아패스구독`

---

# /다이아박스오픈

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `runDiamondMineBoxOpen`
- `runExploreBoxOpen`
- `rollDiamondMineBox`
- `openExploreBoxesAllForOpenAll`

## Data Usage

- `data.member[sender].bag["다이아광산박스💎(/다이아박스오픈)"]`
- `data.member[sender].bag["다이아상자💎(/다이아상자오픈)"]`

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)`

## AI Notes

- Exact/full-pattern command guard: `/다이아박스오픈` or `/다이아박스오픈 숫자`
- Included in `/정리` bulk explore-box opening through `openExploreBoxesAllForOpenAll`.

---

# /땅문서박스오픈

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `runLandDocumentDungeonBoxOpen`
- `runExploreBoxOpen`
- `rollLandDocumentDungeonBox`
- `openExploreBoxesAllForOpenAll`

## Data Usage

- `data.member[sender].bag["땅문서던전박스📜(/땅문서박스오픈)"]`
- `data.member[sender].bag["땅문서📜"]`

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)`.

## AI Notes

- Exact/full-pattern command guard: `/땅문서박스오픈` or `/땅문서박스오픈 숫자`.
- Included in `/정리` bulk explore-box opening through `openExploreBoxesAllForOpenAll`.
- Each box grants `땅문서📜` 1개.

---

# /샵오픈박스오픈

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `runShopOpenDungeonBoxOpen`
- `runExploreBoxOpen`
- `rollShopOpenDungeonBox`
- `openExploreBoxesAllForOpenAll`

## Data Usage

- `data.member[sender].bag["샵오픈던전박스🏡(/샵오픈박스오픈)"]`
- `data.member[sender].bag["펫스윗홈인테리어샵🖼️(/샵오픈)"]`

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)`.

## AI Notes

- Exact/full-pattern command guard: `/샵오픈박스오픈` or `/샵오픈박스오픈 숫자`.
- Included in `/정리` bulk explore-box opening through `openExploreBoxesAllForOpenAll`.
- Each box grants `펫스윗홈인테리어샵🖼️(/샵오픈)` 70개.

---

# /펜던트미궁박스오픈

Status: VERIFIED

## Files

- main.js

## Related Helpers

- runPendantMazeBoxOpen
- runExploreBoxOpen
- rollPendantMazeBox
- openExploreBoxesAllForOpenAll

## Data Usage

- data.member[sender].bag["펜던트미궁박스💎(/펜던트미궁박스오픈)"]
- data.member[sender].bag["팬던트 강화석📿"]
- data.member[sender].bag["팬던트 복원석🔷"]

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)`.

## AI Notes

- Exact/full-pattern command guard: `/펜던트미궁박스오픈` or `/펜던트미궁박스오픈 숫자`.
- Included in `/정리` bulk explore-box opening through `openExploreBoxesAllForOpenAll`.
- Each box grants `팬던트 강화석📿` 1~3개 and has a 1% chance to grant `팬던트 복원석🔷` 1개.

---

# /대마법박스오픈

Status: VERIFIED

## Files

- main.js

## Related Helpers

- runArchmageMazeBoxOpen
- runExploreBoxOpen
- rollArchmageMazeBox
- openExploreBoxesAllForOpenAll

## Data Usage

- data.member[sender].bag["대마법사의 유적박스📜(/대마법박스오픈)"]
- data.member[sender].bag["펫스킬북 조각📙"]
- data.member[sender].bag["펫스킬북📙(/펫스킬오픈)"]

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)`.

## AI Notes

- Exact/full-pattern command guard: `/대마법박스오픈` or `/대마법박스오픈 숫자`.
- Included in `/정리` bulk explore-box opening through `openExploreBoxesAllForOpenAll`.
- Each box grants `펫스킬북 조각📙` 1~3개 and has a 1% chance to grant `펫스킬북📙(/펫스킬오픈)` 1개.

---

# /레이드인장조합 [수량]

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `getRaidSealCraftRequest`
- `craftRaidSealItems`
- `isPointShopSafeCount`
- `isPointShopSafeAmount`

## Data Usage

- `GLOBAL_CONFIG.raidSealCraft`: 잡템 3,000개·포인트 5,000,000,000·기존 인장 명칭
- `data.member[sender].bag["잡템☠️"]`
- `data.member[sender].bag["레이드타격대인장👑(+600👾)"]`
- `data.member[sender].point`

## Save Flow

- 명령 진입에서 이미 로드한 회원 데이터를 전달하며 헬퍼는 IO를 수행하지 않는다.
- 전체 재료·포인트·결과물 보유량을 검증하고 차감·지급을 함께 반영한다.
- 성공 시 `saveJsonFile(data, filePath)` 후 완료를 안내하고 반환한다. 저장 실패는 기존 명령 트랜잭션으로 복구한다.
- `isExclusiveDataMutationCommandMessage`로 쓰기 잠금을 사용하며 DEV 경로를 유지한다.

## AI Notes

- 수량 생략은 1개이며 여러 개 조합은 비용에 동일 수량을 곱한다. 탭·연속 공백도 같은 수량으로 해석한다.
- 0·음수·소수·지수 문자열·접미 안내 문구는 조합하지 않는다. 금액 곱셈·최종 보유량이 안전한 숫자 범위를 벗어나면 차감하지 않는다.
- 결과물 효과와 기존 공성전·출석·1:1톡 등 공통 제한은 유지한다.

---

# /돌멩이상자오픈 [1만|10만] [수량]

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `getStoneBoxOpenRequest`
- `openStoneBoxItems`
- `syncStoneBoxShopItems`
- `isPointShopSafeCount`
- `isExclusiveDataMutationCommandMessage`

## Data Usage

- `GLOBAL_CONFIG.stoneBox`
- `data.shop["돌멩이🪨"]`
- `data.member[sender].bag["돌멩이🪨"]`
- `data.member[sender].bag["돌멩이 1만개 상자📦(/돌멩이상자오픈 1만)"]`
- `data.member[sender].bag["돌멩이 10만개 상자📦(/돌멩이상자오픈 10만)"]`

## Save Flow

- 명령 진입 흐름에서 이미 로드한 `data`를 전달하고, 상자 차감·돌멩이 지급을 반영한 뒤 `saveJsonFile(data, filePath)`가 성공하면 안내한다.
- 도우미 함수는 파일을 읽거나 저장하지 않는다. DEV 컨텍스트와 기존 저장 실패 복구 흐름을 사용한다.

## Related Commands

- `/상점`
- `/구매 [번호] [수량]`
- `/가방`

## AI Notes

- 1만·10만은 상자 종류이며 수량 생략 시 1개, 개봉 수량은 1~9,999개이다. 숫자는 한 번만 변환하고 수량·최종 보유량의 안전 범위를 검사한다.
- 해당 종류의 상자만 소모한다. 상자 또는 돌멩이의 보유량이 손상되었거나 부족하면 변경하지 않는다. 잘못된 종류·소수·지수 표기·추가 안내 문구는 실행하지 않는다.
- 명령 전처리에서 돌멩이 단가 × 10,000·100,000으로 두 상자 가격을 동기화한다. 단가가 없거나 잘못되면 등록하지 않고 기존 정보를 유지한다. 기존 상품 순서를 유지하며 신규 상자를 끝에 추가한다.
- 기존 구매의 9,999개 제한·할인·세금을 사용한다. 돌멩이 낱개 상품은 유지하고 개봉 시 추가 결제하지 않는다.
- 기존 출석·1:1톡 패스·이벤트 공통 제한을 유지한다. 유효한 개봉 명령은 쓰기 잠금 대상으로 분류한다.

---

# /포인트상자오픈

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/포인트상자오픈`

## Files

- `main.js`

## Related Helpers

- `runPointBoxOpen`
- `parseOpenCountFromMsg`
- `resolveOpenCount`
- `hasItem`
- `removeItem`
- `addPoint`

## Data Usage

- `data.member[sender].bag["1억포인트상자🪙(/포인트상자오픈)"]`
- `data.member[sender].point`

## Save Flow

- Saves member data through `saveJsonFile(data, filePath)`

## AI Notes

- Exact/full-pattern command guard: `/포인트상자오픈` or `/포인트상자오픈 숫자`
- One box grants `🅟100,000,000`; numeric use opens up to the held box count.

---

# /메인방제한 · /메인방제한 ON · /메인방제한 OFF

Status: VERIFIED

## Files

- `main.js`: `response(...)` 입구에서 처리

## Data Usage

- `GLOBAL_CONFIG.maintenance.testRoomOnly` 메모리 값만 조회·변경한다.
- 기본값은 `OFF`이며 재컴파일 시 기본값으로 돌아간다.

## Save Flow

- Master가 `팻 테스트방`에서 입력한 경우에만 응답한다. 다른 방이나 권한 없는 이용자의 입력은 무응답이다.
- `ON`이면 MAIN의 다른 명령은 `팻 테스트방`에서만 처리하고, `OFF`이면 일반 방에서도 처리한다.
- `member.json` 등 운영 데이터 파일은 읽거나 저장하지 않는다. `/스타터중복회수` 자체의 테스트방·Master 제한은 유지된다.

---

# /데이터상태

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/데이터상태`

## Files

- `main.js`

## Related Helpers

- `buildManagedJsonStatusMessage`
- `inspectManagedJsonFile`
- `getManagedJsonCommandTargets`
- `getManagedJsonBackupPath`
- `getManagedJsonSecondaryBackupPath`

## Data Usage

- `member.json`, `member_back.json`, `member_back2.json`
- `member_pet.json`, `member_pet_back.json`, `member_pet_back2.json`
- `petSkillData.json`, `petSkillData_back.json`, `petSkillData_back2.json`
- `petHomeActivityData.json`, `petHomeActivityData_back.json`, `petHomeActivityData_back2.json`

## Save Flow

- Read-only; each file is strictly parsed without automatic restoration or writes.

## AI Notes

- Admin/Master only.
- Normal input checks production paths; `dev/데이터상태` checks DEV paths.

---

# /데이터복구 [파일] [1|2]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/데이터복구`

## Files

- `main.js`

## Related Helpers

- `getManagedJsonCommandTarget`
- `restoreManagedJsonFromSelectedBackup`
- `notifyManagedJsonRecovery`
- `writeVerifiedJsonFile`

## Data Usage

- Files: `member`, `member_pet`, `petSkillData`, `petHomeActivityData`
- Backup generation: `1` for `_back.json`, `2` for `_back2.json`

## Save Flow

- Strictly validates the selected backup and safely replaces only the selected original without rotating or overwriting either backup generation.

## AI Notes

- Admin/Master only; exact full-pattern guard prevents suffix text from executing.
- Check `/데이터상태` first. Normal input restores production data; `dev/데이터복구 ...` restores DEV data.

---

# /데이터정리

Status: VERIFIED

- ver_2.646: 기존 `member_pet[*].miniPetRobberyHistory` 전체를 `miniPetRobberyHistory.json`으로 옮기고 회원 `migrations.miniPetRobberySplit20261014 = true`를 게시한다. 최초 기록 사본 `miniPetRobberyHistory_legacy.json`을 보존한다. 원래 중복 행 개수와 같은 ID의 다른 내용도 보존하며, 재이전 시 이미 옮긴 동일 행을 개수별로 대조해 중복 추가하지 않는다. 완료 후 기존 펫 배열을 제거한다. 누락·손상·초기 경로 충돌은 오류로 중단한다.
- `requireMiniPetRobberyStore`, `getMiniPetRobberyRows`, `validateMiniPetRobberyPending`, `buildMiniPetRobberyMigration`은 이미 로드한 데이터를 검증·조회·계획하며 파일 IO를 하지 않는다. 복구·이전·강탈·조회 진입부에서 IO를 수행한다.
- `miniPetRobberyPending.json`은 회원·펫·이력 세 파일의 작업 전 원문을 보관한다. 명령 저장 트랜잭션으로 파일 실패를 원복하고, 중단 시 MAIN 진입과 운영 재컴파일의 타이머 시작 전 원문을 복구한다. 초기 이전의 없던 이력 파일만 삭제 복구를 허용한다. 복구 원문 전체를 검증하기 전에는 쓰지 않는다. DEV 복구는 다음 DEV 요청에서 수행한다.
- 분리 후 약탈자가 실행하는 미니펫대전과 약탈자 이력 조회만 이력을 로드한다. 강탈 성공 때 포인트·대전 횟수·별도 이력을 함께 저장하며, 자동일퀘는 최초 원문을 유지하다 일괄 저장 성공 후 복구 표시를 비운다. MAIN의 본인·다른 유저 미니펫정보는 별도 이력에서 최근 50건을 출력한다. Info는 복구 대기 중 부분 정보를 출력하지 않는다.
- tools/test_robbery_history_split.js: 실제 정리·약탈 저장·복구·자동일퀘 일괄 저장·재컴파일·Info 차단·DEV·일반 명령 미로드 등 정상/예외 12개 그룹. tools/test_doll_rhino.js는 실제 Rhino에서 이전·재이전·특수 이름 보존을 추가 검증한다.

- ver_2.645: 기존 가방 명칭 정리 시 원본 수량이 숫자 `0`인 항목은 제외하고 회원 파일에 저장한다. 완료 안내에 제거한 항목 수·회원 수를 표시한다. 기존 권한·DEV/PROD·저장 트랜잭션·양수 보유량·구독 기록은 유지한다. 분리 완료 파일의 잔류 로그 복구 전용 경로는 기존대로 복구만 수행하므로 일반 정리는 재실행 때 적용된다.
- tools/test_member_storage_split.js: 실제 정리 본문으로 숫자 0 삭제·양수/소수/안전 정수 상한·구독 보존·명칭 통합·재실행·DEV 격리·이후 저장 실패 원복을 포함한 55개 그룹을 검증한다.

## Files

- `main.js`

## Related Helpers

- `cleanupDeletedAccountResiduals`
- `collectDeletedAccountNames`
- `removeDeletedAccountBoardRows`
- `getMemberSplitMarker`, `createMemberSplitMigrationStores`, `verifyMemberSplitMigrationSource`, `completeMemberSplitMigration`
- Storage utilities: `attachMemberSplitStores`, `buildMemberSplitSavePlan`, `writeMemberSplitSlot`, `readPublishedMemberSplitStore`, `preserveMemberSplitBackupStores`

## Data Usage

- `data.migrations.memberStorageSplit20261012`: split phase, immutable original backup path, published raid/log revisions
- Startup `recoverMemberSplitPublication` strictly compares the full member body against the prior primary backup via `buildMemberSplitPublicationRecovery`. Only one missing raid publication with identical member/log records, matching raid summary, no current round, and fully paid history is eligible. It archives raw inputs, publishes the existing referenced raid slot, preserves all payouts, and cancels historical unsent deliveries. Missing/corrupt/foreign stores and changed records still fail; ordinary loads do not silently select a different revision.
- `writeVerifiedJsonFile` records a transaction entry as saved immediately after replacement; cleanup/transport logging failure cannot leave a published member outside rollback tracking.
- `serverRaidData.json` / `serverRaidData_next.json`: full `serverRaid`; member retains only current locking state, generation/sequence, wins and pending-notice summary
- `memberOperationLogs.json` / `memberOperationLogs_next.json`: `supportPassPayoutLogs`, `guildTerritoryAutomationLogs`, `territoryPassAuditLogs`, `petMusouAutomationLogs`
- `homeData[*].furnitureBag`
- `placedFurnitureData[*]` after separation, with legacy home fallback before separation
- `data.member[*].bag`
- `data.member[*].guildTerritoryAutoAttackGranted`
- `data.member[*].guildTerritoryAutoAttackPermanent`
- `data.member[*].point`
- `data.allowedUsers2`
- `data.allowedUsers4`
- `data.allowedUsers6`
- `data.allowedUsersHoipass`
- `data.allowedUsersDiamondPass`
- `petData[*].petSkills`
- `petData[*].petchar`
- `petData[*].ring`
- `petData[*].ringRewardMigration`
- `petSkillData[*]`
- `guildData.guilds[*].warehouse.ring`
- `memberTitleData.member[*]`
- `petTitleData.member[*]`
- `miniPetTitleData.member[*]`
- `miniPetCollectionData.member[*]`
- `currencyLogData.user[*]`
- `trialTowerData.user[*]`
- `punchRankData.member[*]`
- `petHomeCommentsData.comments[*]`
- `petHomeCommentsData.pinnedComments[*]`
- `petHomeActivityData`
- `petExploreData`
- `freeMarketData`
- `boardData.memo`, `boardData.record`, `carrotBoardData.memo`
- `packageLogData.logs`

## Save Flow

- Before existing cleanup, write an immutable full-member backup, persist `COPYING` with the original fields retained, copy and read-verify both external stores, then publish `COMPLETE` and remove only the copied fields. Durable checkpoints separate migration from normal cleanup.
- Completed member loads attach log arrays and save context as non-enumerable properties. Raid command entry, locked game-input entry and the raid timer request `loadJsonFile(filePath, "raid")`; ordinary member reads retain the summary.
- Split-store validation, save-plan log validation and the four root log writers use `Array.isArray` so valid Rhino arrays from another scope are accepted without replacing their existing records. Invalid log fields still fail, and the error identifies the field.
- `saveJsonFile(data, filePath)` writes changed external stores to alternating revision slots before publishing member references. Transaction snapshots restore overwritten slots/delete newly created slots on failure. Stale references are rejected.
- Member `_back` / `_back2` snapshots preserve matching raid/log generations; valid slots with a different revision may resolve an exact matching generation backup. Missing/invalid active files fail visibly. Split files are never replaced with empty data or silently repaired.
- Explicit residual-log repair validates the currently referenced raid/log stores, archives the original member plus both backup generations and all split slots/backups as raw text, then rebuilds both matching backup sets. Only this repair bypasses the old backup rotation; failure rolls back member, slots and backup sets while retaining the immutable archive. Normal saves still reject mismatched backups.
- Saves `homeData` through `saveJsonFile(homeData, homeDataFile)`
- Saves separated placed furniture cleanup through `saveJsonFile(placedFurnitureData, petHomePlacedFurniturePath)` when the detail file exists
- Saves member data through `saveJsonFile(data, filePath)`
- Saves pet data through `saveJsonFile(petData, memberPetPath)`
- Saves pet skill data through `saveJsonFile(petSkillData, petSkillDataPath)`
- Saves guild data through `saveJsonFile(guildData, guildPath)`
- Step 9 saves every account-residual store after comparing its user identifiers with `data.member`.

## AI Notes

- Admin/Master-only maintenance command.
- Exact `/데이터정리` retains existing room-scoped permissions; `dev/데이터정리` migrates only DEV paths. Initial migration is blocked during raid preparation, progress and settlement.
- If a completed member file contains one or more valid root log arrays again, the authorized `migration` read prepares recovery only in memory. Entry writes a unique immutable `member_storage_split_backup_log_recovery_<id>.json`, publishes all external and residual rows together, verifies the result, then replies and returns before ordinary cleanup/game recovery. Empty residual arrays are removed too. Identical rows are preserved without deduplication/capping during recovery; later writers retain their existing rolling limits. Other member reads still reject residue; missing/invalid companion data is never defaulted.
- Recovery does not restart/reset a tournament, floor points, remove items or award rewards. Saving failure restores the member residue and prior published external logs, allowing an explicit retry. Re-execution after successful recovery does not append residue again.
- Main's command error record includes the string error and version. On member-split failures, existing Admin/Master identities also receive the failure text; residue failures include the cleanup instruction. Runtime device access is not part of this flow.
- During `COPYING`, other member loads are blocked; bootstrap reads only permissions, and the authorized cleanup command can resume. Re-running after completion skips migration and performs ordinary cleanup.
- Migration preserves members, currencies, inventory, quest data, raid history/receipts/outbox and logs. Existing cleanup steps below still run and retain their previous deletion policies.
- Completed migration requires the new main code. Code rollback requires restoring the matching pre-migration full member backup; do not pair a thin member snapshot with legacy code or omit companion files from backups.
- Does not delete legacy `homeData[*].guestComments`.
- Recurring steps now cover pet-home garbage, strictly numeric zero bag entries, decimal points and orphan-account references. Positive/negative/fractional/string quantities and current subscription data are not changed by zero-item cleanup.
- Completed one-time item renames, pet-skill relocation, legacy pass-list deletion, old user/guild rings and mistakenly granted independent auto-attack items/flags were removed at the user's request. Restoring an old snapshot does not re-enable those retired transformations.
- First `/데이터정리` after this version migrates quest history/title arrays and returns before general cleanup. Re-running skips this completed migration; current member-split and robbery storage checks remain.
- Orphan cleanup detects identifiers absent from `data.member` only from current account-owned data and removes their account data and cross-user references. Historical-only references such as comment authors, social actors/visitors, completed market logs, board records, automation/audit logs, and package logs do not independently make an identifier a cleanup target. `attendanceLightData` is not used as an orphan source because it intentionally stores pre-signup attendance, but a confirmed deleted account discovered in another store is removed from it too. The result count is shown as `잔여 식별자` rather than an actual deleted-account count.
- Castle battle `history` cleanup is no longer performed by this command.

---

# /스타터중복확인

Status: VERIFIED

## Files

- `Info.js`: Master 전용 읽기 전용 지급 기록 조회

## Data Usage

- `member.json`의 `data.member[사용자].adventureOnboarding.receipts.memberRewards`와 `data.member[사용자].adventureQuest.receipts.starterMemberRewards`가 각각 `true`인 이용자 목록 및 두 목록의 교집합을 표시한다.
- 각 목록을 30명씩 나누어 출력하며 이용자별 전액 회수·부분 회수·보유량 0·데이터 오류·이미 회수 상태를 표시한다. 퀘스트 지급 기록이 있는 이용자 중 처리 가능한 인원 수와 명단, 부족 항목을 별도 표시한다. 현재 보유량만으로 실제 지급 경로를 증명하지는 않는다.

## Save Flow

- 조회만 하며 `saveJsonFile`을 호출하지 않는다.
- Master가 `팻 테스트방`에서 입력한 경우에만 응답한다. 다른 방에서는 `member.json`을 읽기 전 무응답으로 종료한다.

---

# /스타터중복회수

Status: VERIFIED

## Files

- `main.js`: 팻 테스트방 Master 전용 회수 미리보기·실행

## Data Usage

- `member.json`의 퀘스트 스타터 지급 영수증이 있는 회원만 대상이다. 포인트·가호·아이템 17종을 지급량 한도에서 현재 남아 있는 만큼 회수한다. 없는 항목은 0개 회수하며, 음수·소수 등 비정상 수량이 있으면 해당 회원을 보류한다.
- 처리 시 기존 퀘스트 지급 영수증을 유지하고 실제 회수량·부족분·완료 시각을 기록한다. 보유량이 전혀 없는 회원도 0개 처리 완료로 기록해 나중에 얻은 재화를 재실행 시 차감하지 않는다. 친밀도와 퀘스트 진행 상태는 변경하지 않는다.

## Save Flow

- `/스타터중복회수`는 전액·부분·보유량 0·데이터 오류 보류·이미 회수 인원과 명단을 미리 보여준다.
- `/스타터중복회수 실행`은 실행 시점에 퀘스트 지급 기록과 현재 보유량을 다시 읽어 정상 데이터 회원의 남은 수량만 차감하고 `member.json`을 한 번 저장한다. 미리보기와 실행 사이의 인원 수가 달라도 현재 대상만 처리하며, 재실행 시 처리 완료자를 다시 차감하지 않는다.
- 두 명령은 `팻 테스트방` 밖에서 무응답이며, 실제 운영 봇 실행은 운영자 몫이다.
- 임시 MAIN 테스트방 제한은 해제되어 일반 방 명령도 작동한다. 회수 명령 자체의 `팻 테스트방`·Master 제한은 유지된다.

---

# /모험가퀘스트 · /퀘스트완료 · /퀘스트기록 · /퀘스트타이틀

Status: VERIFIED

## Files

- `main.js`: 튜토리얼 진행·보상·타이틀·매력 반영
- `Info.js`: `/상점` 화면과 `/레벨` 퀘스트 표시

## Related Helpers

- `getAdventureQuestState`
- `prepareAdventureQuestStage`
- `recordAdventureQuestAction`
- `recordAdventureQuestExploreSelection`
- `recordAdventureQuestExploreResult`
- `getAdventureQuestCompletionCheck`
- `completeAdventureQuestStage`
- `buildAdventureQuestMessage`
- `buildAdventureQuestHistoryMessage`
- `buildAdventureQuestTitleMessage`
- `calculateCastleExp`, `calculateRaidExp`

## Data Usage

- `data.member[사용자].adventureQuest`: 현재 단계, 단계별 행동, 지급 영수증, 완료 단계, 장착 타이틀 번호/표시 이름, 누적 보상
- `adventureQuestHistory.json`: 사용자별 기존 완료 기록/획득 타이틀의 전체 배열과 순서. `adventureQuestHistory_legacy.json`은 최초 이전 원본 기록 보관용이다.
- `data.migrations.adventureQuestHistorySplit20261014`: 완료 표시; `/데이터정리` 재실행은 다시 이전하지 않는다.
- `adventureQuestHistoryPending.json`: 회원 본문·기록·회원 백업·raid/log 저장 슬롯/백업 원문. 저장 중단 시 MAIN 진입/시작에서 전체 검증 후 복구하며 Info는 복구 대기 중 부분 정보를 표시하지 않는다.
- `memberPet.json`, `petSkillData`, 펫홈·탐험·홈뱃지 자료: 완료 시 실제 적용 상태 확인

## Save Flow

- `/퀘스트완료`는 다른 퀘스트 조회·타이틀 명령과 같이 채팅방 제한 없이 실행한다. 완료 조건과 보상·저장 흐름은 기존 규칙을 따른다.
- 분리 후 퀘스트 명령 진입에서 기록을 한 번 로드해 `attachAdventureRecordStore`로 배열을 비열거 연결한다. 일반 행동/정보/보상 계산은 과거 배열을 다시 생성하거나 로드하지 않는다. `saveJsonFile`은 실제 기록 변경 시 복구 원문을 먼저 저장하고 기록·회원/보상을 함께 저장한 뒤 완료 표시를 지운다. 실패 시 트랜잭션 롤백, 중단 시 원문 복구를 사용한다. 이전 회원 백업보다 새 기록이 있거나 완료 단계와 기록이 다르면 완료/재지급을 차단한다. 명시적 계정 삭제는 해당 계정의 별도 기록도 삭제한다.
- 스타터 회원 보상은 `/호여!!`에서 지급한다. 7·8·14단계 최초 1회 지급 재료는 단계 최초 진입 시 영수증을 기록하고 `member.json`에 함께 저장한다. 화면에는 실제 아이템명과 `최초 1회 지급`을 표시한다.
- 대부분의 행동 기록은 실제 기능 성공 흐름에서 기록한다. 2단계는 티어 승급티켓🎟 1개 이상을 보유한 상태의 `/티어적용` 입력만 인정하며 상점 조회·구매·티어 조회와 실제 승급 성공은 요구하지 않는다. 6단계는 `/지도` 조회, 실제 `/탐 [번호]` 지정, 해당 탐험지의 정산 결과 수령 순서로 완료한다. 7단계는 `/냠냠 [수량]`으로 펫먹이 100,000개 이상을 한 번에 정상 사용하면 완료한다. 13단계는 다이아상점 조회 후 상품명이 `홈뱃지뽑기🛡️`로 시작하는 상품 구매만 인정하고, 그런 상품이 없을 때만 다른 상품 구매를 인정한다. 묶음 내용물이 아닌 구매 명령의 수량을 합산하며 구매 시점에만 기록하므로 과거 구매는 자동 소급하지 않는다.
- 3~5단계는 해당 단계가 진행 중일 때 미니펫대전·캐슬대전·시련의탑의 정상 결과를 각각 1회씩 기록하며, 5회부터 완료할 수 있다. 일일 콘텐츠 입장 상한도 5회이며 자동일퀘 추가 보상 5회는 별도다.
- `/퀘스트완료`는 현재 단계 조건을 재확인하고 보상·기록·타이틀·다음 단계 준비물을 한 번에 저장한다. 9단계 최대 평수 자동 완료도 같은 흐름을 사용한다.
- 14단계는 큐브를 실제 사용한 홈뱃지가 현재 장착·적용 중일 때 완료한다. 16단계 이후 `/퀘스트완료`는 본편 대기 안내만 표시하며 보상을 다시 지급하지 않는다.
- 기존 `/퀘스트완료` 일일 보상 명령은 `/일퀘완료`로 변경했고 `/ㅇ`, `/ㅇㅇㅇ`, `ㅎㅎㅎ` 별칭은 유지한다.

## Related Commands

- `/모험가퀘스트`, `/퀘스트완료`, `/퀘스트기록`
- `/퀘스트타이틀`, `/퀘스트타이틀장착 [번호]`, `/퀘스트타이틀제거`
- `/레벨`, `/일퀘완료`

---

# /모험시작 · /호여!!

Status: VERIFIED

## Files

- `main.js`
- runtime `adventureOnboarding.json`

## Related Helpers

- `createAdventureOnboardingMemberState`
- `getAdventureOnboardingMemberState`
- `buildHoiWorldTermsMessage`
- `sanitizeAdventurePetName`
- `isAdventureReferralInputCandidate`
- `registerAdventureReferral`
- `skipAdventureReferral`
- `buildReferralRankingMessage`
- `applyAdventureStarterIntimacyReward`
- `applyAdventureStarterMemberRewards`
- `applyAdventureStarterPetSettings`
- `assignAdventureStarterPetAppearance`
- `applyAdventureStarterSkill`
- `applyAdventureStarterHome`

## Data Usage

- `adventureOnboarding.users[사용자]`: 캐릭터 생성 전 시작 선택 대기 상태
- `data.member[사용자].adventureOnboarding`: 캐릭터 생성 후 펫 이름·축복 적용·완료 단계
- `data.member[사용자].adventureOnboarding.receipts.referral`: 추천인 등록 또는 없음 선택의 1회 영수증
- `data.member[추천인].referralCount`: 등록 완료된 누적 추천 인원
- `data.member[신규 유저·추천인].point`: 추천 등록 직후 양쪽 포인트 보상
- `petData[사용자].starterBlessingApplied`
- `petSkillData[사용자].starterBlessingApplied`
- `homeData[사용자].starterBlessingApplied`

## Save Flow

- `/모험시작`은 계정을 만들지 않고 시작 선택 상태만 저장한다.
- `호월 봇 이용약관`은 가입 단계와 회원 데이터에 영향을 주지 않고 이용약관만 출력한다.
- `다음에 한다`는 시작 선택 상태만 삭제하며 회원·펫·보상을 생성하지 않는다.
- `출발한다`는 회원을 생성하고 기존 미가입 출석을 이관한 뒤 펫 이름 입력 단계로 이동한다.
- 펫 이름 확정 시 이름을 정리·검사하고 `호월신의 축복✨(/호여!!)`을 1개만 지급한다.
- 새 가입자는 펫 이름 확정 후 추천인 입력 대기로 이동한다. 기존 펫 생성 안내 뒤 추천인 등록 안내를 출력하고, 등록 또는 `없음` 선택 후 기존 축복 안내를 출력한다. 기존 `WAIT_BLESSING` 계정은 진행 중인 단계를 유지한다.
- 추천 등록은 기존 닉네임과 본인 추천 여부, 포인트·횟수 범위를 먼저 확인한 뒤 신규 유저 1억·추천인 5억 포인트, 추천 횟수 +1, 가입 영수증을 같은 `member.json` 저장에 반영한다. 재입력에서는 중복 지급하지 않는다.
- `/추천인순위`는 본인의 누적 추천 인원·보상을 조회하고 추천 인원 내림차순으로 표시한다. 11위부터 `allsee` 아래에 출력하며 저장하지 않는다.
- `/호여!!`은 펫·펫스킬·펫홈별 완료 표시를 사용해 중단 후 재실행에도 완료 항목을 다시 지급하지 않는다. 신규 회원의 친밀도 Lv.300(+330,000💕)와 스타터 아이템 22종·300억 포인트·가호 30,000개를 각각 1회 지원한다. 기존 지급 완료·과거 퀘스트 지급자는 재지급하지 않는다.
- ver_2.653 `GLOBAL_CONFIG.adventureStarter.dollItems`의 이용권 20개·확률UP 50/40/30% 각 5개도 같은 최초 지급 영수증과 저장을 공유한다. 기존 지급자는 소급하지 않으며 실제 지급 시에만 별도 안내한다. 과거 스타터 회수 대상 17종은 유지한다.
- 펜던트 강화석📿 3개는 기존 17종과 함께 `memberRewards` 최초 지급 영수증 및 `member.json` 저장에 포함한다. 실제 최초 지급 성공 시에만 완료 안내에 표시하며 기존 지급자에게 소급하지 않는다.
- 신규 추가 지급은 `GLOBAL_CONFIG.adventureStarter.additionalItems`를 사용한다. 과거 퀘스트 스타터 회수는 기존 `items` 17종과 `legacyRecoveryBoosters` 1,000개 기준을 유지한다. Info의 과거 후보 조회도 1,000개이며 신규 가호 지급량과 분리한다.
- 2026-10-20 안내 간소화: `buildAdventureStarterCompleteMessage`는 축복 한 줄 직후 구분선, 펫정보·가방·레벨·가이드 안내만 표시한다. 기본 세팅·학개론·친밀도300·가호30000·스타터와 인형 아이템의 실제 지급·조건·영수증은 변경하지 않는다. 닉네임은 실제 대상이며 펫 이름·상세 지급 목록은 안내에서 생략한다.
- 정령 종료 이후 `applyStarterPet`은 정령 기본 지급·설정을 하지 않으며 다른 펫·미니펫·펜던트 스타터 보상은 유지한다.
- 신규 펫의 알 상태는 `/호여!!` 완료 시 기존 외형 목록의 땅·하늘 속성과 외형으로 확정해 `member_pet.json`에 저장한다. 이미 스타터 설정을 완료했지만 알 상태로 남은 펫은 해당 사용자의 다음 `main.js` 응답에서 한 번 보정·저장하며, 이후 조회에서는 다시 뽑지 않는다.
- `/모험가퀘스트` 최초 참여에서는 스타터팩을 지급하지 않는다. 과거 퀘스트 지급 기록이 있는 회원은 `/호여!!`에서 같은 스타터팩을 다시 지급하지 않는다.
- 기존 `/가입`은 `/모험시작` 변경 안내만 출력하며, `/펫생성`은 더 이상 스타터 세팅을 지급하지 않는다.

---

# ㅊㅊ

Status: VERIFIED

## Files

- `main.js`
- `data/attendanceLight.json`

## Related Helpers

- `recordLightAttendanceOnly`
- `migrateLightAttendanceToMember`
- `pruneLightAttendanceData`
- `resetLightAttendanceServerByShortName`
- `buildLightAttendanceServerResetMessage`
- `buildLightAttendanceCleanupMessage`
- `getServerShortName`
- `getAttendanceServerSortOrder`
- `compareLightAttendanceRows`
- `formatLightAttendanceServerName`
- `buildPendingUserIdCheckMessage`
- `formatPendingUserIdDateText`
- `formatPendingUserIdServerText`
- `normalizeMissingAttendanceSignupUserId`
- `buildMissingAttendanceSignupInvalidIdMessage`
- `buildMissingAttendanceSignupSuccessMessage`
- `validateSignupNickname`
- `initializeMember`
- `applyAdventureExperienceBooster`
- `buildAdventureBoosterDepletionMessage`
- `saveJsonFile`
- `loadJsonFile`

## Data Usage

- `data.attend_list`
- `data.member[sender].cnt`
- `data.member[sender].today`
- `data.member[sender].recent`
- `data.member[sender].server`
- `attendanceLightData.users[sender]`
- `attendanceLightData.users[sender].server`

## Save Flow

- Existing member attendance continues to update normal member data
- Users missing from `data.member` return before game-account creation unless they use the explicit `/모험시작` flow. Ordinary group chat with a valid `이름 남/여` ID records only the recognition date in `attendanceLight.json`, without attendance count or rewards, so search-authentication management can find the user.
- Unregistered users using `ㅊㅊ` create or update a lightweight `attendanceLight.json` row, including first-known server info when the room is mapped
- `/모험시작` validates the Kakao sender nickname before saving the start state; `출발한다` creates the member and migrates any older light-attendance row
- Registered-user attendance adds the current tier's fixed EXP to the 100 base EXP, applies `호월신의 가호✨` to that subtotal, reports the basic/tier/booster breakdown, and uses the common depletion message when the count reaches zero
- `/미가입출첵` deletes light rows when the exact stored user ID already joined or neither attendance nor recognized general chat occurred for 4+ days. Joined rows transfer search-authentication status to the member before removal, without another reward. It reports automatic-deletion and remaining rows as `server short label / user name`, keeps unknown server values as `미확인`, sorts rows by latest activity date, then server order (`호1` through `호7` then `벨`), then name. Member changes and the light-data snapshot are saved in the existing transaction.

## Related Commands

- `/미가입출첵`
- `/미가입출첵서버초기화 [호1-호7|벨1-벨2|GM|서버장]`
- `/미출석가입 [아이디]`
- `/미정 [이름]`

## AI Notes

- `attendanceLightPath` is a lightweight operational snapshot for attendance-only pre-signup users; do not create rows from commands other than `ㅊㅊ`
- 신규 `/모험시작` 닉네임은 `두 글자 이상 이름 + 공백 + 남/여` 형식이어야 한다.
- `/미가입출첵` must not backfill missing server values from the command room because that can mislabel old rows as the room server.
- `/미가입출첵서버초기화 호1` clears the stored server value for currently `호1`-displayed light rows so they become `미확인`; use only when the server was contaminated and no backup/manual edit is available.
- Do not hide `loadJsonFile` parse failures; only missing/null light data falls back to `{ users: {} }`

---

# /미정 [이름]

Status: VERIFIED

## Files

- `main.js`
- `data/attendanceLight.json`

## Related Helpers

- `buildPendingUserIdCheckMessage`
- `collectPendingUserIdMatches`
- `normalizePendingUserIdBaseName`
- `formatPendingUserIdDateText`
- `formatPendingUserIdServerText`
- `formatPendingUserIdDateValue`
- `loadJsonFile`

## Data Usage

- `data.member[*]` where the stored user ID matches the requested base name after removing a trailing `남`/`여`
- `attendanceLightData.users[*]` where the stored user ID matches the requested base name after removing a trailing `남`/`여`
- `data.member[*].server`
- `attendanceLightData.users[*].server`

## Save Flow

- No save; reads `attendanceLight.json` and member data only

## Related Commands

- `/미가입출첵`
- `/정보 [닉네임]`

## AI Notes

- Admin/Master-only HOTFIX command for checking whether a base name can be used as 신규 아이디.
- Accepted as `/미정` for usage guidance or `/미정 [이름]` for lookup.
- The command searches regular member data and 미가입 출첵 light data by base name, excluding the trailing gender token from stored user IDs.
- The command displays stored server info for joined users and light-attendance rows, or `(서버정보 없음)` when the row has no server.

---

# /미출석가입 [아이디]

Status: VERIFIED

## Files

- `main.js`
- `data/attendanceLight.json`
- `data/hoiBotChangeLog.json`

## Related Helpers

- `normalizeMissingAttendanceSignupUserId`
- `buildMissingAttendanceSignupInvalidIdMessage`
- `buildMissingAttendanceSignupSuccessMessage`
- `initializeMember`
- `initPetSkillUser`
- `saveJsonFile`
- `loadJsonFile`

## Data Usage

- `data.member[아이디]`
- `petData[아이디]`
- `petSkillData[아이디]`
- `member_title.member[아이디]`
- `attendanceLightData.users[아이디]`

## Save Flow

- Admin/Master-only command.
- Accepts `/미출석가입 [아이디]` only when the ID normalizes to `이름 남` or `이름 여`.
- Invalid IDs reply with usage guidance and return before creating member, pet, title, pet-skill, or light-attendance data.
- Valid new IDs call `initializeMember`, initialize pet-skill data, save `petSkillData`, transfer an existing search-authentication status/record without another reward, and remove an exact matching `attendanceLight.json` row using snapshot storage when it exists. Forced signup keeps its existing policy of not migrating light attendance counts.

## Related Commands

- `/가입`
- `/미가입출첵`
- `/미정 [이름]`

## AI Notes

- Do not broaden the guard with `startsWith`; malformed `/미출석가입` suffixes should fall into validation and must not create data.
- Existing historical member IDs are not normalized or deleted by this command.

---

# /글자수전체정리

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `cleanAllPendantBags`
- `cleanAllMiniPetBags`
- `cleanAllFurnitureBags`
- `countAllMiniPetBagItems`
- `countAllFurnitureBagItems`
- `buildTextLengthCleanupMessage`

## Data Usage

- `petData[*].miniPetBag`
- `homeData[*].furnitureBag`
- `petData[*].pendantBag`

## Save Flow

- Master 또는 `호이월드 GM 관리자방`의 Admin·`오픈채팅봇`이 실행하는 통합 정리 명령이다.
- 정확한 `/글자수전체정리` 직접 입력은 확인 메뉴 없이 즉시 실행한다. 권한별 `/초기화` 메뉴의 `[정리] 글자수 전체 정리` 선택 → 범위 확인 → `1삭제` 경로도 같은 실행 분기로 연결한다. 메뉴의 `2취소`·만료·권한 상실 시 정리하지 않는다. 안내 문구가 붙은 접미사 입력은 즉시 실행하지 않는다.
- 미니펫·가구 가방은 일반 10개, 호이패스 프리미엄 15개 한도만 남기고 초과분을 삭제한다.
- 펜던트는 기존 등급·이름 정렬 후 50개를 남기며, 모든 정리는 장착 데이터와 재화를 보존한다.
- 미니펫 또는 펜던트 정리 결과가 있으면 `member_pet.json`을, 가구 정리 결과가 있으면 `petSweetHomeData.json`을 저장한다.

## Related Commands

- `/미니펫전체정리`
- `/가구전체정리`
- `/펜던트전체정리`

## AI Notes

- 정리 전후 실제 감소량과 각 정리 함수가 보고한 삭제량이 다르면 저장을 중단하고 오류 로그를 남긴다.

---

# /매력버프체크 [닉네임]

Status: VERIFIED

## Files

- `main.js`

## Related Helpers

- `buildCharmBuffDebugMessage`
- `buildTotalExpTimeCheckDetail` (퍼센트 적용 전 실제 합계·상세 항목)
- `getHomeBadgeCubeOptionDebugDetail`
- `formatHomeBadgeCubeDebugOptionFormula`
- `calculateCastleExp`
- `calculateRaidExp`
- `calculateTotalExp`
- `calculateEffectivePetUpgradeLevel`
- `getGuildContributionCubeMemberPercent`

## Data Usage

- `member.json -> member[user].pass.premium`
- `member.json -> member[user].homeBadgeCube`
- `member.json -> member[user].adventureQuest.totals` (캐슬·레이드 퀘스트 보너스)
- `member.json -> matzangField.participants[user].totalExp`
- `member_pet.json -> [user]`
- `homeData.json -> [user]`
- `guildData.json -> guilds[*].cubeOptions`
- `guildData.json -> territoryWar.castleExpSnapshots[user]`

## Save Flow

- 읽기 전용이며 홈 데이터만 명령 분기에서 한 번 추가 로드한다.

## AI Notes

- `/디버깅모드`가 ON일 때 지정한 닉네임 또는 명령 실행자의 봇 버전·기본 매력 구성·홈뱃지·길드·모험가 레벨·퀘스트 보너스와 최종 캐슬·레이드·종합매력 계산 일치 여부를 `팻 테스트방`에 출력한다.
- 기본 매력은 보너스가 붙은 최종값을 역산하지 않고 `buildTotalExpTimeCheckDetail`의 퍼센트 적용 전 구성 합계를 사용한다. 정령·반지·펜던트·가방, 펫, 대표·보조 미니펫, 가구, 펫스킬, 캐슬 친밀도 등을 계산 시간과 무관하게 표시한다.
- 레벨은 0.01%, 퀘스트와 합산 비율은 0.001% 단위까지 표시하며 `내림(기본 × (1 + 합산 비율 / 100))`을 공용 계산값과 비교한다. 실제 매력 계산·재화·장착·보상 정책은 바꾸지 않는다.
- `/펫정보`, `/종합순위`, `/캐슬대전`, `/시련의탑`은 현재 공용 계산값을 사용한다. 맞짱필드는 참여 시점 종합매력 스냅샷과 전투 시점의 현재 유효 펫강화 치명타를 함께 사용하고, 길드영지전은 시작 시점 캐슬매력·치명타 스냅샷을 사용하므로 현재값과 차이가 날 수 있다.
- 맞짱필드 진행 중에는 권한이 있는 운영자가 진단할 수 있다. 길드영지전 중에는 진단 명령도 공통 허용 목록에 따라 차단한다.

---

# 펜던트 콘텐츠

Status: VERIFIED

## Files

- `main.js`
- `Info.js`
- `data/hoiBotChangeLog.json`

## Commands

- `/펜던트오픈 [갯수]`
- `/펜던트확률`
- `/펜던트가방`
- `/펜던트순위`
- `/펜던트정보 [펜던트가방번호]`
- `/펜던트장착 [펜던트가방번호]`
- `장착할래`
- `생각해볼게`
- `/펜던트해제`
- `/펜던트복원 [펜던트가방번호]`
- `/펜던트강화 [펜던트가방번호]`
- `/펜던트승급 [펜던트가방번호]`
- `승급할거임` / `쫄아뜸`
- `/펜던트판매 [펜던트가방번호]`
- `/펜던트가방정리 시작번호~끝번호`
- `/펜던트조합창세 [펜던트가방번호] [펜던트가방번호] [펜던트가방번호] [펜던트가방번호] [펜던트가방번호] [펜던트가방번호]`
- `/펜던트조합창조 [펜던트가방번호] [펜던트가방번호] [펜던트가방번호]`
- `/펜던트전체정리`
- `/펜던트당근 유저명 번호`
- `/펜던트거래등록 번호 판매금액`
- `/펜던트거래정보 [자유시장번호]`
- `/펜던트추가`, `/펜던트삭제`, `/펜던트장착초기화`, `/펜던트강화수정`, `/펜던트내구도수정`

## Related Helpers

- `ensurePendantUser`
- `getPendantBag`
- `pickRandomPendant`
- `formatPendantDisplay`
- `formatPendantNameWithIcon`
- `formatPendantOpenResultDisplay`
- `formatSimpleRankPrefix`
- `buildPendantInfoDetailMessage`
- `formatPendantPercent`
- `sortPendantBagByGrade`
- `calculatePendantStats`
- `buildPendantRankingRows`
- `buildPendantRankingMessage`
- `calculatePendantItemInfo`
- `getPendantExploreBonusPercent`
- `runPendantOpen`
- `setPendantEquipState`
- `getPendantEquipState`
- `clearPendantEquipState`
- `buildPendantEquipConfirmMessage`
- `equipPendantFromBag`
- `unequipPendantToBag`
- `restorePendantDurability`
- `getPendantUpgradePetSkillBonusRate`
- `formatPendantUpgradeRateLine`
- `buildPendantUpgradePreview`
- `runPendantUpgradeFromState`
- `ensurePendantIdsForUser`
- `calculatePendantPromotionPointDeduction`
- `buildPendantPromotionPreview`
- `runPendantPromotionFromState`
- `registerPendantFreeMarket`
- `buildPendantTradeInfoMessage`
- `cleanAllPendantBags`
- `buildPendantGenesisCombinationGuide`
- `buildPendantCreationCombinationGuide`
- `isDuplicatePendantCombination`
- `markPendantCombination`
- `combineGenesisPendant`
- `combineCreationPendant`

## Data Usage

- `petData[user].pendant`
- `petData[user].pendantBag`
- `userState[user].pendantEquip`
- `userState[user].pendantPromotion`
- `petData[user].pendant.pendantId`, `promotionLevel`, `promotionUpdatedAt`
- `petData[user].pendantBag[*].pendantId`, `promotionLevel`
- `petSkillData[user].petSkills.equipped`
- `data.member[user].bag`
- `data.member[user].point`
- `freeMarketData.listings[*].type = "pendant"`

## Save Flow

- 펜던트 장착/관리/강화/거래는 `petData`를 저장한다.
- 장착 펜던트가 이미 있는 `/펜던트장착 [번호]`는 `userState[user].pendantEquip`에 확인 대기를 저장하고, `장착할래` 확정 시 기존 장착 펜던트를 소멸시키고 선택한 가방 펜던트를 장착한 뒤 `petData`를 저장한다.
- 펜던트 오픈, 해제, 복원, 판매, 당근거래, 자유시장 등록/구매/취소는 필요 시 `data`와 `petData`를 함께 저장한다.
- `/펜던트승급`은 기존 펜던트 ID를 먼저 보완 저장하고, 30초 확인 후 회원 포인트·펜던트 강화석과 펫 데이터를 함께 변경한다. 두 파일 중 하나라도 저장에 실패하면 사용자 단위 스냅샷으로 양쪽을 복원하며 전체알림은 두 저장 성공 후에만 보낸다.
- 안전 정수 상한을 넘은 기존 포인트 잔액도 승급 비용이 정확히 차감되는 경우에는 허용하고, 실제 차감액이 비용과 달라지는 정밀도 구간은 변경 전에 차단한다.
- 자유시장 펜던트 등록/취소/구매는 `freeMarketData`도 저장한다.
- `/펜던트전체정리`는 `petData[user].pendantBag`에서 51개 이상인 가방의 초과분을 삭제한 뒤 `member_pet.json`을 저장한다.
- `/펜던트조합창세`는 선택한 초월 펜던트 6개를 모두 검증한 뒤 가방에서 제거하고 기본 창세 펜던트 1개를 추가해 `member_pet.json`을 저장한다.
- `/펜던트조합창조`는 선택한 창세 펜던트 3개를 모두 검증한 뒤 가방에서 제거하고 기본 창조 펜던트 1개를 추가해 `member_pet.json`을 저장한다. 두 조합 모두 저장 성공 뒤에만 완료 응답을 보내며 동일 요청의 즉시 중복 처리를 막는다.

## AI Notes

- `/펜던트오픈`은 운영 제한 없이 사용할 수 있다.
- `/펜던트장착 [번호]`는 장착 펜던트가 없으면 즉시 장착하고, 이미 장착 중이면 `장착할래` / `생각해볼게` 확인 단계를 거친다.
- `/펜던트오픈` 결과 목록은 등급 내림차순으로 정렬하고 번호와 각 펜던트의 뽑기 확률을 함께 표시한다.
- `/펜던트오픈` 결과는 5번째 항목부터 `allsee` 뒤에 표시한다.
- `/펜던트오픈` 전체알림은 신화 이상 펜던트마다 1개씩 송출하고, 창세/창조처럼 1% 미만인 획득 확률도 소수점으로 보존해 함께 표시한다. 최상급+ `심판의 펜던트`는 전체알림에서 제외한다.
- `/펜던트오픈`은 펜던트가방이 이미 50/50일 때만 막고, 49/50 이하에서는 보유한 펜던트뽑기 수량만큼 오픈할 수 있다.
- `/펜던트당근거래`는 기존 호환 별칭이며, 안내 문구와 문서 기준 명령어는 `/펜던트당근`이다.
- `/펜던트가방`은 창조 → 창세 → 초월 → 신화 → 최상급+ → 최상급 → 상급+ → 상급 → 중급+ → 중급 → 하급+ → 하급 → 최하급 순으로 정렬하고, 같은 등급 안에서는 이름 가나다순으로 표시한다.
- `/펜던트가방`은 1~5번까지 먼저 보여주고 6번 이후는 `allsee` 뒤에 표시한다.
- `/펜던트조합창세`는 서로 다른 양의 가방 번호 6개를 받고 가방의 초월 펜던트를 강화 수치와 관계없이 재료로 사용한다. 포인트와 다른 아이템은 소모하지 않고 100% 확률로 기본 창세 펜던트 1개를 가방에 넣는다.
- `/펜던트조합창조`는 서로 다른 양의 가방 번호 3개를 받고 가방의 창세 펜던트를 강화·승급 수치와 관계없이 재료로 사용한다. 포인트와 다른 아이템은 소모하지 않고 100% 확률로 기본 창조 펜던트 1개를 가방에 넣는다.
- `/펜던트순위`는 장착 펜던트만 대상으로 등급 → 강화수치 → 닉네임 가나다순으로 100명까지 표시하고, 11등부터 `allsee` 뒤에 표시한다.
- `/펜던트강화`는 펜던트가방 번호를 입력하며, 장착 펜던트는 숫자 `0`으로 강화한다.
- `/펜던트승급`은 창조등급만 대상으로 하며 장착 펜던트는 `0`으로 선택한다. 목표 ★N 단계마다 다른 가방 창조 펜던트 1개, 펜던트 강화석 `N×10`개, 포인트 `N×100억`을 사용하고 100% 성공한다. 승급 1단계당 종합매력만 500만 증가하며 탐험 확률·강화·내구도는 유지한다. `/펫정보`의 기존 `펜던트💎:` 행에 `이름🪬[창조★N][⚒️현재/최대](+강화)` 형식으로 승급 단계를 표시하고 실제 캐슬·레이드 매력에도 승급 수치를 반영한다. 재료는 승급→강화→내구도→가방 번호 오름차순으로 자동 선택하고 확인 후에는 고유 `pendantId`로 같은 본체와 재료를 재검증한다.
- 승급 조건 부족 화면은 다른 창조 펜던트, 포인트, 강화석 중 실제 충족하지 못한 항목만 구분해 표시한다.
- `/펜던트거래정보 [자유시장번호]`는 자유시장 등록 목록의 펜던트 payload를 기존 펜던트 정보 형식으로 보여준다.
- 펜던트 이름 끝에 이미 같은 이모지가 있으면 `formatPendantNameWithIcon`이 표시 이모지를 중복으로 붙이지 않는다.
- 펜던트 종합매력은 레이드/캐슬 매력에 절반씩 분배된다.
- 펜던트 펫탐험 성공률 보너스는 펫탐험 정산과 확률 표시 공용 계산에 반영된다.
- `결혼못한 대장장이📙` 펫스킬북을 장착하면 `/펜던트강화` 미리보기와 실제 강화 판정에 성공 확률 +1%가 함께 반영된다.

---

# /선물삭제

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/선물삭제`

## Files

- `main.js`

## Related Helpers

- `getHoiFreeSupportPackageVariant`
- `removeAllHoiFreeSupportPackages`

## Data Usage

- `data.member[*].bag["호이응원패키지(무료)🐹[1]" ... "호이응원패키지(무료)🐹[10]"]`

## Save Flow

- Admin/Master exact command; removes matching entries from the already-loaded member data and saves `filePath` once.

## AI Notes

- `/선물삭제` accepts no arguments; suffix text such as `/선물삭제 해봐` does not execute.
- All users are scanned, and only canonical variants `[1]` through `[10]` are removed.

---

# /선물전달|/프리미엄전달

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `/선물전달`, `/프리미엄전달`

## Files

- `main.js`

## Related Helpers

- `addItem`
- `getActiveSupportPassUsers`
- `numberWithCommas`

## Data Usage

- `data.member[*].bag[입력한 아이템이름]`
- `data.member[*].pass.premium`

## Save Flow

- `/선물전달 아이템이름/갯수`는 전체 가입자의 가방에 입력 아이템을 지급한 뒤 `filePath`를 한 번 저장한다.
- `/프리미엄전달 아이템이름/갯수`는 현재 활성 호이패스 프리미엄 이용자만 선별해 입력 아이템을 지급한 뒤 `filePath`를 한 번 저장한다.

## AI Notes

- 사용 권한은 `호이 남`으로 유지한다.
- 인자 없는 `/선물전달`은 사용법만 출력하며 지급하지 않는다.
- 인자 없는 `/프리미엄전달`도 사용법만 출력하며 지급하지 않는다.
- 아이템명 내부의 `/관련명령어` 표기는 유지하고 마지막 `/숫자`만 지급 수량으로 분리한다.
- 두 명령 모두 지급 완료 후 `noticeMsg`로 전체 공지를 보내고, 명령어를 실행한 채팅방에는 지급 대상 인원을 포함한 완료 메시지를 한 번 별도로 출력한다.
- 전체 공지는 `🎁 호이가 여러분의 주머니에`로 시작하는 선물 안내 문구와 실제 지급 아이템·수량, `/패키지가방 을 확인해주세요.` 안내를 함께 표시한다.
- `호이의 봉인금고🔒(/봉인금고오픈 숫자)`처럼 명령어 표기가 포함된 공식 아이템명도 그대로 지급할 수 있다.
- `/프리미엄전달`은 활성 프리미엄 이용자가 없으면 지급·저장·전체 공지를 실행하지 않는다.
- 프리미엄 지급 완료 공지는 `noticeMsg`로 호이패스 프리미엄 전용 문구와 실제 지급 아이템·수량, `/패키지가방` 확인 안내까지만 표시한다.

---

# /입찰 [아이템번호] [포인트]

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `msg === "/입찰" || /^\/입찰\s+\d+\s+\d+$/.test(msg)`

## Files

- `main.js`

## Related Helpers

- `hasPetSkill`
- `checkRank`
- `numberWithCommas`
- `saveJsonFile`

## Data Usage

- `data.auction[*].highestBid`: 화면 표시와 최고 입찰 판정에 사용하는 할인 전 금액
- `data.auction[*].highestBidCost`: 최고 입찰자의 실제 차감액과 재입찰 환급액
- `data.auction[*].highestBidder`
- `data.member[sender].point`
- `petSkillData[sender].petSkills.equipped`

## Save Flow

- 정상 입찰 시 할인 적용 여부에 따라 입찰 포인트와 수수료를 차감하고 경매 최고 입찰 정보를 갱신한 뒤 응답 마지막의 `saveJsonFile(data, filePath)`로 저장한다.
- 기존 최고 입찰자가 밀리면 `highestBidCost`를 환급하며, 이 필드가 없는 기존 경매 데이터는 `highestBid`를 환급한다.

## Related Commands

- `/호이상점`
- `/경매등록 [아이템명] [분]`
- `/경매마감 [경매등록번호]`
- `/펫스킬정보 입찰의 귀재`

## AI Notes

- `입찰의 귀재📙[한정판]`를 현재 장착한 입찰자는 입찰 금액의 10%를 반올림해 할인받는다.
- 최고 입찰가 표시와 상위 입찰 판정에는 할인 전 금액을 사용하고, 잔액 확인·차감·재입찰 환급에는 실제 차감액을 사용한다.
- 할인 적용 시에만 기존 경매 안내 아래에 할인 적용 문구와 실제 소모 포인트를 추가한다.
- 입찰 수수료 🅟700,000은 할인하지 않는다.

---

# /기도

Status: VERIFIED

## Command Anchors

- Search in `main.js`: `msg === "/기도"`

## Files

- `main.js`

## Related Helpers

- `getEquippedPrayerSkillName`
- `getPrayerSkillConfig`
- `buildPrayerResultMessage`
- `buildPrayerSkillEquipMessage`
- `buildPrayerSkillInfoMessage`
- `checkRank`
- `addItem`
- `saveJsonFile`

## Data Usage

- `petSkillData[sender].petSkills.equipped`
- `data.member[sender].isGidoFlag`
- `data.member[sender].bag["주간상자🌼"]`

## Save Flow

- 정상 사용 시 성공·실패와 관계없이 일일 사용 기록을 남기고, 성공 시에만 주간상자🌼 1개를 추가한 뒤 `saveJsonFile(data, filePath)`로 한 번 저장한다.
- `/기도`는 단독 데이터 변경 잠금을 사용하며, 저장 실패 시 메모리의 일일 기록과 보상 수량을 복구하고 오류 안내를 표시한다.
- `/리셋`에서 모든 회원의 기도 일일 사용 기록을 제거한다.

## Related Commands

- `/펫스킬장착 [번호]`
- `/펫스킬정보 [스킬이름]`
- `/펫스킬확률`
- `/리셋`

## AI Notes

- `기도📙[C]`, `신성한 기도📙[A]`, `호월신의 총애📙[S]` 중 하나를 장착해야 하며 응답 확률은 각각 3%, 5%, 7%다.
- 세 스킬은 서로 중복 장착할 수 없고, 장착 차단은 가방의 스킬북을 소모하기 전에 처리한다.
- 결과는 장착 스킬과 성공 여부별 10개 멘트 중 하나를 사용하며 실제 채크랭크를 표시한다.

---


---

# /레벨 · /레벨순위 · 레벨 리뉴얼 전환

Status: VERIFIED

## Command Anchors

- `Info.js`: `/레벨`
- `main.js`: `/레벨순위`, `/레벨수정 [아이디] [레벨]`, `/경험치수정 [아이디] [경험치]`, `/레벨초기화`, `/레벨리뉴얼점검`, `/레벨리뉴얼적용`, `/환생회수`, `/호여 [숫자]`

## Related Helpers

- `getLevelRequiredExperience`
- `getAdventureLevelTitle`
- `getAdventurePromotionCounts`
- `getAdventureLevelCharmPercent`
- `applyAdventureExperienceBooster`
- `formatAdventureLevelEditDifference`
- `buildAdventureLevelEditMessage`
- `buildAdventureExperienceEditMessage`
- `applyPercentWithExactFloor`
- `removePercentWithExactCeil`
- `applyInfoPercentWithExactFloor`
- `processAdventureLevelUps`
- `inspectAdventureLevelRenewal`
- `isExactJsonSnapshot`
- `isAdventureLevelRenewalResultValid`
- `isRebirthMushroomRecallResultValid`
- `applyAdventureLevelRenewal`
- `applyRebirthMushroomRecall`

## Data Usage

- `data.member[user].lv`, `exp`, `tierExperienceRemainder`, `point`, `boostercnt`, `bag`
- `data.migrations.adventurerLevelRenewal20260915`
- `data.migrations.rebirthMushroomRecall20260915`

## Save Flow

- 일반 채팅을 제외한 정상 경험치 지급은 기본 EXP에 현재 티어의 고정 EXP를 한 번 더한 뒤 가호를 적용하고, 최종 EXP를 한 번만 누적한다. 초과 경험치를 유지하며 여러 레벨을 연속 처리하고 레벨당 1,000만 포인트를 지급한다.
- 일반 채팅은 기본 1 EXP에만 가호를 적용하고 티어 보너스를 지급하지 않는다. 출석·캐슬대전·미니펫대전·일일/주간/프리미엄 퀘스트·펫탐험은 기본+티어 합계의 최대 2배를 가호 추가 EXP로 지급해 총 3배까지 적용한다. 가호는 실제 추가 EXP와 1:1로 차감하고 부족하면 남은 수량만큼만 부분 적용한다. 소진 안내에는 후원 링크를 표시하지 않는다.
- 출석 후 채팅으로 실제 지급한 기본·가호 EXP는 계정별 한국시간 하루 1,000 EXP까지만 `member.chatExperienceDaily`에 누적한다. 경계에서는 남은 EXP만 지급하고 그에 해당하는 가호만 차감하며, 한도 도달 안내는 하루 한 번 출력한다. 이전 500 EXP 한도에서 저장된 알림 상태는 현재 누적량이 1,000 미만이면 다음 채팅에서 해제해 새 한도 도달 알림을 허용한다. 출석과 다른 활동의 EXP는 이 누적값에 포함하지 않는다.
- 레벨업 알림 전 `member.json`을 저장한다.
- 일반 레벨업 알림은 다음 10레벨 단위 승급까지 남은 레벨을 표시하고, 상세에서는 기본·승급·대승급 증가분을 구분한다.
- 레벨업 알림은 한 번에 여러 레벨과 승급을 통과해도 모든 처리가 끝난 실제 현재 레벨과 칭호를 상단에 표시한다. 현재 레벨과 칭호 사이에는 빈 줄을 두고, `📋 이번 레벨업 상세` 제목까지 기본 화면에 표시한 뒤 상세 행부터 `allsee`로 접는다.
- `/레벨`은 채크랭크, 현재 칭호와 전체 승급 차수, 레벨·게이지·EXP와 소수 셋째 자리 진행률, 가호 수량, 캐슬·레이드 보너스, 다음 승급과 대승급까지 남은 레벨을 한 화면에 표시한다.
- `/레벨`의 캐슬·레이드 누적 보너스는 소수 셋째 자리에서 반올림해 둘째 자리까지 보존하고, 끝의 불필요한 0은 표시하지 않는다. 예: `1.20% → 1.2%`, `1.85% → 1.85%`.
- `/레벨수정 [아이디] [레벨]`은 `호이 남`만 실행할 수 있다. 대상의 레벨만 정확히 변경하고 기존 EXP·티어 경험치 잔여값을 유지한 채 저장을 재검증하며, 레벨·칭호·전체/일반/대승급·필요 EXP·캐슬/레이드 보너스의 전후 값과 상승·하락 수치를 표시한다.
- `/경험치수정 [아이디] [경험치]`는 `호이 남`만 실행할 수 있다. 현재 레벨의 EXP를 입력값으로 바꾸고 기준치를 넘으면 실제 다중 레벨업과 레벨당 포인트 보상을 처리한다. 저장된 계정 전체를 다시 읽어 검증하며 기존·입력·최종 EXP, 레벨, 레벨업 횟수, 포인트 변동과 레벨업 알림을 표시한다.
- `/호여 [숫자]`는 가방의 `호월신의 가호✨(/호여 숫자)` 아이템을 입력 수량만큼 사용하고 같은 수량을 호월신의 가호 보유량에 더한다. 수량 부족과 0 입력은 변경 전에 차단하고, 아이템 차감과 가호 증가를 `member.json`에 함께 저장한다.
- `/레벨초기화`는 `호이 남`만 실행할 수 있는 반복 실행 명령이다. `/레벨리뉴얼점검` → `/레벨리뉴얼적용` 후 기능 테스트를 마친 상태에서 실행하며, 전체 계정의 Lv·EXP·티어 EXP 잔여값·가호·구 환생 기록을 다시 0 기준으로 정리한다. 기존 포인트·아이템과 리뉴얼 보상은 유지하고 보상을 재지급하지 않으며, 실행마다 고유 원본 백업을 저장·검증하고 실행 이력을 누적한다.
- `/레벨리뉴얼점검`은 가호 10만회 이상 계정 스냅샷을 별도 JSON으로 저장·재검증하고, 환생버섯 환급 후 포인트가 JavaScript 안전 정수 범위를 넘는 계정도 집계한다. 보상 포인트는 지급하지 않으며 레벨 전환 완료 후에는 기준 스냅샷을 다시 생성하지 않는다.
- `/레벨리뉴얼적용`은 현재 가호 보유 현황과 직전 스냅샷의 일치를 확인한 다음, 원본 전체 데이터가 백업과 완전히 일치하는지 검증해 Lv.1·EXP 0·환생 기록 0으로 전환한다. 개편 직전 가호 10만회 이상 계정에는 1,000억 포인트를 한 번 지급하고 전체 계정의 기존 가호를 0회로 초기화하며, 저장 후 대상별 지급액·초기화·환생버섯 보존값을 다시 검증한다.
- `/환생회수`는 레벨 리뉴얼 전환이 완료되고 환급 정밀도 위험 계정이 없을 때만 실행된다. 별도 원본 전체 백업을 검증한 후 환생버섯을 전량 회수하고 개당 30억 포인트를 환급하며, 저장 후 계정별 지급액·회수량·1회 실행 표식을 다시 검증한다.

## AI Notes

- 필요 경험치: `1000 + (현재 레벨 - 1) × 1000`, 즉 현재 레벨 × 1000 EXP.
- `/레벨` 하단 안내는 진행 안내 → 전체 기록 → `👉 타이틀 장착 /퀘스트타이틀` 순서이며 전체보기 앞에 표시한다. 타이틀 목록에서 `/퀘스트타이틀장착 [번호]`로 장착한다.
- 캐슬·레이드 각각의 레벨 보너스: `(레벨 - 1) × 0.15% + 일반 승급 × 0.5% + 대승급 × 5%`.
- 캐슬·레이드 보너스 적용은 0.01% 정수 단위로 계산해 경계값의 부동소수점 내림 오차를 방지한다.
- `/매력버프체크`의 계산 검증은 실제 기본 구성 합계에 모험가 레벨·퀘스트·홈뱃지·길드큐브 비율을 같은 가산식으로 합산한다. 퀘스트가 붙은 값을 기본값으로 역산하지 않는다.
- 10레벨마다 승급, 100레벨마다 대승급하며 1000레벨 이후에는 마지막 칭호를 유지하고 보상 주기는 계속된다.
- `/레벨순위`는 본인의 레벨·전체 순위·전체 계정 수와 바로 위 고유 순위의 레벨 또는 EXP 차이를 상단에 표시한다. 단독 1위는 현재 레벨 이전의 필요 EXP까지 합산한 누적 EXP로 2위와의 차이를 표시하고, 공동 1위는 차이 0으로 표시한다. 목록은 레벨 내림차순, 동률이면 EXP 내림차순으로 정렬하며 `1, 1, 3` 공동순위와 TOP 50을 유지한다. 상위 5명은 기본 화면에, 6번째부터는 `allsee` 뒤에 표시하고 본인이 TOP 50 밖이어도 상단의 내 순위는 유지한다.
- 모험가 EXP의 계산·저장 정밀도는 유지하고 `/레벨`, 종합정보, 프리미엄 가방, 대전·탐험·출석·퀘스트·자동일퀘 결과, 관리자 수정 결과와 `/레벨순위`의 EXP 표시는 소수부를 제거한다. 자동일퀘 합계는 화면 문자열이 아니라 실제 지급값을 집계한다.
- 기존 `/환생`, `/레벨리셋`, `/누렙순위` 및 특수 레벨업 보상은 제거됐다.

---

# /인증필요 · /미정 [이름] · /정보 [유저명] · /기록 [내용] · /기록실

Status: VERIFIED

## Files

- `main.js`
- `Info.js`

## Related Helpers

- `isAdminIdentity`
- `isMasterIdentity`
- `isGlobalOperatorCommandAllowed`
- `isGlobalInfoCommandAllowed`

## AI Notes

- `/인증필요`는 기존 Admin 권한을 유지하며 채팅방과 길드 영지전·펫무쌍·맞짱필드 진행 여부에 관계없이 사용할 수 있다.
- `/미정 [이름]`과 `/정보 [유저명]`은 기존 Admin/Master 권한을 유지하며 모든 방에서 사용할 수 있다. 길드영지전 진행 중에는 역할과 무관하게 공통 진입부에서 차단한다.
- `/정보`는 권한이 확인된 경우 1:1톡 패스·이벤트 제한을 통과하며, 일반 사용자의 기존 제한은 유지한다.
- `/기록 [내용]`과 `/기록실`은 기존 Admin/Master 권한을 유지하며 모든 방과 이벤트 진행 중에 사용할 수 있다. 길드영지전 진행 중에는 공통 허용 목록이 우선한다.
- `/기록` 등록은 정확한 명령 형식만 허용해 `/기록삭제` 등 다른 기록 관리 명령과 충돌하지 않는다.
- 2026-10-20 기록실 이관: 부팅 시 기존 `board.record` 전체를 같은 JSON의 `recordArchive1.records`에 깊은 복사하고 현재 기록을 비운다. `prepareRecordRoomArchive`는 순수 변경·검증 함수이며 기존 보관소가 있으면 새 기록을 다시 초기화하지 않는다. `board.json`·`board_back.json`·`board_back2.json`은 기존 검증 저장·백업·명령 롤백 대상이다. 파일 교체 사이 중단으로 원본이 없고 `.rollback`이 있을 때만 부팅/첫 DEV 기록 요청에서 원문 검증 후 이름을 복구한다. 누락·손상 원본을 빈 데이터로 바꾸지 않는다.
- `/기록보관소1 [페이지]`는 Admin/Master 신원 권한으로 모든 방에서 기존 기록실과 같은 이벤트 예외로 조회한다. 생략은1, 페이지당20건이며 원래 순번·내용·날짜·중요 표시를 보존한다. `/기록실`·`/기록`·`/기록삭제 [번호]`·`/빌런 [번호]`은 현재 기록만 조회/변경한다. 숫자 뒤 설명 문구는 실행하지 않는다. 일반 계산 헬퍼에는 파일 IO가 없으며 명령 진입에서 한 번 로드한다.
- 검증: `tools/test_oct20_ready.js`의 전체 페이지·이관/반복/저장 실패/복구/DEV·권한 조건 비교와 `tools/test_oct20_rhino.js`의 실제 Java 파일 저장·백업·새 전역 스코프 복원. 원본 데이터 스냅샷은 테스트에서 수정하지 않는다.

---

# /펫스킬북보상

Status: VERIFIED

## Files

- `main.js`
- `data/hoiBotChangeLog.json`

## Related Helpers

- `isRetiredPetSkill`
- `ensurePetSkillRetirementCompensationLedger`
- `countRetiredPetSkillHoldings`
- `createPetSkillRetirementCompensationRecord`
- `removeRetiredPetSkillHoldings`
- `buildPetSkillRetirementCompensationResultMessage`

## Data Usage

- `petSkillData.json -> [user].petSkills.equipped`
- `petSkillData.json -> [user].petSkills.lockedPremium`
- `petSkillData.json -> [user].petSkills.bag`
- `member.json -> member[user].bag["펫스킬북📙(/펫스킬오픈)"]`
- `member.json -> petSkillRetirementCompensation.users[user]`

## Save Flow

- 전체 계정의 기존 `PENDING`·`SKILLS_REMOVED` 기록을 이어받아 메모리에서 회수와 보상을 계산하고 `COMPLETE`로 정리한다.
- 장착·프리미엄 잠금·가방 수량과 별도로 컬렉션 등록 수량을 보상하며, 기존 보상 완료 계정에는 미지급 컬렉션분만 추가 지급한다.
- 컬렉션 보상 완료 여부는 `collectionUsers`에 따로 기록해 재실행 시 중복 지급하지 않는다.
- 계정별 반복 저장 없이 `petSkillData.json`과 `member.json`을 각각 한 번만 저장한다.
- 두 파일 중 하나라도 저장에 실패하면 명령 단위 저장 트랜잭션이 실행 전 백업으로 복구하며, 이미 `COMPLETE`인 계정은 다시 지급하지 않는다.

## AI Notes

- Admin/Master가 인자 없이 정확히 `/펫스킬북보상`을 입력해 실행한다.
- 초월성장과 나 혼자만 레벨업의 장착·프리미엄 잠금·가방 수량을 합산해 1:1 보상한다.
- 두 스킬은 추첨·컬렉션·장착·관리자 신규 지급·개인 거래·자유시장 신규 등록과 구매 대상에서 제외된다.

# 월드 종합순위 · 닉네임 순위 표시 제거

Status: VERIFIED

## Files

- `main.js`, `Info.js`

## Related Helpers

- `buildNicknameWorldRanks` (Info의 실제 종합순위 계산에만 사용), `checkRank`
- `formatNicknameRankMessage`, `createContextReplier`, `formatRankNickname` (Info)
- `generateRanking`, `buildWorldOverallRankingMessage` (Info)

## Data Usage / Save Flow

- `/순위감추기` 명령과 닉네임 앞 `[N등]` 표시를 제거했다. 기존 `displaySettings.hideWorldRank` 저장값은 읽거나 변경하지 않는다.
- 기존 월드 종합순위와 같은 캐슬·레이드·펫강화 합산 및 동률 정렬을 사용하며 원본 아이디를 바꾸지 않는다.
- 닉네임 출력은 전체 회원 매력 계산·정렬·홈 로드를 실행하지 않는다. 표시 전용 컨텍스트와 저장 시 순위표 무효화도 제거했다.
- Info `/종합순위`, `ㅈㅈㅈ`, `/서버순위`는 기존 요청별 순위 계산과 목록 생성 방식을 유지한다. 닉네임 순위 표시와 `/순위감추기` 안내만 제외한다.
- `checkRank`는 기존 무쌍·티어/특별 이모지·길드 표시는 유지한다. 응답/공지의 `formatNicknameRankMessage`가 무쌍 접두어의 외곽 괄호를 정리한다.
- 실제 순위·매력·동률 순서·보상 기준과 `/종합순위`, `ㅈㅈㅈ`의 서버 현황 → 월드 응답 순서는 유지한다.

# /인형뽑기 · /인형도감 · /인형순위 · /인형가이드

Status: VERIFIED

## Files / Helpers

- main.js: getDollRequest, applyDollDraw, applyDollAcquisition, getDollBoxRequest, applyDollBoxOpen, getDollCollectionRows, buildDollRepresentative, buildDollCollectionMessage, buildDollRankingMessage, buildDollGuideMessage.
- MAIN·Info의 캐슬·레이드 기본 매력에 `member_pet.json`의 `dollCharm / 2`를 합산한 뒤 기존 퍼센트를 적용한다. 종합매력·진단도 같은 기본값을 사용한다. 원본 종합매력은 정수로 누적하므로 각 모드 +12.5도 누적 과정에서 보존한다.

## Commands / Policy

- `/인형뽑기`: 정확한 무인수 입력 1회. 이용권 1개 전용이며 부족 시 무소모. 정상 실패도 이용권을 사용한다. 신규·중복 모두 기존 티어·가호·레벨업 경험치를 적용하며 최대 기록 갱신 자체에는 별도 보상이 없다. 초월·창세·창조만 전체 알림이며 알림에서 공통 명령어·가이드를 제외한다. 사용액·잔액 표시는 제거하고 티어·성공률을 머리말에 표시한다.
- 이용권 부족 화면도 보유 포인트를 표시하지 않는다. 구분선 앞뒤 빈 줄과 `📖 상세·명령어` 뒤 allsee 위치는 READY 최종 예시에 맞추며 이용권/확률UP 소모와 추첨 계산은 변경하지 않는다.
- ver_2.644 확률UP: 가방의 `인형뽑기확률UP🧸(50%/40%/30%/20%/10%)` 중 높은 수치 한 종류 1개를 자동 사용한다. 기존 티어 성공률에 %p로 합산하고 100%로 제한하며 등급·크기·보상 추첨은 유지한다. 정상 성공·실패 모두 이용권과 확률UP을 각 1개 소모하고, 차단/부족 입력은 무소모다. 머리말에 실제 최종 확률·합산 내역, 이용권 아래에 선택 아이템·소모 후 잔여 수량을 표시한다. 확률UP이 없으면 기존 UI를 유지한다.
- ver_2.652 MAIN/Info 가방 목록은 확률UP 5종의 이름·수량만 표시하며 아이템 아래 설명 줄은 제거한다. 정렬·번호·가이드 및 실제 적용/소모는 유지한다.
- ver_2.653 MAIN·Info `generateBagOutput`은 고급 티어 승급티켓 다음에 이용권·확률UP 50/40/30/20/10%를 모아 표시한다. 미보유 항목은 건너뛰고 번호를 연속 부여하며 이름·수량만 출력한다. `/인형가이드`의 지급·소모 정책은 유지한다.
- `buildDollDrawDebugMessage`는 실제 판정 난수와 확률·티어·상한·소모 전후 수량을 안내한다. 기존 `/디버깅모드` 권한과 `debuggerLog` 테스트방 출력을 유지하며 저장 완료 후 출력한다. 추가 난수를 생성하지 않고 로그 전송 실패는 완료된 지급·소모를 되돌리지 않는다.
- `/인형도감`: 전체 현황. 일반·고급·희귀는 등급명만 입력하면 목록 선택이며 1/2 상세는 등급 전체 정렬 후 150/110/85종씩 나눈다. 영웅~창조는 전체 목록이다.
- `/인형순위`: 대표 인형의 등급·최대 크기·획득 횟수·고정 계정 ID순. 공개 10등, 본인 100등까지 표시한다.
- `/인형가이드`: 별도 이용 방법·확률·경험치·판매·도감·순위·크기·수집효과 안내다.
- ver_2.643부터 사용자 결정으로 `GLOBAL_CONFIG.doll.allowedRoom = null`을 적용해 인형 관련 명령의 전용 방 제한을 해제한다. 기존 가입·출석·정지·개인톡 조건과 관리자 권한은 유지한다. 방 설정을 다시 지정한 경우에만 기존 `isDollTestRoomCommand`와 읽기전용 `buildDollTestRoomRestrictionMessage`가 DEV 정규화 후 복구·자동 저장·요청 기록 전에 차단한다.
- `/인형전체초기화`는 기존 MASTER만 실행한다. 인덱스·16개 도감·펫의 dollCharm만 제거하며 카탈로그·패스·이용권·포인트·경험치는 보존한다. 18개 파일 원문을 기존 복구 기록에 저장하고 모두 저장된 뒤 복구 표시를 비운다. 대전 중에는 초기화하지 않는다. 인형 전용 2초 대기는 사용자 확정으로 스펙아웃이며 기존 공통 요청 과부하 규칙을 유지한다.
- 펫무쌍·길드영지·서버대전 진행 중 네 명령을 차단한다. 기존 가입·출석·정지·개인톡 제한은 유지하며 프리미엄·티어 자격 제한을 추가하지 않는다.
- 프리미엄 기존 날짜별 구독 지급에 이용권 1개를 추가한다. 같은 날짜 재지급과 `/리셋`에 따른 추가 지급은 하지 않는다.

## Data / Save Flow

- dollCatalog.json: Notion 고정 ID D0001–D1000, 9등급, 0.1cm 정수 크기. 첫 이용 때 검증·캐시하며 DEV도 공통 목록을 읽는다.
- ver_2.699: `getDollGradeRows`는 활성 `dollCatalogCache`와 동일한 검증 목록만 등급별 원래 순서로 재사용한다. 반환 배열은 매번 복사하여 도감 정렬이 다음 추첨에 영향을 주지 않는다. 다른 목록 객체·비숫자 등급은 기존 엄격 비교 필터로 처리하고, 카탈로그 객체 교체 시 캐시를 다시 만든다. 사용자 기록·확률·난수 호출 순서·소모·보상·저장 경로는 변경하지 않는다.
- dollRecords_0.json–dollRecords_15.json: 이름 해시로 분리한 도감·최초일·횟수·최대 크기. dollIndex.json: 순위 대표 기록. 회원 파일에 도감 원본을 넣지 않는다.
- 뽑기 전 회원·펫·인덱스·해당 기록 원문을 dollPending.json에 보관하고, 명령 트랜잭션 안에서 기록→인덱스→펫→회원 순으로 저장한 뒤 복구 표시를 비운다. 중단된 요청은 다음 MAIN에서 이전 원문으로 복구한다.
- 저장 완료 뒤 전송 실패는 재추첨·재지급·소모 취소를 하지 않는다. Info는 복구 대기 상태를 표시하지 않는다. DEV 사용자 저장 경로는 분리한다.
- `/계삭진행`, `/계정잠수삭제`, `/데이터정리`의 기존 삭제 정리와 연결해 인형 도감·순위 잔여 데이터를 함께 제거한다. 재가입은 새 기록이다. 닉네임 변경 기록 이전은 사용자 지시로 제외됐다.
- 최초 설치 자료와 운영자 확인 절차: docs/DOLL_CONTENT_DEPLOYMENT.md. 누락·손상 파일을 빈 데이터로 바꾸지 않는다.

## Validation

- tools/test_doll_catalog.js: 1,000종 ID·종수·구간·최초 종매 1억.
- tools/test_doll_content.js: 규칙·도감·순위·UI·실제 저장/롤백·재시작·전송 실패·DEV·프리미엄·삭제·Info 복구 대기·특수 이름·설치 누락 22개 그룹.
- tools/test_oct14_ready.js: 초기화 권한·18개 파일 저장 실패·DEV·패스 등록/삭제/지급·중복 지급·기간·일반 5/자동 10회·승리 100/패배 25·알림·통계·포인트 경계·파일 누락/손상·KST 자정·18개 원문 복구·응답/디버그 전송 실패 20개 그룹.
- tools/test_doll_test_room.js: 실제 MAIN 진입부의 선택적 방 제한과 정식 공개 설정·사용자 역할·DEV·무저장·파일 누락·길드 불일치·다른 명령 9개 그룹.
- tools/test_doll_rhino.js: UTF-8 Rhino 1.7.15 MAIN/Info 전체 컴파일 및 핵심 규칙 실행.
- tools/test_oct16_ready.js: 신규 스타터 4종·기존 영수증·중복/손상/저장 실패/DEV·MAIN/Info 정렬·디버그 확률 경계/실제 난수/소모/권한/전송 실패 10개 그룹.
- tools/test_doll_probability_up.js: 확률·우선순위·UI·소모·저장 단계 실패·중단 복구·DEV·대전 차단·패스 지급/중복/만료/정수 경계·MAIN/Info 가방 설명 10개 그룹. Rhino 테스트도 확률UP 상한·우선순위·소모를 실제 엔진에서 실행한다.

# /인증 · 검색인증 조회 및 초기화

Status: VERIFIED

## Files / Commands

- main.js: /인증 아이디 사유, /검색인증, /인증순위, /관리자순위, /관리자순위초기화, /인증초기화.
- 기획: 검색인증_수정요청서 및 해당 명령어 권한 수정 (166393bdd7aa832ab86f01a9a57fb0d8), ver_2.624.
- 등록·미인증 목록은 Admin 신원 권한, 검색어/관리자 순위는 Admin 또는 MASTER 신원 권한, 초기화 2종은 MASTER 신원 권한이다. 모든 방 및 펫무쌍·서버대전 중 허용하며 다른 명령의 방 권한을 확대하지 않는다. 길드영지전 중에는 공통 허용 목록이 우선한다. 기존 가입·계정정지·일대일 패스 흐름은 유지한다.
- /검색인증은 목록, /인증순위는 검색어 순위로 변경됐다. 이전 관리/순위 명령과 /검색인증 인자 형식은 안내만 출력한다. /가입인증·/가입인증 목록·/인증필요는 기존 목록 별칭·권한을 유지한다.

## Related Helpers

- normalizeSearchAuthenticationKeyword, countSearchAuthenticationCharacters, isSearchAuthenticationTarget, isSearchAuthenticationCount.
- requireSearchAuthenticationLightData, getSearchAuthenticationTarget, getPendingSearchAuthenticationTargets, recordSearchAuthenticationChat, migrateLightSearchAuthenticationToMember.
- applySearchAuthentication, applyBulkSearchAuthentication, resetSearchAuthenticationAdminStats.
- buildSearchAuthenticationManagementMessage, buildSearchAuthenticationRankingMessage, isGlobalOperatorCommandAllowed, isExclusiveDataMutationCommandMessage, isServerRaidAdditionalCommand.

## Data Usage / Save Flow

- member.json의 member[target].voicecheck, attendanceLight.json의 users[target].voicecheck와 searchAuthenticationRecord를 함께 조회한다. 일반 채팅 인식 기록도 대상으로 삼으며 게임 계정을 생성하지 않는다. 같은 아이디는 중복 제외하고 어느 저장소든 인증 완료이면 다시 보상하지 않는다.
- 단일 인증은 검색어 공백 제거 후 1~10글자와 안전 정수 경계를 확인하고, 대상 인증·검색어 횟수·관리자 count·가방의 호월신의 가호✨(/호여 숫자) 아이템 및 실지급 boosters 누계를 한 번 갱신한다. 활성 가호 boostercnt는 직접 늘리지 않고 /호여 사용 시 기존 흐름으로 전환한다. 기존 다이아 보유량·diamonds 지급 이력·포인트·moon·checkCnt는 유지한다.
- 가입 대상은 member.json만 저장한다. 미가입 대상은 경량 기록의 변경 전 스냅샷으로 먼저 저장한 후 member.json을 저장하며 기존 명령 트랜잭션으로 두 파일 실패를 함께 복구한다. 헬퍼에서 파일 IO하지 않는다.
- /인증초기화는 같은 미인증 대상 집합을 기타로 일괄 인증한다. 사용자 확정으로 관리자 보상·관리자 실적은 제외하며 검색어 기타 횟수만 합산한다. 기존 인증 사유·재화·checkCnt는 보존한다. 반복 입력은 0건·무저장이다.
- /관리자순위초기화는 모든 실적 형식을 먼저 검사한 뒤 count/diamonds/boosters 통계만 0으로 바꾼다. 계정 실적 id·보유 재화·대상 인증·검색어 통계는 유지한다. 이후 정상 인증은 같은 id에 새 실적을 쌓는다.
- 변경 명령 3종은 isExclusiveDataMutationCommandMessage의 단독 쓰기 잠금 대상이다. DEV 저장은 기존 컨텍스트로 DEV 경량·회원 파일에만 적용한다.
- 가입 시 미가입 인증 상태·기록을 이전하며 보상·집계를 다시 지급하지 않는다. 기존 4일 활동 정리·삭제 후 재인식 정책은 유지한다. Info.js의 검색인증 상태 출력은 같은 voicecheck를 계속 사용한다.

## UI / Validation

- 목록 시작부터 ALLSEE. /인증순위는 10등까지 바로 표시하고 11등부터 ALLSEE, /관리자순위는 4등까지 바로 표시하고 5등부터 ALLSEE. 검색어 기타와 관리자 호이 남은 각각 마지막에 표시한다. 호이 남 계정이 있으면 0 실적도 하단에 표시하고 기록은 유지한다.
- 새 가호 누계와 과거 다이아 누계는 별도로 표시한다. 정상 `/인증`은 관리자에게 가방 가호 30개와 포인트 5천만을 지급하고 `searchAuthentication.points`에 실제 지급 누계만 저장한다. 기존 누계 미기록은 0부터 시작하며 과거 인증은 소급하지 않는다. `/관리자순위`는 누적 인증 수당을 별도 줄로 표시하고 `/관리자순위초기화`는 이 누계도 초기화하되 보유 잔액은 유지한다. `/인증초기화`의 일괄 인증은 수당을 지급하지 않는다. 신규 잔액·누계의 손상과 안전정수 초과는 변경 전에 차단하며 기존 두 파일 저장 롤백·DEV 분리를 유지한다.
- tools/test_member_display_search_auth.js: 기존 가입·미가입·닉변·이전·정리·저장 실패 29개 회귀 그룹. tools/test_search_authentication_oct12.js: 새 권한·두 초기화·보상 전환·실적 보존·대전 잠금·정수 경계·DEV·부분 저장/응답 실패·일괄 인증 후 가입 이전·가방 보상 정수 경계/활성 가호 보존 12개 그룹.

# /호츈오픈 [수량] · 타이틀 판매

Status: VERIFIED

## Files / Related Helpers

- `main.js`: `GLOBAL_CONFIG.fortuneCookie`, `rollFortuneCookieTitle`, `applyFortuneCookieOpen`, `buildFortuneCookieOpenMessage`, `buildFortuneCookieSpecialNotice`.
- `isPointShopSafeCount` 재사용: 개봉 수량·보유 재화·보상 합산의 안전 정수 경계.
- `getMemberTitleSalePoint`, `applyMemberTitleSale`, `removeMemberTitleAt`: 쿠키 고정 판매가·기존 판매가 유지·삭제 뒤 다른 장착 타이틀 번호 보정.
- `Info.js`: 본인 및 관리자 대상 `/타이틀목록`, 10개부터 ALLSEE.

## Behavior

- `/호츈오픈 숫자`는 1~100 정수만 실행한다. 인수 누락·단일 잘못된 수량은 오류 안내, 추가 설명이 붙은 입력은 실행하지 않는다.
- `호츈쿠키🥠(/호츈오픈 숫자)`를 소모하고 쿠키마다 펫 강화석⭐ 100개, 티어 승급티켓🎟 1개, 다이아상자💎(/다이아상자오픈) 1개를 지급한다.
- 기존 `호츈쿠키🥠` 수량도 합산해 개봉한다. 각 수량과 합계의 안전 정수를 검사하며, 개봉 성공 시 남은 쿠키를 새 이름으로 통합한다. 실패 시 기존 보유 상태를 유지한다.
- 각 쿠키는 일반 50%, 특별 1%, 미당첨 49%의 배타적 결과. 고정 명단 310개·일반 콘셉트 6종·각 멘트 30개는 각각 동일 확률. 특별 멘트도 30개 동일 확률.
- 타이틀의 이름과 멘트를 합친 전체 문자열로 보유 중복을 확인한다. 한 개봉 안의 반복 결과도 포함하며, 신규는 기존 목록 뒤에 추가하고 자동 장착하지 않는다.
- 중복은 5천만 포인트, 특별은 신규·중복 모두 다이아 100개 추가. 개인 UI는 합산한 기본·추가 보상과 실제 결과를 표시한다.
- 특별 당첨마다 기존 전체알림 대상방으로 독립 공지. 한 방의 전송 오류는 다른 방을 중단하지 않는다. 지급 확정 이후 전송 오류는 보상을 되돌리거나 재지급하지 않는다.
- 쿠키 타이틀만 `kind: fortuneCookie`로 구분해 1,500만 포인트에 판매한다. `/타이틀정보`·`/타이틀판매`·`/타이틀지정판매`에 같은 가격 계산을 적용하고 기존 타이틀 판매가는 유지한다.
- 기존 가입·출석·계정정지·일대일 패스·대전 제한을 유지한다. 쿠키 개봉은 서버대전 중 새 허용 예외가 아니다.

## Data / Save Flow

- `member.json`: 가방 쿠키·기본 보상, 포인트·다이아.
- `member_title.json`: 기존 `member[user].title.list`의 `name/inDate/price`와 쿠키 식별 `kind`. 장착 `num`은 유지.
- 명령 분기에서 타이틀 JSON을 1회 읽고 소모·지급 경계를 전부 검사한 뒤 저장한다. 새 타이틀이 없으면 타이틀 파일을 저장하지 않는다.
- 타이틀 파일은 현재 기본 보호 목록 밖이므로 `saveJsonFile(..., false, 실행전JSON문자열)`로 기존 원자적 교체·복구에 참여시킨다. 회원 파일 저장 실패 시 먼저 저장한 타이틀도 복구한다.
- 단일·구간 판매도 같은 스냅샷과 회원 저장을 사용한다. DEV는 기존 경로 해석과 공지방을 재사용한다. 순수 계산·출력 helper에서 파일 IO를 하지 않는다.
- 검증: `node tools/test_fortune_cookie.js`. 합성 데이터·실제 분기·저장·복구 함수 사용. 기기 실행은 검증 범위 밖.

# 서버대전 중 기록·검색인증 추가 허용

Status: VERIFIED

- `main.js:isServerRaidAdditionalCommand`에서 `/기록`, `/기록 내용`, `/기록실`, `/인증 아이디 사유`, `/검색인증`, `/인증순위`, `/관리자순위`, `/관리자순위초기화`, `/인증초기화`만 기존 예외에 추가한다. `/검색인증`은 미인증 목록으로 연결한다.
- PREP·ACTIVE·SETTLING에서 기존 명령 분기로 통과시키며 기록의 기존 Admin/Master 신원 권한, 검색인증의 Admin/Master 신원 권한, 출석·정지·패스 검사를 확대하지 않는다.
- `/기록삭제`, 조회 명령 뒤 추가 인수, 호츈쿠키 개봉은 새 예외가 아니다. 기존 허용 명령과 별칭을 유지한다.
- 신규 저장 경로 없이 기록의 `board.json`, 검색인증의 `member.json` 저장·중복 방지와 기존 잠금을 그대로 사용한다.
- 검증: `tools/test_fortune_cookie.js`의 실제 레이드 진입 및 기존 인증 권한 시나리오, `tools/test_server_raid.js`, `tools/test_member_display_search_auth.js`.

# /인형패스추가 · /인형패스삭제 및 일일 횟수 조정

Status: VERIFIED

- MAIN의 기존 일반 패스 관리자 `호이 남`이 `/인형패스추가, 아이디 YY.MM.DD|영구권`, `/인형패스삭제, 아이디`를 처리한다. ver_2.643부터 인형 전용 방 제한은 해제하며 기존 관리자 권한은 유지한다.
- ver_2.644 `grantDollPassDailyRewards`는 지급 대상 전체의 이용권·확률UP(20%) 수량과 합산 안전 정수를 먼저 확인한 뒤 기존 일일 지급 경로로 각각 3개를 지급한다. 기존 당일 지급 기록은 재지급하지 않으며 다음 지급일부터 두 보상을 받는다. 두 보상과 지급 날짜는 기존 회원 저장·롤백에 함께 포함한다.
- `getSupportPassConfigs`의 doll 항목을 통해 패스목록·패키지가방·만료·조회에 연결한다. `grantDollPassDailyRewards`는 유효한 패스에 이용권 3개를 KST 날짜별 1회 지급하며 연장·삭제/재추가 시 지급일을 보존한다. `/자동출첵` 및 기존 `/구독패스지급`이 공통 지급 함수를 사용하고 프리미엄 1개 지급과 별도로 적용한다. 기존 일반 패스의 권한은 확대하지 않는다.
- `GLOBAL_CONFIG.daily`의 시탑·캐슬·미니펫 콘텐츠 최대와 일퀘 목표는 각각 5회, `autoDailyBonusRuns`는 기존 5회 유지로 자동 진행·완료 판정은 10회다. 승리 EXP 100·패배 EXP 25이며 무료 횟수와 추가 보상 규칙은 유지한다. 기존 진행 카운트는 초기화하거나 낮추지 않는다.
- 개발 준비 버전: 2.637. 운영 반영 전 노션 완료 속성을 변경하지 않는다.

## 2026-10-14 통합 수정요청서 후속 (ver_2.638)

- 일반 일퀘는 `GLOBAL_CONFIG.daily.questTargets`의 시탑·캐슬·미니펫 5회와 기존 탐험 10회로 판정한다. 콘텐츠 최대 `*Max`는 사용자 정정에 따라 5회이며 자동 추가 5회(총 10회)를 적용한다. Main의 안내·미완료 응답·자동 결과 및 Info의 일퀘·펫정보 표시도 목표 5회 기준이다.
- `claimQuestReward`는 기존 일반 보상 뒤에 인형 이용권 1개를 추가한다. `dailyQuestCnt`가 이미 완료라면 재지급하지 않으며 기존 회원 저장 흐름을 사용한다.
- `/인형뽑기`는 이용권 1개로만 실행하며 포인트만으로는 추첨·변경·저장하지 않는다. 중복 판매와 레벨업 포인트는 기존대로 지급한다. 구독 정책은 유지하며 인형 전용 방 제한은 ver_2.643에서 해제한다.
- `buildTierPromotionSuccessMessage` 일반 응답에서 현재 최종 인형 성공확률·혜택·다음 목표를 구분선으로 안내하며 다음 확률 변화 문구는 제외한다.
- Main·Info의 `PET_SKILL_MAX_EQUIP_SLOT`은 사용자 롤백 요청에 따라 30, 학개론 최대는 33이다. 친밀도에 따른 슬롯 증가와 프리미엄 +7은 유지한다. 설명은 30/33으로 동기화한다.
- 레이드 준비 공지·조회에는 준비 마감+30분의 예정 시각을 표시한다. 실제 활성화 시 기존대로 시작+30분을 확정한다. 공지/작업 예외의 로그까지 실패해도 다음 타이머를 예약한다. 이전 회차의 확정 마감·정산·공지 대상은 유지한다.
- 검증: `tools/test_oct14_followup.js`의 9개 신규 그룹은 4/5회 경계·실제 보상/중복 방지·Info UI·30/33 슬롯·현재 확률·이용권 전용·준비/확정 마감·30분 자동 종료·공지+로그 동시 실패·DEV 분리를 검증한다. 전체 55회 테스트와 Rhino 1.7.15 구문/실행 검증, UTF-8·버전·개발자노트 검증이 통과했다. 기기 업로드·컴파일은 운영자가 수행한다.

## 2026-10-14 하루 진행 한도 정정 (ver_2.639)

- 사용자 확인: 일퀘 완료 조건만이 아니라 시련탑·캐슬대전·미니펫대전의 실제 하루 최대 한도를 10회에서 5회로 줄인다. 이전 노션의 콘텐츠 횟수 유지 문구보다 이번 사용자 확정이 우선한다.
- Main·Info의 `GLOBAL_CONFIG.daily.trialTowerMax/castleBattleMax/miniPetBattleMax`는 모두 5이며 자동일퀘 추가 5회로 최대 10회까지 진행한다. 일반 5회 이후와 자동 10회 이후에는 기존 제한 흐름으로 차단한다.
- 기존 진행 카운트가 이미 5/10회를 초과해도 초기화·하향 보정·보상 회수하지 않는다. 시련탑의 기존 운영자 한도 예외, 무료 1회, 리셋권 소모 및 펫탐험 목표 10회는 유지한다.
- 검증: 실제 콘텐츠 분기의 한도 계산/초과 차단과 무료/리셋권 소모 순서, 4/5·9/10·기존 초과 카운트, 자동 반복 중단, Main·Info 표시를 검증했다. 전체 테스트 55회와 Rhino 1.7.15·문법·UTF-8·버전 검증 통과.

## 2026-10-14 펫스킬 슬롯 기존 정책 복원 (ver_2.640)

- 사용자 요청에 따라 Main·Info 기본 최대 30칸, 학개론 +3칸, 프리미엄 +7칸으로 복원한다. 기본/학개론/프리미엄/둘 다의 최대치는 30/33/37/40칸이며 친밀도 증가 규칙은 유지한다.
- 기존 장착 데이터는 자동 삭제하지 않는다. 줄어든 한도 이상 장착 상태에서는 기존 장착 제한 흐름으로 추가 장착을 차단한다. 슬롯 설명도 30/33으로 복원한다. 일퀘·콘텐츠 기본 5회와 자동 10회 등 다른 변경은 유지한다.
- 검증: 슬롯 조합·친밀도/상한·해제·프리미엄, 펫스킬·미니펫·베란다·레이드 관련 6회 테스트 및 Rhino 1.7.15 검증 통과. Main·Info 문법·UTF-8·버전 동기화 확인.

## 2026-10-14 인형 UI 및 가호 안내 (ver_2.641)

- `buildDollDrawMessage` 성공/실패는 닉네임 다음·첫 구분선 전에 티어/성공률을 한 번 표시한다. 결과 위아래 빈 줄, 이용권 차감 후 잔여 수량, 기존 allsee와 명령어 안내는 유지하며 사용액·잔여 포인트 줄은 제거한다. 부족 안내는 기존 출력 그대로 유지한다. 중복 자동 판매 안내·보상은 유지한다.
- 기본·상세 경험치는 같은 실제 total을 `📊 총 획득 경험치: +Nexp`로 표시하고 기본/티어/가호 항목에 대전과 같은 이모지·콜론·exp를 사용한다. 부분 가호도 실제 추가량/사용량으로 안내하며 계산·저장 흐름은 유지한다.
- `/호여 숫자` 안내는 현재 승리 EXP 설정(캐슬/미니펫 100)을 참조하며 인형별 기본 EXP·티어 선합산·가호 적용 문구를 추가한다. 실제 아이템 차감/활성 가호 전환과 원래 allsee 위치를 유지한다.
- 검증: `tools/test_doll_ui_blessing.js` 신규 8개 그룹과 전체 56회 회귀, Rhino 1.7.15·문법·UTF-8·JSON·버전 동기화 및 추첨/EXP/가호 계산 불변 검증 통과.

## 2026-10-14 패스 일퀘/모험가 목표 (ver_2.642)

- Main·Info 일퀘 상태는 마음 주기/정상 인형뽑기/홈알림 1회로 동일하게 조회·판정하고 0/1·1/1로 표시한다. 기존 호이/초보/프리미엄 자격과 일반·주간·프리미엄 보상은 유지한다. 제목·미이용자 안내는 호이패스로 표기한다.
- `/마음`의 수량 생략/명시 및 직접 마음표현 4종 성공 때 공유 회원 진행도를 홈/활동 저장과 함께 저장한다. 세 저장 단계 실패는 기존 롤백 흐름과 진행도 원복을 사용한다. 본인 대상·오류·자격/한도 차단은 인정하지 않는다. `/퀘스트`와 `/ㅋ`는 같은 조회 분기/판정/UI를 사용하며 별도 안내를 추가하지 않는다. `/인형뽑기`는 성공/실패 모두 실제 이용권 사용 시에만 회원 진행도를 기록하고 기존 복구 사본/회원 저장에 함께 포함한다.
- 기존 `/일퀘완료`, `ㅎㅎㅎ`, `/ㅇ`, `/ㅇㅇㅇ`, 정리·자동일퀘 등의 `claimQuestReward` 호출 경로는 동일한 새 조건과 수령 표시로 중복 지급을 막는다. 조회/미완료 출력은 보상·주간 누적을 만들지 않는다.
- 모험가 단계 3·4·5의 공통 `battleResultGoal`은 5이며 목표·NPC 안내·신규 완료 기록도 5판 기준이다. 누적 진행은 보존하고 표시만 5/5로 제한한다. 완료 단계·보상·순서와 콘텐츠 하루 한도 5/자동 10은 유지한다.
- 검증: `tools/test_quest_conditions_oct14.js` 13개 그룹은 실제 상태·보상·Main/Info 화면, 정상/제한/실패·DEV·반복·저장 실패/복구·리셋, 4/5·초과 진행도와 모험가 실제 완료 명령의 단일 지급을 검증한다.
- 마음 지급 저장 완료 뒤 응답·디버그 로그가 함께 실패해도 지급/일퀘 진행도를 유지한다. 실제 로드/저장 오류는 기존 원복 경로로 실패하며 숨기지 않는다.
- 첫 호이패스 문서의 `/퀘스트완료` 언급은 현재 명령 역할 및 명령/별칭 변경 제외 조항을 근거로 `/일퀘완료`의 오기로 해석한다. `/퀘스트완료`는 모험가 전용이며 이름/라우팅을 변경하거나 일일 보상을 함께 지급하지 않는다.
- 최종 검증: 신규 13개 그룹·전체 57회 테스트와 Rhino 1.7.15, Main/Info 문법·UTF-8·JSON·버전 일치 검사 통과.


---

# /인형상자오픈

Status: VERIFIED

## Files

- main.js: GLOBAL_CONFIG.doll.boxes, getDollBoxRequest, applyDollBoxOpen, applyDollAcquisition, buildDollBoxErrorMessage, buildDollBoxMessages.
- Info.js: generateBagOutput의 동일한 10종 상자 표시.

## Commands and Behavior

- `/인형상자오픈등급 [수량]` (예: `/인형상자오픈고급 10`): 수량 생략 1개, 1회 1~100개, 일일 제한 없음. 등급은 일반·고급·희귀·영웅·전설·신화·초월·창세·창조·엘리트.
- 기존 공백 명령도 호환한다. MAIN/Info 가방과 결과의 사용법은 붙여 쓴 표기를 사용하며, 기존 저장 키·가방 번호는 보존한다. 기존/새 이름의 재고는 합산하고 기존 이름부터 차감한다.
- 실행 입력 전체를 검증한다. 0·음수·소수·101개 이상·추가 문구는 개봉하지 않는다. 재고 부족은 일부만 처리하지 않는다.
- 실제 카탈로그의 같은 등급 안에서 동일 확률로 추첨한다. 상자용 목록을 복사하지 않는다. 엘리트 등급의 실제 데이터가 없으면 상자·가호·포인트·도감 무변경 안내.
- 일반 뽑기의 성공률·등급 추첨·이용권·확률UP 소모·패스 일퀘 집계를 실행하지 않는다. 가입 등 기존 공통 조건과 대전 차단·명령 잠금은 유지한다.
- applyDollAcquisition을 일반 뽑기와 공유하여 크기·도감 신규/중복·경험치·티어·가호·레벨업·매력·순위·판매를 동일하게 처리한다. 획득을 순서대로 반영하므로 같은 인형도 첫 신규 이후 중복으로 계산한다.
- 1개는 기존 획득 화면을 사용하고 비용·잔여를 상자로 표시한다. 다중 개봉은 실제 합계와 전체 획득 목록을 allsee 아래에 표시하며 3,500자 기준으로 누락 없이 분할한다.
- 기존 초월·창세·창조 전체알림 기준을 유지한다. 기존 1,000종 카탈로그·9등급·일반 뽑기 확률은 그대로다.

## Save Flow

- 별도 저장 파일은 추가하지 않는다. 회원 가방, member_pet.json의 매력, dollIndex.json, 해당 dollRecords_N.json을 기존 인형 저장 트랜잭션에 함께 반영한다.
- 진입 흐름에서 원문을 읽고 dollPending.json에 복구 기록을 먼저 저장한다. 도감→인덱스→펫→회원→복구 표시 해제 후 결과를 전송한다.
- 저장 오류는 기존 롤백, 강제 중단은 다음 MAIN 복구 경로를 사용한다. 전송 실패는 이미 완료된 지급·상자 소모를 되돌리지 않는다. DEV는 기존 경로 분리를 유지한다.

## Validation

- tools/test_doll_boxes.js: 전체 입력, 9등급 추첨/보상 동등성, 연속 중복, 크기별 판매, 가호 소진, 100개 결과 분할, 실제 저장/복구/재시도, 엘리트 무차감, 대전 차단, 알림, MAIN/Info 가방.
- tools/test_doll_rhino.js: 전체 MAIN/Info 컴파일과 기존 뽑기·100개 상자·엘리트 무차감·명령 경계 실행.

---

# 2026-10-19 길드 보상 · 퀘스트14 · 가구 슬롯 · 당근 비용

Status: VERIFIED

## Files and Helpers

- main.js: guildLevelTable, checkGuildLevelUp, buildAdventureQuestMessage, buildAdventureQuestIncompleteMessage, getFurnitureMaxSlots, getFreeMarketCarrotFee, getFreeMarketTradeFeeRate, tradePendantByCarrot, registerPendantFreeMarket.

## Behavior and Save Flow

- 도달 길드 레벨 13·19는 miniPet 창고 30,000·70,000개, 14·20은 petSkillBook 창고 700·1,500개. 보상표 키는 출발 레벨 12·18·13·19다. 기존 길드 저장과 레벨업 지급을 재사용하며 과거 달성 보상을 다시 지급하지 않는다.
- 모험가 퀘스트14 기본/미완료 안내에 `/홈뱃지큐브 [슬롯] [옵션] [사용횟수]`를 표시한다. 완료 조건·큐브 실행·보상은 유지한다.
- getFurnitureMaxSlots는 100평까지 기존 규칙, 초과분은 floor((평수-100)/5). 보너스 전 100·104평 21개, 105·109평 22개, 110평 23개, 200평 41개다. 기존 건물주·베란다·프리미엄을 합산하고 현재 평수에서 매번 산출하므로 별도 이전/중복 증가가 없다.
- GLOBAL_CONFIG.carrotTrade.costs: 일반 1, 미니펫/가구 100, 스킬/펜던트 300. 개인 스킬 거래와 시장 묶음 등록의 수량 배수는 유지한다. 개인 펜던트 마지막 인수는 기존 가방번호다.
- 자유시장 판매자 수수료 일반 17%·회원권 10%, 목록/현황/안내 동기화. 과거 완료 로그의 실제 수수료율과 등록 취소의 기존 carrotFee 반환액은 보존한다. 기존 회원/펫/가구/스킬/시장 저장 흐름을 사용한다.
- tools/test_oct19_ready.js와 tools/test_carrot_community_trade.js는 합성 데이터에서 경계·보너스·수수료·이력·취소·거래 저장 실패를 확인한다.
- ver_2.659 시장·가구 원문 스냅샷을 같은 명령의 저장 롤백에 연결한다. tools/test_oct19_market_flow.js는 거래 5종의 등록/구매/취소·모든 저장 지점 실패·DEV 격리·관리자 취소를 검증한다. tools/test_oct19_lock_rhino.js는 실제 응답 진입부 잠금과 합성 임계구역을 Java 스레드 20쌍으로 검증한다.

- ver_2.659 `/가구가방`의 배치 수·장착 한도 안내를 응답에 연결했다. tools/test_oct19_furniture_flow.js는 기존 목록·분리 상세, 평수 경계, 한도 초과 차단과 스킬·프리미엄 보너스를 실제 장착/가방 분기에서 검증한다.

## ver_2.699 장착 스킬 목록 계산 재사용

- `main.js`·`Info.js`의 `calculateCastleExp`·`calculateRaidExp`는 기존 최초 스킬 확인 위치에서 `getEquippedPetSkillNames`를 한 번 호출한다. 모드 계산의 지역 배열을 하우스 보너스·비티어·티어 매력 함수의 마지막 선택 인자로 전달한다.
- `getPetHomeFurnitureCharm`·`getEquippedNonTierPetSkillExp`·`getEquippedTierPetSkillExp`는 선택 인자를 생략하면 이전처럼 직접 준비한다. 독립 호출과 매력 계산 순서, 중복 장착의 기존 합산 정책, 별칭, 자료 보정과 조건 검증을 유지한다. 회원 간·명령 간 장착 목록 캐시나 파일 IO는 추가하지 않는다.
- 검증: `tools/test_calculation_catalog_performance.js`, `tools/test_calculation_catalog_performance_rhino.js`, `tools/calculation_catalog_performance_validation.md`. 전체 소스 범위·결과/상태/예외·실제 Info 응답·인형 난수/지급·DEV·재시작·동시 정렬과 성능을 이전 운영 기준으로 비교한다.
