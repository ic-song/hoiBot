# ERROR_FIX_LOG.md

Runtime error and bug-fix investigation notes for hoiBot.

The source code is always the source of truth. This log is a reusable reference for future fixes, not proof that a fix has already been implemented or deployed.

---

Add new runtime error records below this line.

---

# 2026-10-06 - 서버 레이드대전 고정 마감·자동 종료·권한 보완

Status: DEVELOPMENT_VALIDATED

## Confirmed Cause

- 기존 준비·정산·공지 예약만으로는 진행 중인 회차를 정해진 시각에 종료할 수 없었다. 공격 검사에도 종료 예정 시각이 없었다.
- 문서는 시작 명령 정상 처리부터 테스트 10분, 정식 전환 30분을 요구한다. 기존 60초 준비 시간도 해당 시간에 포함하며 실제 공격 시작 시각은 기존 의미를 유지한다.
- 회원 파일 로드 후 권한 검사 전에 작업을 재예약해, 타이머 유실 상태에서 권한 없는 시작·종료가 타이머를 생성할 수 있었다.

## Fix and Validation

- 시작 시 회차별 명령 시각·진행 시간·종료 시각을 확정하고 기존 환경별 타이머 1개로 준비·자동 종료·공지 재시도를 예약한다. 진행 중 설정 변경·중복 시작은 기존 마감을 연장하지 않는다.
- 마감 이후 공격을 타이머 실행과 독립적으로 거부한다. 수동·자동은 같은 종료·정산 절차를 사용하며, 저장 실패·이전 콜백·재시작·종료 경합에 기존 지급 상태와 세대·회차 검사를 유지한다.
- 종료 후 미발송 준비·시작 공지는 취소 표시해 오래된 안내를 보내지 않으며 실제 발송 기록을 보존한다. 자동·수동 종료 문구와 KST 마감 안내를 기존 공지에 적용한다.
- 기존 MASTER와 인증된 운영봇 판별을 재사용한다. 일반 유저·관리자·동일 닉네임 운영봇은 상태와 타이머를 바꾸지 않는다. 기본 7인수 MASTER 동작을 유지하고 확장 식별값은 필수로 바꾸지 않는다.
- 반영용 설정은 정식 운영 30분이다. 합성 메모리 파일 IO와 가상 시각으로 10분·30분 설정을 모두 검증하며, 운영 기기 접근 없이 재시작·중복 정산·DEV 분리를 확인한다. 종료 시각 없는 이전 진행 회차에는 새 마감을 소급하지 않는다.
- 누적 65개 검증 그룹을 새 프로세스에서 5회 실행해 모두 통과했다. 문법·UTF-8·diff와 기존 방 제한·서버6 유입·미니펫 계산·상점 회귀 검증도 통과했다. 기본 운영봇 등록 목록은 기존대로 비어 있으며 표시 닉네임만으로 권한을 추가하지 않는다.

---

# 2026-10-06 - 레이드 공격 UI·누적 조회·진행 중 순위 조회 보완

Status: DEVELOPMENT_VALIDATED

## Confirmed Cause

- 기존 개인 조회는 최근 한 회차의 기여도·순위를 표시하고 서버 조회는 누적 집계를 사용했다. 두 회차 합성 사례에서 개인 100%·1위와 누적 40%·2위가 달라지는 것을 재현했다.
- 조회 2종도 실행 명령과 같은 방 제한·대전 잠금으로 차단되어 기획의 진행·정산 상태를 조회할 수 없었다. 사용자 결정으로 조회만 모든 운영방에 허용한다.
- 사용자 결정으로 새 공격 보상은 직전 버전의 D1%에서 치명타 전 R1%로 변경한다. 과거 지급 기록은 그대로 보존한다.
- 기존 치명타 여부는 R과 D의 차이로 유추하여 0매력 치명타를 표시하지 못했다.

## Fix and Validation

