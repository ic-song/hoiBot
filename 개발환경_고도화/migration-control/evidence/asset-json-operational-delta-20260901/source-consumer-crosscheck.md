# 운영 JSON source/consumer 교차검증

- 실행 ID: `자산카탈로그-JSON-DELTA-READONLY-20260901T005943`
- 기준 코드: `C:/Users/user/Desktop/hoiBot/main.js`, `Info.js`
- 목적: identity 추가·삭제·의미 변경이 실제 운영 명령 결과인지, 외부 편집 결과인지 구분한다.

## 직접 CRUD되는 운영 원본

| JSON pointer | 쓰기 근거 | 읽기/소비 근거 | 결론 |
|---|---|---|---|
| `packageInfo.json#$[]` | `main.js:15572`, `15587`, `15596`, `15611`, `15620`; helper `38099:38327` | 지급·사용 `15627:15668`, `38414:38528` | 관리자 패키지 추가·수정·삭제·활성 명령이 직접 갱신한다. +102/-1/reward3 delta는 운영 CRUD 결과로 분류한다. |
| `itemList.json#$.nonItems`, `#$.untradableList` | `main.js:16915`, `16931`, `16952`, `16973` | 판매/거래 판정 `39961:39969`, `41492` | 관리자 금지목록 CRUD 결과다. 추가·삭제를 새 policy version 후보로 유지한다. |
| `member.json#$.shop` | `main.js:6558`, `6572` 후 member 저장 흐름 | `Info.js:798:805`, 구매 `main.js:17720:17741` | 일반 상점 운영 CRUD 결과다. |
| `member.json#$.matzangField.shop` | `main.js:3416`, `3427`; 초기값 `40222:40227` | `main.js:3371:3390` | 다이아/맞짱 상점 운영 CRUD와 기본 설정 projection 결과다. |
| `guildData.json#$.shop` | `main.js:26175:26216` | `main.js:15457`, `25986:26074` | 길드상점 운영 CRUD 결과이며 현재 projection hash는 기준선과 같다. |
| `member.json#$.HoiCastle.taxRate` | `main.js:18480`, `18483` | `Info.js:803:825`, `main.js:14618`, `15469` | 영주 세율 변경 명령의 운영 값이다. 별도 configuration version 후보로 유지한다. |
| `petExploreData.json#$.notice` | `main.js:23748:23749` | 초기화 `45424:45425`, 표시 `47726:47727` | 관리자 공지 변경 결과다. managed content version 후보로 유지한다. |
| `requestMonitorConfig.json#$` | 부팅 시 기본값 보정 후 `main.js:749:764` | 동일 구간에서 제한값으로 사용 | 기준 SHA와 동일하므로 carry-forward한다. |

## 코드에서 읽기 전용인 정의 원본

| JSON pointer | 읽기 근거 | 저장 검색 결과 | 결론 |
|---|---|---|---|
| `itemInfo.json#$` | `main.js:1990:1993`, `Info.js:269:296` | `saveJsonFile(..., itemInfoPath)` 없음 | 논리 레코드가 동일하므로 기존 정의를 carry-forward한다. |
| `miniPetCollectionInfo.json#$` | `main.js:1991` | 해당 path 저장 없음 | 논리 내용 동일 carry-forward. |
| `miniPetData.json#$` | `main.js:1996`, `Info.js:1070:1071` | 해당 path 저장 없음 | 논리 내용 동일. display name 중복 33건은 stable code 분리 유지. |
| `petSweetHomeInfo.json#$.homeInfo/#$.furniture` | `main.js:20991`, `21043`, `21110`, `22679` | `saveJsonFile(..., homeInfoFile)` 없음 | +896 pool 행, recipe299 변경은 런타임 CRUD가 아니라 운영 정의 파일 변경이다. 아래 ADB 운영 스냅샷 provenance가 확인되어 현재 운영 definition truth로 분류한다. |
| `trialTowerBoss.json#$`, `eventTowerBoss.json#$` | `main.js:1994:1995` | 해당 path 저장 없음 | reward 120+1 변경은 런타임 CRUD가 아니라 운영 정의 파일 변경이다. 아래 ADB 운영 스냅샷 provenance가 확인되어 현재 운영 definition truth로 분류한다. |
| `hoiBotChangeLog.json#$.entries` | `/개발자노트` 읽기 `main.js:5852:5859` | 런타임 저장 없음 | Git 개발자노트 원본이다. 신규 version 38개는 내용 catalog 증분으로 분류한다. |

## 경로 이동 판정

`member.json#$.allowedUsers2/#$.allowedUsers4/#$.allowedUsers6/#$.allowedUsersHoipass`는 우발 누락이 아니다.

- `main.js:28344:28353`의 `/데이터정리` 흐름이 legacy pass 배열을 명시적으로 삭제한다.
- replacement 저장소는 `main.js:35183:35188`의 `member.<사용자>.pass`다.
- 활성 판정은 `main.js:35247:35264`에서 새 pass 구조를 우선 읽고 legacy 배열은 임시 fallback으로만 읽는다.
- 따라서 네 legacy 경로는 `PATH_RETIRED_TO_MEMBER_PASS`, 신규 canonical target은 pass subscription/entitlement ownership이다.
- 이는 자산 catalog가 아니라 보유·권한 상태다. 삭제 migration이 아니라 기존 pass ownership Gate/evidence를 carry-forward한다.

## 운영 스냅샷 provenance

- snapshot commit: `82a0373d3666b6afa29912ef9441273d20375266` (`2026-09-01T00:00:33+09:00`, parent `0b20c9bf2da1b6e26885ebe017ed030de9ac7e46`)
- commit 범위에서 `data/petSweetHomeInfo.json`, `data/trialTowerBoss.json`, `data/eventTowerBoss.json` 세 파일이 모두 변경되었다.
- 당시 `tools/07_데이터_백업.bat`는 `/storage/emulated/0/호이랜드` 전체를 ADB pull한 뒤 저장소 `data`를 완전 교체하는 계약이었다. Git/DB import는 수행하지 않는 버전이었다.
- 세 파일의 저장소 수정 시각은 `2026-09-01 00:12 KST`이고, 현재 파일 hash는 snapshot manifest의 current SHA-256과 일치한다.
- 따라서 세 delta의 source authority는 `OPERATIONAL_ADB_SNAPSHOT`으로 확정한다. 런타임 save path가 없다는 사실은 정의가 외부 운영 파일로 관리됨을 뜻하며, 현행 운영값을 격리할 사유가 되지 않는다.
- 다만 이 확인은 카탈로그 분류 근거일 뿐 DB import, provider publish, 기존 Gate reset 또는 Gate8 승인이 아니다.

## 최종 후보 상태

| 구분 | 상태 |
|---|---|
| 운영 CRUD로 설명되는 delta | package, item restriction, shop, tax rate, pet explore notice |
| 직렬화만 달라진 delta | itemInfo, miniPetData, miniPetCollectionInfo |
| 운영 스냅샷 원천 확인 | petSweetHomeInfo draw/recipe, trial/event tower reward (`OPERATIONAL_ADB_SNAPSHOT`) |
| 경로 이동 해결 | legacy `allowedUsers*` → `member.*.pass` |
| 후보 상태 | `PUBLISH_READY_AWAIT_FOREMAN_APPROVAL` |

`ASSET-FREEZE-v2.435-OPERATING-JSON-DELTA-20260901-01-CANDIDATE`는 분류 동결 승인 가능한 상태다. 작업반장 승인 전 이름의 `CANDIDATE`를 제거하거나 DB import하지 않는다.
