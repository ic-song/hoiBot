# SL-COMMON-ASSET-COVERAGE-CORRECTION-02 분류 동결 결정

## 기준과 범위

- 분류 baseline: `23ca3409764fbb2ac82f20f562a817926d496dc5`
- 조사 대상: `origin/feature/prod`의 `main.js`, `Info.js`, 추적 중인 `data/**/*.json`
- 동결 catalog version: `ASSET-FREEZE-v2.435-8f075b4e-02`
- 현재 단계: `FREEZE_CLASSIFICATION`
- 금지: schema/provider/migration/runtime/Gate 변경, feature/prod 및 운영 DB 변경

`main.js`와 `Info.js`의 명명 카탈로그만이 아니라 모든 정적 문자열·숫자 literal을 포함한다. 실행 중 생성되는 보유량, 전투 상태, 로그, 타이머 handle은 정의 카탈로그가 아니므로 별도 상태·보유 모델로 유지한다. 단, 그 상태의 초기값·한도·확률·주기·비용·보상·멘트·효과·명령 정책은 관리 대상이다.

## 포함·부분·제외 동결

`coverage-manifest.json`은 다음을 빠짐없이 식별한다.

- JavaScript: 모든 literal 발생 위치에 `disposition`, 명시 사유, `domain`, `consumer`, `canonicalTarget`을 기록한다. 구현 인덱스·파서 산술만 `EXCLUDED`로 분리한다.
- JSON: 33개 파일 각각의 모든 leaf를 `INCLUDED`, `CROSSWALK`, `EXCLUDED` 중 하나로 배정하고 건수·path-set hash를 기록한다. 혼합 상태 파일의 미지정 leaf는 명시 사유가 있는 실행상태 제외로 확정한다.
- 명명 카탈로그: 17개 심볼을 leaf 단위로 기록한다.
- 보유 JSON에 등장하는 아이템·스킬·가구·타이틀·미니펫 이름은 정의 seed로 취급하지 않고 canonical definition과의 crosswalk/parity 검증 자료로만 사용한다.

JSON 판정 요약:

| 판정 | 파일 수 | 의미 |
|---|---:|---|
| INCLUDED | 10 | 파일 전체 또는 명시 경로가 정의·정책·콘텐츠 CRUD 대상 |
| PARTIAL | 11 | 정의/상점/콘텐츠 경로 또는 definition crosswalk만 대상, 보유·실행 상태는 제외 |
| EXCLUDED | 12 | 보유·로그·랭킹·사용자 생성 콘텐츠·실행 상태이며 정적 카탈로그가 아님 |

세부 경로 규칙은 manifest의 `sourceSnapshots.json[*].classification`, leaf 배정 결과는 `leafCoverage`를 source of truth로 한다. JavaScript와 JSON 모두 미배정 gap은 0이다.

## 충돌 canonical truth

### ticketTierData

- `main.js`: 티어 결정, 승급·강등 EXP, 수수료, 보너스 등 실제 mutation/runtime 계산에 사용된다.
- `Info.js`: 조회·표시용 read model이다.
- 판정: `main.js`의 41 tier/287 leaf를 canonical truth로 한다.
- 확인된 drift: 20 tier의 49 leaf.
- 처리: `Info.js` 값을 별도 seed하지 않고 canonical tier provider projection으로 교체한다. drift 49건은 migration parity fixture에서 `main expected / Info legacy observed`로 보존한다.

### GLOBAL_CONFIG

- 동일 key의 충돌은 runtime을 수행하는 `main.js` 값을 canonical truth로 한다.
- 충돌: `miniPet.battleBagMax` 9/13, `cleanupTriggerCount` 9/13, `cleanupKeepCount` 8/12, `happyFoundation.transferFeeMax` 25/16.
- `Info.js` 전용 `petSkill.charmSkills`는 중복 정의로 유지하지 않는다. `skill_definitions`의 매력·조건 필드와 pet-skill policy에서 파생한다.
- `Info.js`는 canonical configuration/pet-skill provider의 read projection으로 전환한다.

## stable key와 기존 모델 수렴