- 공격 데미지 아래 레이드매력·실제 일반/치명타 상태를 묶고 실제 획득 포인트·서버 현황을 구분한다. 기존 치명타 함수의 숫자 반환을 유지하며 선택 인수로 실제 판정값을 함께 사용한다.
- 개인·서버가 같은 현재 소속 참가자를 집계한다. 진행 회차의 미지급 공격을 추가하고 이미 정산된 회차는 누적 기록으로만 읽어 부분 정산·재시작에서 중복을 막는다.
- 최근 참가와 누적 기록을 분리하고 ALLSEE를 요약 다음에 한 번 넣는다. 진행·정산 중에 확정 보상 합계와 지급 완료를 표시하지 않는다. 과거·신규 지급 기준이 섞인 회차는 실제 지급 합계만 안내한다.
- 운영 조회는 모든 방·개인톡에서 준비·진행·정산 중에 허용한다. 실행 4종과 DEV의 방 제한, 출석·정지·일대일 패스 조건, 기존 서버 이동·초기화 정책은 유지한다.
- 합성 데이터·메모리 파일 IO의 실제 레거시 7인수 콜백을 포함한 54개 검증 그룹을 새 프로세스에서 5회 실행해 모두 통과했다. 미니펫 계산·상점·서버 이동·기존 방 제한 회귀 검증, 문법·UTF-8·diff 검사도 통과했다. 운영 기기 접근·실행은 수행하지 않는다. 이 기록은 개발 검증이며 운영 반영을 의미하지 않는다.

---

# 2026-10-06 - 서버 레이드대전 공격 보상·명령방·종료 상금 표시 보완

Status: DEVELOPMENT_VALIDATED

## Confirmed Cause

- 기존 공격은 이미 `calculateRaidExp`를 사용하고 인장·홈/길드 큐브·레벨·퀘스트 보너스를 반영했다. 종합매력을 사용하거나 해당 보너스를 누락한 소스 문제는 재현되지 않았다.
- 제보 수치 R=116,601,136, 치명타 배율 7.52로 D=876,840,543, 이전 보상 R1%=1,166,011을 재현했다. 사용자의 최신 요청에 따라 새 공격은 치명타 적용 후 D1%=8,768,405를 지급한다.
- 레이드 전용 방 제한과 종료 상금 표시가 없었다. 기존 MASTER 판정은 공성전 방에서 권한을 부여하지 않아, 방 제한 후 기존 MASTER 명단을 확인하도록 레이드 분기만 보완했다.

## Fix and Validation

- 공성전·팻 테스트방에서 운영 명령을 허용하고 DEV는 팻 테스트방으로 한정한다. 타 방·일대일은 파일 조회·저장 전 차단하며 두 운영방의 공격 횟수는 합산 5회다.
- 공격에 사용한 R과 치명타 포함 D를 구분해 출력하고 D1%를 버림 지급한다. 이전 공격 기록은 당시 지급액과 안내를 유지한다.
- 종료 공지의 우승·서버 순위에 확정된 참여자 1인당 상금을 표시한다. ALLSEE는 지정 위치에 한 번만 넣고 미참여 서버의 무보상을 안내한다. 출력은 추가 정산을 수행하지 않는다.
- 조회 이름을 `/레이드순위`, `/서버레이드순위`로 변경하고 기존 저장된 참가 결과는 유지한다. 이전 이름은 파일 IO 없이 새 명령어만 안내한다.
- 합성 데이터의 실제 명령·예약·보호 저장 흐름 46개 검증 그룹을 통과했다. Main/Info 실제 레이드 계산의 인장·홈/길드 큐브·레벨·퀘스트 보너스도 대조했다. 운영 기기에는 접근하지 않는다.
- 연결된 신규 ROOM 기획에 따라 기존 서버6에 방을 추가했다. 짧은 채팅의 미지정 소속과 모험 시작 후 방 이동 가입 경로를 보완하고, 실제 가입·경량 출석 흐름 7개 검증 그룹으로 기존 소속과 기록 유지·DEV 분리·저장 실패를 확인했다.

---

# 2026-10-06 - 레이드 명령 조기 반환 시 재시작 후 미완료 작업 미재개

Status: DEVELOPMENT_VALIDATED

## Confirmed Cause

- 회원 파일 로드 후 미완료 작업 재예약이 레이드 명령 분기 아래에 있었다. 예약이 없는 상태에서 준비 중 시작 또는 정산 중 종료를 재입력하면 안내 후 반환해 재예약에 도달하지 않았다.
- 운영 컴파일 시 운영 회차는 별도로 재개하지만 DEV 회차에는 해당 초기화가 없다. 합성 DEV 정산 상태에서 예약을 비우고 종료를 재입력하면 타이머 0개가 유지되는 실패를 재현했다.

## Fix and Validation

- 기존 미완료 작업 재예약을 회원 파일 로드 직후로 옮겼다. 명령 권한·잠금·공격 한도·정산 지급 규칙은 그대로 사용한다.
- 실제 7인수 `response(...)` 전체 함수를 합성 데이터에서 실행해 시작·공격·종료, DEV 헤더·경로 분리, 저장 실패 롤백, 잠금·컨텍스트 해제를 검증했다.
- 예약 유실 후 종료 재입력으로 한 번만 정산하고, 준비 중 시작 재입력은 회차·마감 시각을 유지하며 작업만 재개한다. 운영 데이터와 기기에는 접근하지 않는다.

