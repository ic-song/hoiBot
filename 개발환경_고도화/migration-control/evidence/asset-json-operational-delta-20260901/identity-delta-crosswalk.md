# 운영 JSON 카탈로그 교정 후보 교차표

- 실행 ID: `자산카탈로그-JSON-DELTA-READONLY-20260901T005943`
- 비교 기준: `ASSET-FREEZE-v2.435-8f075b4e-02`
- 후보 버전: `ASSET-FREEZE-v2.435-OPERATING-JSON-DELTA-20260901-01-CANDIDATE`
- 원본: `C:/Users/user/Desktop/hoiBot/data`
- 원본 JSON, DB, schema/provider/migration, 기존 Gate는 변경하지 않았다.

## 관리 대상

| 원본 | 관리 단위 | 권장 canonical target | 판정 |
|---|---|---|---|
| `itemInfo.json` | 캐슬 아이템, 영지 공격·방어권, 정령, 레이드 특수 아이템, 반지 정의 | `item_definitions` + source binding | 파일 직렬화만 변경, 논리 정의 동일 |
| `itemList.json` | 비아이템/거래불가 정책 | item restriction policy version | 추가·삭제 있음, 새 정책 버전 필요 |
| `miniPetData.json` | 미니펫 정의, 등급 확률 | mini-pet definition/policy | 논리 내용 동일. 이름 중복 33건은 병합 금지, stable code 필요 |
| `miniPetCollectionInfo.json` | 등급/단계 보상, 타이틀 가격 | mini-pet collection policy | 파일 직렬화만 변경, 논리 내용 동일 |
| `packageInfo.json` | 패키지 정의, 보상, 사용 제한 | 기존 package catalog + reward rules | ID 102개 추가, 1개 삭제, 3개 보상 변경 |
| `petSweetHomeInfo.json#furniture` | 가구 정의와 추첨 pool 행/중복 수 | furniture definition + draw-pool rows/weight | 21 identity 추가, pool 행 +896, 86 identity의 중복 수 변경 |
| `petSweetHomeInfo.json#homeInfo` | 건물 정의와 재료 요구량 | home building definition/recipe | 300 identity 유지, 299개 `required` 변경 |
| `trialTowerBoss.json`, `eventTowerBoss.json` | 보스·층·보상 | tower definition/reward policy | identity 유지, 보상 값 변경 |
| `member.json#shop`, `#lordShop`, `#matzangField.shop` | 상점 품목·가격·수량 | shop catalog/policy | 일반 상점 및 맞짱 상점 교정 필요 |
| `guildData.json#shop` | 길드 상점 | guild shop catalog | 동일 hash carry-forward |
| `member.json#HoiCastle.taxRate`, `#hoiHappyFoundation.feeRate`, `#petSkillSystem` | 운영 상수 | 별도 configuration set/menu | 세율 1건 변경, 나머지 동일 |
| `requestMonitorConfig.json` | 제한 시간·횟수·제외 명령/방 | system configuration set | 동일 SHA carry-forward |
| `petExploreData.json#notice` | 운영 고정 안내문 | managed content/configuration | 문구 변경 |
| `hoiBotChangeLog.json#entries` | 개발자노트 콘텐츠 | managed content catalog | 버전 identity 38개 추가 |
| `member.json#master/#admin/#allowedUsers*` | 접근 권한 구성 | access-control 관리 메뉴 | 자산 정의와 분리. `allowedUsers*` 4경로는 현재 원본에서 사라져 replacement 확인 필요 |

## 정의 원본이 아닌 crosswalk

아래 경로의 아이템·스킬·타이틀·가구명은 보유/진행 데이터다. 신규 정의를 만드는 원본으로 승격하지 않고, canonical 정의가 빠졌는지 확인하는 참조 집합으로만 사용한다.

| 원본 경로 | crosswalk 대상 | canonical truth |
|---|---|---|
| `guildData.json#guilds.*.warehouse` | 길드 창고 아이템명 | item/object catalog |
| `member_pet.json#*.pettype/#*.petimg/#*.elemental/#*.ring` | 펫 외형·정령·반지 참조 | pet appearance + item definitions |
| `member_title.json#member.*`, `pet_title.json#member.*`, `miniPet_title.json#member.*` | 보유 타이틀 참조 | 각 title definition catalog |
| `miniPet_collection.json#member.*` | 보유 미니펫 참조 | mini-pet definitions |
| `petSkillData.json#*.petSkills.*` | 보유 펫스킬 참조 | pet-skill definitions |
| `petSweetHomeData.json#*.placedFurniture.*`, `#*.furnitureBag.*` | 배치·보유 가구 참조 | furniture definitions |

사용자명, 보유량, 장착 위치, 진행 상태, 타이머는 projection에서 제외한다. crosswalk의 추가·삭제는 자산 추가·삭제로 간주하지 않는다.

## 제외

- 날짜형 백업, `_back*`, 사본, 이전 구조 파일 718개는 현행 카탈로그 입력에서 제외한다.
- `attendanceLight`, `board`, `carrotBoard`, `castleBattle*`, `currencyLog`, `errorLog`, `freeMarket`, `packageLog`, `punchRankData`, `trialTower`는 상태·원장·로그·랭킹·사용자 콘텐츠다.
- 신규 `petHomeActivityData.json`, `petHomePlacedFurniture.json`도 실행 이력/배치 상태이므로 카탈로그가 아니다.
- `memberBagCheck/memberBagCheck.json`과 `castleBattle.json`의 현재 경로 소실은 카탈로그 삭제가 아니라 레거시 상태 경로 변경으로 분류한다.

## 구현 전 중지 조건

1. `miniPetData`의 동일 이름 33건을 이름만으로 병합하지 않는다.
2. `petSweetHomeInfo#furniture`의 중복 행은 추첨 가중치 의미가 있으므로 단순 DISTINCT 하지 않는다.
3. `allowedUsers*`가 사라진 원인을 replacement provider/DB 기준으로 확인하기 전 삭제 migration을 만들지 않는다.
4. 최신 운영 값을 기존 동결 버전에 덮어쓰거나 기존 Gate를 초기화하지 않는다.
5. 실제 교정 구현은 별도 Lease와 승인된 candidate version 이후에만 시작한다.