이름이 같거나 비슷하다는 이유로 병합하지 않는다. 특히 `십원`과 `구원`은 서로 다른 펫스킬 identity를 유지한다. display name은 변경 가능 속성이며 stable key가 아니다.

| 영역 | canonical definition/policy | stable key | legacy binding | 보유·실행 모델 | FK/provider 순서 |
|---|---|---|---|---|---|
| 공용 object | `object_registry`, `object_aliases`, `object_source_bindings` | `object_key` | source system/table/key | 없음 | ObjectCatalog → domain definition |
| STACK item | `item_definitions` | `code` | JSON path + 원문 item name alias | `inventory_stacks`, `inventory_ledger` | ObjectCatalog/ItemProvider → inventory |
| NON-STACK item | `item_definitions` | `code` | JSON path + 원문 item name alias | `inventory_instances`, domain instance/ledger | ItemProvider → instance provider |
| 펫스킬 | `skill_definitions` + pet-skill definition/policy tables | `skill_definitions.code` | `PET_SKILL_LIST` index/name/hash | `pet_skill_inventory`, `pet_skills`, ledgers | ObjectCatalog(SKILL) → SkillProvider → ownership |
| 펫 외형/종 | `pet_definitions` | `code` | `petTypes1/2/3` group/index/emoji | `player_pets` | ObjectCatalog(PET) → PetProvider → player_pets |
| 미니펫 | `mini_pet_definitions`, `mini_pet_grade_definitions`, combine policy tables | definition `code`; legacy row는 `source-row-NNNN` | `mini_pet_definition_source_bindings` | `owned_mini_pets`, collection/equip ledgers | ObjectCatalog(MINI_PET) → MiniPetProvider → ownership |
| 가구/주택 | `furniture_definitions`, home building definition/policy tables | definition `code` | info JSON source index/key | `furniture_inventory_instances`, placement/ledger | ObjectCatalog(FURNITURE/HOME_BUILDING) → HomeProvider |
| 패키지 | 기존 `package_definitions`/catalog 호환 계층, reward target은 canonical definition | package `code`; catalog row stable id | `packageInfo` id/index/hash | purchases/ledger는 호환 유지 | Package adapter → ItemProvider; 신규 4번째 provider 금지 |
| 타이틀 | `title_definitions`와 domain title definitions | definition `code` | legacy display/name/path | player/pet/mini-pet title ownership | ObjectCatalog(TITLE/PET_TITLE) → TitleProvider |
| 길드상점 | `guild_shop_items`, catalog state/events | `product_id` | `guildData.shop` source key | 구매·길드 자원 ledger | ItemProvider + GuildShopProvider |
| 티어 | 기존 rank/tier policy domain의 versioned definition | immutable tier code | `ticketTierData` key | player rank profile | TierPolicyProvider → read/mutation consumers |
| 펜던트 | 기존 pendant definition + `pendant_upgrade_policy_versions/levels` | definition code + `(policy_code, policy_version, target_level)` | table symbol/path/level | inventory instance/equip/upgrade ledgers | ItemProvider → PendantPolicyProvider |
| 시련탑/이벤트탑 | `trial_tower_boss_bands`, `trial_tower_event_bosses` | season/policy key + floor band/order | JSON row index/hash | progress/attempt/RNG ledgers | TowerPolicyProvider → tower runtime |
| 운영 설정 | typed domain policy tables 우선, 단순 scalar/bootstrap은 `configuration_sets/values` | `(set_code, version, config_key)` | file/symbol/leaf path | change log only | ConfigurationProvider → domain provider |
| 메시지/효과/명령 | domain definition의 versioned content/policy; 공용일 때만 공용 content/command policy | domain + stable content/trigger code + version | source file/line/hash | audit/change log | configuration/content provider → consumer |

`package_item_*` 및 기존 package 호환 테이블은 즉시 삭제하지 않는다. retirement dependency가 닫히기 전까지 호환 계층으로 유지한다.

## CRUD lifecycle