---

# 2026-10-06 - 기존 메신저봇에서 서버 레이드대전 시작·공격 차단

Status: DEVELOPMENT_VALIDATED

## Confirmed Cause

- ver_2.599는 원본 메시지 ID가 없는 콜백에서 시작·공격을 차단했다. 사용자 운영 환경은 기본 7인수 `response`를 사용하는 레거시 메신저봇이다. 설치 환경에서 확인하지 않은 확장 인수를 필수로 둔 것이 원인이다.
- 시작 분기만 풀면 공격은 계속 차단되어 대전 잠금만 남는다. 두 진입 경로를 함께 수정했다.

## Fix and Validation

- 기본 콜백에서도 기존 권한방의 MASTER가 시작하며, 공격에는 호출별 저장용 UUID를 부여한다. UUID는 원본 알림의 식별값이 아니다.
- 사용자가 기본 메신저봇 방식으로 수정을 승인했다. 원본 ID가 없는 동일 알림 재전송도 공격 1회로 센다. 계정당 5회 한도·재시작 후 횟수·정산 중복 지급 방지는 유지한다.
- 확장 ID를 제공하는 레거시 콜백의 재전송 차단은 유지하며, 손상된 확장 ID를 기본 콜백으로 바꾸지 않는다. 운영봇 닉네임만으로 권한을 부여하지 않는다.
- 합성 파일시스템의 실제 명령 진입·저장·예약 작업을 검증한다. 운영 런타임에 접속하거나 업로드·컴파일하지 않는다.

---

# 2026-10-03 - `/미니펫정보` 등급 펫스킬 추가 매력 표시 누락

Status: DEVELOPMENT_VALIDATED

## Confirmed Cause

- `/미니펫정보`의 본인·대상 조회가 출력 함수에 `petSkillData`를 전달하지 않았다. 함수는 미니펫 기본 매력만 합산해 창조림·엘리트 박사를 장착해도 표시값이 변하지 않았다.
- 현재 Main/Info 캐슬·레이드 실제 계산은 별도로 등급 스킬을 반영한다. 제보 조합(대표 엘리트 12,000,000, 보조 창조 원본 1,630,000)은 두 스킬 활성 장착 시 각 모드 +1,750,000, 종합 +3,500,000이 정상 가산된다.
- 제보 계정의 실제 런타임·장착 데이터는 확인하지 않았다. `/펫정보`에서도 변화가 없다면 운영 런타임 버전, 활성 장착 목록 및 프리미엄 잠금 여부를 별도로 확인해야 한다.

## Fix and Validation

- 본인·대상 조회에 이미 로드한 스킬 데이터를 전달하고, 실제 계산과 같은 등급·슬롯 판정으로 스킬 추가분을 안내한다.
- 슬롯의 미니펫 기본 매력은 유지하고, 스킬별 추가분과 스킬 포함 합계를 표시한다. 다른 퍼센트 보너스는 `/펫정보`에 반영됨을 안내한다.
- 합성 데이터에서 제보 출력의 기본 매력 12,000,000·815,000, 스킬 추가 3,500,000, 합계 29,130,000 및 각 모드 14,565,000을 실제 계산과 대조했다.
- 조건형 스킬 검증 13개 그룹, 보조 매력 경계값 5개 및 실제 `/펫정보` 출력 검증 통과. 운영 데이터 원본은 변경하지 않았다.

---

# 2026-10-03 - `/구매` 큰 수량의 가격 축소와 과다 지급

Status: DEVELOPMENT_VALIDATED

## Confirmed Cause

- 제보 캡처에서는 `1e+80` 이상의 수량이 지급되지만 결제액은 티켓 1개 가격이었다.
- 최초 입력 파싱으로 만들어진 숫자를 `buildPointShopPurchaseQuote`에서 다시 `parseInt`로 처리하여 지수 표기의 앞자리만 수량으로 해석했다. 지급은 최초 수량을 사용했다.
- 기존 prod ver_2.594의 실제 명령·견적·쿠폰 함수를 합성 데이터로 실행하여 일반 상품과 티켓 모두 재현했다. 50% 쿠폰·VIP 30% 할인·탈세자 1.5% 세금 조건에서는 캡처의 2,486,750포인트 결제도 재현했다.
- 0 입력이 `|| 1`로 1개 구매가 되는 문제, 안전 범위를 벗어난 기존 포인트·보유량에서 작은 가감이 사라지는 정밀도 문제도 확인했다.

## Fix

- 사용자 확정 정책에 따라 `/구매` 1회 최대 9,999개로 제한한다. 관리자 예외는 없다. 기존 다이아상자·당근 일일 제한과 다량 구매 불가 상품은 유지한다.
- 수량 문자열은 진입에서 한 번 변환하고 견적·쿠폰·보너스는 검증한 숫자를 그대로 사용한다. 가격·기존 보유값의 잘못된 타입을 0이나 작은 숫자로 자동 변환하지 않는다.
- 계산 결과·보유 상태·세금 적립을 변경 전에 확인하고, 저장 완료 후 구매 안내를 보낸다. 기존 저장 트랜잭션을 재사용한다.
- 쿠폰→스킬 할인→세금 순서와 반올림 규칙은 유지한다. 할인·세금의 백분율 계산은 불필요한 소수 오차가 줄도록 순서를 조정한다.
- `/상점`에서 한도를 표시하고 `/티어`의 큰 수량 견적에는 나눠 구매할 안내를 추가한다.
- 기존 과다 지급분 회수·계정 데이터 복구·상점 상품 삭제는 수행하지 않는다.

## Validation

- `node tools/test_point_shop_purchase.js`: 신규 10개 그룹. 캡처 수량·9999/10000 경계·관리자·일반 상품·0원 상품·쿠폰·스킬·세금·보너스·기존 일일 제한 확인.
- 가격·포인트·쿠폰·보유량·적립액 손상과 합산 초과를 차단하며 원본을 유지하는지 확인.
- 실제 저장·파일 교체·롤백·DEV 컨텍스트 함수를 합성 파일시스템에서 실행. 길드·회원·펫 저장 실패 때 원본 복구와 거짓 완료 안내 없음, 재시도 시 1회 지급 확인.
- 운영 데이터 스냅샷이나 Android 런타임은 변경하지 않았다. 실제 Android 동작은 별도 운영자 확인 영역이다.
- 개발 검증 기록이며 운영반영 여부는 원격 prod와 실제 반영 정보로 별도 확인한다.

---

# 2026-10-03 - `/미니펫추가` 성공 안내와 실제 보유 내역 불일치

Status: DEVELOPMENT_VALIDATED

## Reported Context