- 생성은 항상 `DRAFT` version으로 시작한다.
- publish는 validation 및 참조 무결성을 통과한 한 version만 활성 pointer로 전환한다.
- 참조된 definition/policy는 hard delete하지 않는다. `active=false`, `RETIRED`, 유효기간 종료로 비활성화한다.
- 수정은 in-place 의미 변경이 아니라 새 version을 발행한다. identity/display alias 변경은 별도로 기록한다.
- 모든 mutation은 actor, operation/idempotency key, expected version, before/after, source hash를 change log에 남긴다.
- rollback은 이전 published version/pointer 복귀로 수행하며 보유·ledger 행을 삭제하거나 되감지 않는다.

## JSON → staging → canonical 계약

1. 입력 commit·파일 SHA-256·catalog version을 고정하고 UTF-8/JSON parse를 검증한다.
2. staging에는 `source_file`, `source_path`, `source_index`, `legacy_key`, `normalized_candidate_key`, `raw_hash`, `payload`를 적재한다.
3. stable key 또는 기존 source binding으로만 canonical row를 해석한다. 이름 유사도 자동 병합은 금지한다.
4. 동일 stable key에 서로 다른 raw payload가 들어오거나 한 legacy key가 여러 canonical id로 해석되면 즉시 중단한다.
5. definition/policy를 먼저 적재하고 FK가 필요한 reward/shop/package/content를 뒤에 적재한다. ownership crosswalk는 정의 parity가 통과한 뒤 검증하며 catalog 단계에서 보유량을 변경하지 않는다.
6. dry-run은 동일 transaction에서 row/hash/weight/FK/orphan/parity를 검사한 후 강제 rollback한다.
7. apply 후 같은 입력을 다시 replay하여 applied row 0 또는 동일 idempotent 결과, version 불변을 증명한다.
8. rollback fixture는 publish pointer를 이전 version으로 되돌리고 definition/ownership/ledger 수가 보존됨을 검증한다.
9. reconnect fixture는 DB 재연결 후 provider가 동일 catalog version·row count·hash를 읽는지 검증한다.
10. Shadow fixture는 legacy consumer 결과와 canonical provider 결과를 명령/TC별로 비교한다. 알려진 Info drift는 `main.js` expected를 기준으로 한다.

필수 parity:

- definition row count, stable key unique count, source binding count
- leaf/value hash와 draw pool row/weight 합계
- reward target FK 및 orphan 0
- 보유 crosswalk unresolved/ambiguous 0
- disabled/retired row가 신규 draw/grant에는 노출되지 않되 기존 보유 조회에는 유지
- dry-run rollback 후 DB 변화 0
- replay 두 번 후 중복 row 0

## dependency graph

1. 기존 `SL-COMMON-ASSET-CATALOG-PROVIDER-01`과 object catalog evidence를 carry-forward한다.
2. scalar/bootstrap configuration의 version/publish/audit/rollback 계층을 확정한다.
3. 펫스킬 정의·호환·draw·효과와 post-baseline 3개를 보정한다.
4. 펫 외형 정의를 기존 `player_pets` 보유 모델에 연결한다.
5. 미니펫 grade/조합 159행을 기존 definition/ownership에 연결한다.
6. `GLOBAL_CONFIG`와 인라인 rate/limit/cost/schedule/message/effect를 도메인 policy slice로 분할한다.
7. guild resource/warehouse crosswalk를 canonical item/currency에 수렴한다.
8. WBS626의 분류 의존성은 WBS682의 명시적 disposition/canonical/backlog 동결로 종결한다. 실제 legacy 직접 소비 0 검증은 후속 구현 consumer closure에서 수행한다.

## 현재 readiness

분류 동결, 백업 무결성 점검 및 staging 계약은 준비됐지만 `DATA-MIGRATION-READY=false`를 유지한다. 다음 실제 증거가 남아 있기 때문이다.

- configuration/domain rule CRUD 소비자 Gate 1~7
- post-freeze 펫스킬 3종의 별도 seed/provider Lease와 MariaDB parity
- 격리 MariaDB staging dry-run·rollback·replay·idempotency
- ticketTierData/GLOBAL_CONFIG projection과 모든 CROSSWALK FK의 consumer closure

따라서 이 문서는 직접 `DATA-MIGRATION-GO`를 보내지 않는다. Gate8, feature/prod, 운영 DB는 변경하지 않는다.