- [미니펫추가 명령어의 미니펫가방 미반영 오류 수정 요청서](https://app.notion.com/p/75b393bdd7aa8363b0550115e8be1d53): 지급 성공 안내 뒤 가방 보유 수량 14/15와 기존 목록이 표시된다는 제보.
- 당시 정확한 입력, 지급 전 수량, 저장 오류 로그는 없어 개별 제보의 직접 원인은 확정되지 않았다.
- 기존 prod ver_2.593의 실제 지급·출력 함수를 합성 데이터로 실행한 결과 정상 입력은 14 → 15마리로 저장·표시됐다. 가방 리뉴얼의 필터링 누락은 재현되지 않았다.

## Confirmed Defects

- 지급 성공 안내가 저장보다 먼저 실행되어 저장 실패 시에도 성공으로 보였다.
- 단일 공백으로 인자를 분리하여 대상 아이디의 연속 공백이 다른 저장 키를 만들었다.
- 등록 회원 확인 없이 잔여 펫 데이터를 만들었고, 숫자 접미·음수 등도 정수 파싱으로 허용했다.

## Fix

- `/미니펫추가` 분기에만 전체 입력 패턴·공백 분리·회원 확인·정수 범위 검증을 적용했다.
- 저장 후 성공 안내와 보유 수량을 출력한다. 저장 실패는 실패 안내 후 기존 오류 흐름으로 전달한다.
- 공용 `addMiniPetToUserBag`, 가방 출력, 관리자 지급 권한과 한도 초과 허용은 유지했다.
- 데이터 복구, 일괄 재지급, 기존 보유 데이터 이동은 수행하지 않았다.

## Validation

- `node tools/test_minipet_admin_add.js`: 신규 11개 그룹. 실제 저장·교체·로드·DEV 컨텍스트 함수를 메모리의 합성 파일시스템에서 실행.
- 정상 지급·재로드·가방 표시, 공백/탭·다단어 이름, 미등록 대상, 권한, 잘못된 인자·정수 경계 확인.
- 저장 기록·동기화·검증·원본 백업·파일 교체 실패 시 성공 안내 없음, 원본 유지, 재시도 1마리 지급 확인.
- ALLSEE 아래 표시와 조회 5회, DEV/PROD 분리, JSON 오류 미초기화 확인.
- Android MessengerBot 실제 파일시스템·런타임은 개발 PC의 합성 검증으로 확인할 수 없다.
- 개발 및 로컬 검증 기록이며 운영반영 여부는 Git 원격 prod와 Notion 실제 반영 속성으로 별도 확인한다.

---

# 2026-07-27 - `/펫홈 [아이디]` activity file not initialized

Status: OPERATIONAL_ACTION_REQUIRED

## Raw Error Summary

- System: `main`
- Error message: `Invalid pet home activity data`
- Trigger message: `/펫홈 리리 여`
- Room: `팻 테스트방`
- Sender: `호이 남`
- Reported source line: not provided

## Reported Context

펫홈 마음표현·홈알림·최근 방문자 기능을 `feature/prod`에 반영한 뒤 다른 유저의 펫홈을 조회하는 과정에서 오류가 발생했다. 입력 메시지에 `dev/` 접두사가 없으므로 이 명령은 운영 데이터 경로인 `/sdcard/호이랜드/`를 사용한다.

## Investigated Files / Functions

- `main.js`
  - `/펫홈` 다른 유저 방문 분기
  - `petHomeActivityFile`
  - `/펫홈활동파일생성`
  - `loadJsonFile(...)`
  - `requirePetHomeActivityData(...)`
  - `resolveActiveDataPath(...)`
- `COMMAND_INDEX.md`
  - `/펫홈`의 활동 파일 초기화 및 방문 저장 흐름
- Search keywords: `petHomeActivityData`, `requirePetHomeActivityData`, `펫홈활동파일생성`, `loadJsonFile`, `/펫홈`

## Suspected Cause

- 직접 원인: `/펫홈` 방문 분기에서 `loadJsonFile(petHomeActivityFile)`의 결과가 객체가 아니어서 `requirePetHomeActivityData(...)`의 첫 번째 검증에서 오류가 발생했다.
- 가장 유력한 원인: 운영 경로에 `/sdcard/호이랜드/petHomeActivityData.json`이 아직 생성되지 않아 `loadJsonFile(...)`이 `null`을 반환했다.
- 다른 가능성: 파일은 존재하지만 최상위 값이 `null`, 배열, 문자열 등 객체가 아닌 유효 JSON으로 저장되어 있다.
- JSON 문법 자체가 깨졌다면 `parseJsonContent(...)`에서 다른 파싱 오류가 먼저 발생하므로, 이번 오류 문구만으로는 문법 손상 가능성이 낮다.
- 오류는 방문자 수 증가와 두 파일 저장 전에 발생하므로, 이 요청으로 `visitCnt`나 최근 방문자 데이터가 일부 저장되지는 않았다.

## Recommended Fix

1. 운영 환경에서 Admin/Master가 `/펫홈활동파일생성`을 한 번 실행한다.
2. 생성 완료 안내와 운영 경로 `/sdcard/호이랜드/petHomeActivityData.json`을 확인한다.
3. `/펫홈 리리 여`를 다시 실행한다.
4. 생성 명령이 `이미 있습니다`라고 응답하면 파일을 덮어쓰지 말고 내용을 확인한다. 정상 초기 구조는 `{ "alerts": {}, "recentVisitors": {} }`이다.
5. 기존 활동 데이터가 들어 있다면 삭제·초기화하지 말고 백업 후 구조를 조사한다.

## Validation Plan

- `/펫홈활동파일생성` 최초 실행 시 통합 활동 파일이 생성되는지 확인
- 같은 명령을 다시 실행해 기존 파일이 덮어써지지 않는지 확인
- `/펫홈 리리 여` 재실행 시 방문자 수와 최근 방문자 기록이 각각 한 번만 증가하는지 확인
- `/홈알림`에서 최근 방문자 목록이 표시되고 방문 기록이 새로운 알림 수에는 포함되지 않는지 확인
- Android MessengerBot Rhino 운영 경로에서 확인

## Follow-up Notes

- 현재 조사에서는 코드 변경이나 운영 데이터 수정을 수행하지 않았다.
- 초기화 명령 실행 후에도 같은 오류가 반복되면 실제 파일 내용과 `[ERROR : loadJsonFile]` 로그를 함께 확보해야 한다.

---

# 2026-07-19 - `/자동일퀘` pet-skill activation summary undefined identifier

Status: FIXED_IN_PROD

## Raw Error Summary

- System: `main`
- Message: `"PET_SKILL_DEFINITIONS" is not defined.`
- Reported file: `main`
- Reported line: `31220`
- Trigger message: `ㅇㅋㅋ` (`/자동일퀘` alias)
- Room: `팻 테스트방`
- Sender: `호이 남`

## Reported Context

자동일퀘가 시련의 탑, 캐슬대전, 미니펫대전을 진행한 뒤 최종 결과 메시지에서 발동 펫스킬 횟수를 정리하는 단계에 도달하면 런타임 오류가 발생했다.

## Investigated Files / Functions

- `main.js`
  - `runAutoDailyQuest(...)`
  - `buildAutoDailyQuestMessage(...)`
  - `formatAutoDailyPetSkillActivationLines(...)`
  - `PET_SKILL_LIST`
  - `normalizePetSkillName(...)`
- `COMMAND_INDEX.md`
  - `/자동일퀘` 내부 명령 실행 및 저장 배치 흐름

## Suspected Cause

- 확정 원인: `formatAutoDailyPetSkillActivationLines(...)`가 실제 펫스킬 정의 배열인 `PET_SKILL_LIST` 대신 존재하지 않는 `PET_SKILL_DEFINITIONS`를 두 곳에서 참조했다.
- Node 문법 검사는 미정의 전역 참조를 실행하지 않으므로 통과했으며, 이전 독립 집계 테스트도 잘못된 이름의 모의 배열을 주입해 실제 런타임 결함을 가렸다.
- 오류는 자동 전투와 배치 내 저장 처리가 끝난 뒤 결과 메시지를 만드는 과정에서 발생했다. 보고된 로그만으로 운영 저장 완료 여부를 단정할 수는 없지만, 수정 과정에서 저장 순서나 데이터 경로는 변경하지 않았다.

## Recommended Fix

- 펫스킬 발동 집계 함수의 두 반복문이 기존 전역 `PET_SKILL_LIST`를 사용하도록 교체한다.
- 테스트에서 별도 정의 배열을 만들지 않고 실제 소스의 전역명과 함수 참조가 일치하는지 검증한다.
- 자동일퀘의 기존 메모리 배치와 `commitAutoDailyBatch(...)` 저장 순서는 유지한다.

## Validation Plan

- `node --check main.js`
- `node --check Info.js`
- `PET_SKILL_DEFINITIONS` 잔여 참조가 없는지 검색
- 실제 `PET_SKILL_LIST`를 사용해 `약탈자📙`, `숙련된 전사✨` 발동 메시지 집계 검증
- 운영 스냅샷 JSON 읽기 전용 파싱
- Android MessengerBot Rhino에서 `/자동일퀘` 또는 `ㅇㅋㅋ` 재실행 확인

## Follow-up Notes

- `feature/bugFix` 커밋 `2e3a10f`에서 잘못된 전역 참조를 `PET_SKILL_LIST`로 교체했다.
- 실제 `PET_SKILL_LIST`를 읽어 `약탈자` 2회와 `숙련된 전사` 1회 발동 집계를 검증했다.
- 코드 수정과 오류 기록 커밋 `2e3a10f`, `4bd7c5b`를 `feature/prod`에 반영했다.
- 실제 Android MessengerBot Rhino의 `/자동일퀘` 또는 `ㅇㅋㅋ` 재실행은 운영 봇에서 확인이 필요하다.

---

# 2026-07-18 - `member.json` malformed JSON and blocked `/봇살리기`

Status: FIXED_IN_BRANCH

## Raw Error Summary

- Symptom: 최근 운영 중 `member.json` 끝부분에 불필요한 `}}` 등이 기록되어 JSON 파싱이 실패함
- Trigger period: 계정정지 기능과 최근 길드영지 관련 업데이트 이후 2~3일
- Recovery symptom: `/봇살리기`를 입력해도 직전 백업 복구 분기까지 도달하지 못함
- Exact Android stack/line: not provided

## Reported Context

기존에는 운영 파일이 손상되어도 `/봇살리기`로 `member_back.json`을 복원할 수 있었으나, 계정정지 검사 추가 이후에는 모든 슬래시 명령이 복구 분기보다 먼저 현재 `member.json`을 파싱했다.

## Investigated Files / Functions

- `main.js`
  - `response(...)`의 계정정지 선검사와 `/봇살리기` 처리 순서
  - 매 슬래시 명령 전 `member.json`, `member_pet.json`, `petSkillData.json` 직전 백업 흐름
  - `loadJsonFile(...)`, `parseJsonContent(...)`, `saveJsonFile(...)`
  - 길드영지 타이머의 비동기 member/guild 저장 흐름
- Repository snapshots
  - `data/member.json`, `data/member_pet.json`, `data/petSkillData.json`, `data/guildData.json`은 조사 시점에 정상 파싱됨

## Suspected Cause

- 확정 원인: 계정정지 검사가 `/봇살리기`보다 먼저 손상된 `member.json`을 파싱하여 복구 명령 자체를 차단했다.
- 손상 유력 원인: 기존 `saveJsonFile(...)`이 본 파일에 직접 기록했고 경로별 저장 잠금, 임시 파일 검증, 교체 롤백이 없어 동시 응답이나 비동기 타이머 저장 중 부분·경쟁 기록에 취약했다.
- 계정정지 데이터 구조가 직접 잘못된 JSON을 생성했다는 증거는 확인되지 않았다. 추가 선행 로드는 기존 저장 취약점의 노출 가능성을 높인 정황으로만 본다.

## Recommended Fix

- `/봇살리기`를 계정정지 검사와 현재 member 파싱보다 먼저 처리한다.
- 계정정지 검사에서 읽은 정상 member 객체를 공통 명령 처리에서 재사용한다.
- `member.json`과 `member_back.json`은 경로별 잠금 안에서 임시 파일 기록, UTF-8 재파싱, 디스크 동기화, 롤백 가능한 교체를 수행한다.
- 파싱 실패를 빈 객체로 대체하지 않고 기존 오류 흐름을 유지한다.

## Validation Plan

- `node --check main.js`
- 저장 관련 운영 스냅샷 JSON 읽기 전용 파싱
- DEV의 손상된 `member.json` 복사본에서 `dev/봇살리기`가 직전 백업으로 복구되는지 확인
- Android Rhino에서 연속 명령과 영지전 타이머가 겹쳐도 member/backup JSON이 정상 파싱되는지 확인

## Follow-up Notes

- `/봇살리기` 선처리, 계정정지용 member 로드 재사용, member/직전 백업 검증 저장을 `feature/bugFix`에 적용했다.
- Android `FileDescriptor.sync()`와 `File.renameTo(...)` 동작은 운영 PC DEV 환경 검증이 필요하다.

---

# 2026-06-05 - `/??` date display `formatDate` undefined

Status: FIXED_IN_BRANCH

## Raw Error Summary

- System: `main`
- Message: `"formatDate" is not defined.`
- Reported file: `main`
- Reported line: `35233`
- Trigger message: `/?? ??`
- Room: `? ????`
- Sender: `?? ?`

## Reported Context

`/?? ??` reached the ?? ??? ?? message builder and crashed while formatting the date text for ???? or ?????.

## Investigated Files / Functions

- `main.js`
  - `/??` branch calls `buildPendingUserIdCheckMessage(...)`.
  - `buildPendingUserIdCheckMessage(...)` calls `formatPendingUserIdDateText(...)` for joined and light attendance records.
  - `formatPendingUserIdDateText(...)` calls `formatDate(dateText)` at the reported line `35233`.
  - `formatDate2(...)` exists in `main.js` and formats `YYYYMMDD` as `MM? DD?`.
  - `formatDateTime(...)` exists in `main.js`, but it is for date-time text.
- `Info.js`
  - `formatDate(...)` exists only in `Info.js` and formats `YYYYMMDD` as `YYYY? MM? DD?`.

## Suspected Cause

The `/??` helper was added to `main.js` using `formatDate(...)`, but that helper is not defined in the `main.js` runtime scope. It likely passed Node syntax checks because undefined function references are runtime errors, not syntax errors.

The command crashes only when `formatPendingUserIdDateText(...)` receives a non-empty date, such as an existing ??? or ??? ?? recent date.

## Recommended Fix

- Replace the `formatDate(...)` call inside `formatPendingUserIdDateText(...)` with a date formatter available in `main.js`.
- Preferred minimal fix options:
  - use existing `formatDate2(dateText)` if `MM? DD?` display is acceptable for `/??`, or
  - add a small `main.js` local helper for `YYYY? MM? DD?` if the `/??` output should match `/??` style dates.
- Preserve `/??` output line breaks and status labels.
- After source fix, update `COMMAND_INDEX.md` only if helper/data-flow details change materially.

## Validation Plan

- Run `node --check main.js`.
- Run `node --check Info.js`.
- Validate `/?? ??` where a matching joined or ??? ?? row has a non-empty date.
- Validate `/?? ??` with no matches still shows ????/????/????? without crashing.

## Follow-up Notes

- Added `formatPendingUserIdDateValue(...)` in `main.js` and changed `formatPendingUserIdDateText(...)` to use it instead of the `Info.js`-only `formatDate(...)`.
- Updated `HoiBotVersion` and `data/hoiBotChangeLog.json` to `2.175`.
- Validation planned before production reflection: `node --check main.js`, `node --check Info.js`, and a focused `/??` date-format helper check.


---

# 2026-06-01 - `/출석목록` rank lookup undefined

Status: FIXED_IN_BRANCH

## Raw Error Summary

- System: `info`
- Message: `Cannot read property "rank" from undefined`
- Reported file: `info`
- Reported line: `635`
- Trigger message: `/출석목록`
- Room: `팻 테스트방`
- Sender: `호이 남`

## Reported Context

`/출석목록` builds display rows from `data.attend_list` and directly reads `data.member[user].rank.emoji` for each attended user. The reported line is in the second-page mapping branch, so the failing entry was likely the 11th attended user or later.

## Investigated Files / Functions

- `Info.js`
  - `/출석목록` branch at lines `622-638`
  - `data.attend_list` is read directly and split into top 10 plus remaining users.
  - No existence guard is present before `data.member[user].rank.emoji`.
- `main.js`
  - Attendance command around lines `3505-3546` pushes `sender` into `data.attend_list` and updates `data.member[sender]`.
  - Reset helper around lines `27099-27105` already checks `data.member.hasOwnProperty(user)` before resetting `today`, then clears `data.attend_list`.
- `COMMAND_INDEX.md`
  - `/출석목록` entry records `data.attend_list` and `data.member[user].rank.emoji`.
- `data/member.json`
  - Current repository snapshot check: `attend_list` count `249`, missing `data.member[user]` entries `0`, missing `rank` entries `0`.

## Suspected Cause

The active runtime data likely contains at least one name in `data.attend_list` that no longer exists in `data.member`, or exists in a different spelling/key than the member record. Because `/출석목록` directly dereferences `data.member[user].rank.emoji`, any stale or orphaned attendance-list entry crashes the command.

This was not reproducible from the repository snapshot because all current `attend_list` entries have corresponding member and rank records.

## Recommended Fix

- In `/출석목록`, filter or format attendance users through a small guard before reading `rank.emoji`.
- Preserve the current output order, line breaks, and `allsee` behavior.
- Decide the desired user-facing behavior for orphaned attendance entries before code change:
  - skip invalid attendance names, or
  - show them with a fallback rank marker and keep the name visible for operator cleanup.
- If the fix changes command/data-flow behavior, update `COMMAND_INDEX.md` after source verification.

## Validation Plan

- Run `node --check Info.js`.
- Run `node --check main.js`.
- Create a copied DEV-style member snapshot where `data.attend_list[10]` contains a missing member key, then verify `/출석목록` no longer throws.
- Verify normal `/출석목록` output still shows the first 10 users, `allsee`, and remaining users in the same order.

## Follow-up Notes

- Added a guarded attendance row formatter in `Info.js` so missing member/rank data no longer crashes `/출석목록`.
- Updated `COMMAND_INDEX.md` with the guarded formatting behavior.
- If this error repeats before the next reset, inspect the live `/sdcard/호이랜드/` member data for orphaned names in `attend_list`.

---

# 2026-05-19 - `noticeMsg is not a function`

Status: FIXED_IN_BRANCH

## Raw Error Summary

- System: `main`
- Message: `noticeMsg is not a function, it is undefined.`
- Reported file: `main`
- Reported line: `4533`
- Trigger message: `미국향기가뭔데 `
- Room: `💖신생💖20대 30대 반말방🎙️보이스룸 수다 벙`
- Sender: `유후 여`

## Root Cause

Inside `response(...)`, `var noticeMsg = ""` was declared as a local message-building variable for the punch-machine legend notice.

Because `var` is function-scoped, Rhino/JavaScript hoisted that local declaration to the top of `response(...)`. That shadowed the top-level `noticeMsg(msg)` helper throughout `response(...)`, so earlier call sites such as line `4533` saw `noticeMsg` as the local undefined variable instead of the global notice function.

## Fix

- Renamed the local punch-machine message variable from `noticeMsg` to `punchLegendNoticeMsg`.
- Removed the function-scope name collision without changing notice output text.

## Validation

- Run `node --check main.js`.
- Run `node --check Info.js`.
- Confirm no local `var/let/const noticeMsg` declaration remains in `main.js`.
