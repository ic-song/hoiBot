# 오브젝트 도메인 이관 소스·대상 동결표

- 슬라이스: `SL-DATA-MIGRATION-OBJECT-DOMAIN-IMPORT-01` (WBS742)
- 카탈로그: `SC-20260902-1`
- 작성일: `2026-09-03 KST`
- 표준 계약: `migration-control/contracts/object-data-model-standard.v1.json`
- typed 필드 계약: `migration-control/contracts/object-domain-import-field-map.v1.json`
- SQL type/null 계약: `migration-control/contracts/object-domain-import-target-schema.v1.json`
- CUID/replay 계약: `migration-control/contracts/object-domain-import-identity-bindings.v1.json`
- 범위: migration `443`~`453`이 생성한 등록 테이블 `65개`, replay binding 보완 `454`, 타이틀 획득가격 보완 `455`, 보유 오브젝트 상태 보완 `456`
- 운영 영향: 없음. 이 문서는 읽기 전용 조사 결과이며 운영 DB와 `data/*.json`을 변경하지 않는다.

## 소스 우선순위와 식별 원칙

1. 사용자 현재 상태는 RAW Landing에 봉인한 `LEGACY_JSON`을 기준으로 한다. 논리 파일명은 별도 manifest에서 `source_path_sha256`에 연결하고 RAW payload는 수정하지 않는다.
2. 정의값은 `CODE_SEED`와 정의 JSON을 catalog projection으로 투영한다. 개발용 `RUNTIME_DB`의 기존 CODE 기반 행은 누락 검출·교차검증에만 사용하고, 충돌 시 자동 덮어쓰기하지 않는다.
3. 표시명은 식별자가 아니다. 사용자 원천 키와 레코드 locator는 정확한 UTF-8 바이트의 SHA-256으로 봉인하고 canonical PK는 CUID2 8자리로 생성한다. 정의는 각 도메인의 `*_definition_imports` source binding을 유지한다. 이관 중 새로 생성하는 플레이어·보유·관계 PK는 generic identity crosswalk의 같은 `object_identity_id`를 사용해 locator를 영속 결합하되, domain PK가 generic identity FK라고 가정하지 않는다.
4. 동일한 표시명의 서로 다른 원천 locator를 병합하지 않는다. 동일 미니펫·가구·장비를 한 사용자가 N개 보유하면 N개의 distinct instance를 만든다.
5. 정의값은 정의 테이블에 한 번만 저장한다. 보유 테이블에는 definition FK, 수량 또는 인스턴스 상태만 저장한다.
6. 이관 순서는 identity/crosswalk/player → 정의 → 보유 → 선택·장착·배치 → 활성 시장 관계 → 대사 순이다. generated PK 40종은 target-table별 namespace로 locator를 영속 결합하고, 선택·typed reward extension 5종은 기존 PK를 재사용한다.
7. 과거 operation/history가 완전하지 않은 도메인은 임의의 거래 이력을 만들지 않는다. 현재 잔액을 원장과 맞춰야 하는 재화만 명시적 `INITIAL_IMPORT` operation/ledger를 생성한다.

## 주요 원천

| 소스 시스템 | 논리 원천 | 용도 |
| --- | --- | --- |
| `LEGACY_JSON` | `member.json` | 사용자, 아이템 가방, 재화 현재값 |
| `LEGACY_JSON` | `itemInfo.json`, `itemList.json` | 아이템·장비 정의 후보와 거래/비아이템 제한 교차검증 |
| `LEGACY_JSON` | `member_pet.json` | 펫·장비 보유/장착과 미니펫 보유 인스턴스·강화 상태 |
| `LEGACY_JSON` | `miniPetData.json` | 미니펫 정의와 등급 확률 교차검증 |
| `LEGACY_JSON` | `miniPetCollectionInfo.json`, `miniPet_collection.json` | 미니펫 타이틀 정의·획득 조건 교차검증 |
| `LEGACY_JSON` | `member_title.json` | 일반 타이틀 보유·선택 |
| `LEGACY_JSON` | `pet_title.json` | 펫 타이틀 보유·선택 |
| `LEGACY_JSON` | `miniPet_title.json` | 미니펫 타이틀 보유·선택 |
| `LEGACY_JSON` | `petSkillData.json` | 펫스킬 가방 수량·펫별 장착 |
| `LEGACY_JSON` | `petSweetHomeData.json`; 운영에 존재할 때만 optional `petHomePlacedFurniture.json` | 가구 인스턴스·배치 상태. split 파일이 봉인·검증되면 우선하고, 없으면 embedded `placedFurniture`를 사용한다. |
| `LEGACY_JSON` | `freeMarket.json` | 가구 등 현재/과거 시장 매물 관계 |
| `LEGACY_JSON` | `packageInfo.json` | 패키지 정의와 보상 구조 |
| `LEGACY_JSON` | `currencyLog.json` | 재화 누적 로그 교차검증; 현재 잔액의 권위 원천은 `member.json` |
| `LEGACY_JSON` | `petSweetHomeInfo.json` | 가구 정의와 건물/평수 정의 |
| `CODE_SEED` | `main.js`의 아이템·가구·펫·장비·미니펫·타이틀·펫스킬·조합 정의 | 정의 seed와 명령 표시명 보존. 가구 부띠끄 7종은 현 JSON catalog missing 보유 90건을 exact 해소 |
| `RUNTIME_DB` | 기존 CODE 기반 catalog/ownership 테이블 | 누락·중복 검출과 이관 전 비교; canonical 최종 쓰기 대상 아님 |

## 65개 테이블 이관 판정

판정 값은 `IMPORT`(현재 상태 이관), `SEED`(정의 투영), `DERIVE`(다른 확정 행에서 생성), `INITIAL_LEDGER`(현재 잔액과 일치하는 최초 원장), `RUNTIME_ONLY`(이관 후 명령 수행으로만 생성), `QUARANTINE`(오류만 보존)이다.

| # | 테이블 | 역할 | 판정 | 원천/생성 규칙 |
| ---: | --- | --- | --- | --- |
| 1 | `object_identities` | identity | DERIVE | 플레이어 등 generic identity provider를 사용하는 source locator에 생성 |
| 2 | `object_identity_crosswalks` | relation | DERIVE | generic provider 대상의 source system/namespace/identifier hash 연결; 도메인별 import 테이블을 대체하지 않음 |
| 3 | `canonical_players` | identity | IMPORT | `member.json` 사용자 키의 SHA-256 crosswalk 후 생성 |
| 4 | `canonical_item_definitions` | definition | SEED | 아이템 정의 JSON·동결 CODE_SEED; 전체 표시명 원문 보존 |
| 5 | `canonical_item_definition_imports` | relation | DERIVE | 아이템 원천 locator와 `item_id` 연결 |
| 6 | `canonical_owned_item_stacks` | ownership_quantity | IMPORT | `member.json.member[*].bag`의 수량형 보유 |
| 7 | `canonical_owned_item_instances` | ownership_instance | IMPORT | 개별 상태가 명시된 아이템만 instance; scalar 수량을 임의 분해하지 않음 |
| 8 | `canonical_item_inventory_operations` | operation | RUNTIME_ONLY | 이관 이후 명령 operation만 기록 |
| 9 | `canonical_item_inventory_ledger_entries` | history | RUNTIME_ONLY | 불완전한 과거 아이템 거래 이력을 제조하지 않음 |
| 10 | `object_furniture_definitions` | definition | SEED | 가구 catalog/CODE_SEED; 기본 매력·강화 증가값은 정의에만 저장 |
| 11 | `object_owned_furniture_instances` | ownership_instance | IMPORT | 가구 가방과 배치 자료의 각 occurrence를 distinct instance로 생성 |
| 12 | `object_home_furniture_placements` | relation | IMPORT | 봉인된 optional `petHomePlacedFurniture.json` 우선, 없으면 embedded `placedFurniture`; owner-instance 결합 확인 |
| 13 | `object_furniture_operation_replays` | operation | RUNTIME_ONLY | 이관 이후 요청 멱등성만 기록 |
| 14 | `canonical_pet_definitions` | definition | SEED | 펫 정의 JSON/CODE_SEED |
| 15 | `canonical_owned_pet_instances` | ownership_instance | IMPORT | `member_pet.json`의 사용자별 펫 상태 |
| 16 | `canonical_equipment_definitions` | definition | SEED | 펫 장비 정의 JSON/CODE_SEED |
| 17 | `canonical_owned_equipment_instances` | ownership_instance | IMPORT | 개별 강화·상태를 가진 장비 occurrence |
| 18 | `canonical_owned_pet_equipment` | relation | IMPORT | 같은 소유자의 펫-장비 장착만 허용 |
| 19 | `canonical_pet_equipment_operation_replays` | operation | RUNTIME_ONLY | 이관 이후 요청 멱등성만 기록 |
| 20 | `object_furniture_ownership_history` | history | RUNTIME_ONLY | 과거 소유권 흐름을 추정하지 않음 |
| 21 | `object_furniture_market_listings` | relation | IMPORT | 활성 가구 payload가 exact owned instance로 해석될 때만 import. 현재 완료 가구 요약처럼 locator가 없으면 추정하지 않고 unresolved evidence로 남김 |
| 22 | `object_furniture_active_market_listings` | relation | DERIVE | active 매물만 1:1 관계 생성; 중복 활성은 격리 |
| 23 | `canonical_mini_pet_definitions` | definition | SEED | 미니펫 정의 source/CODE_SEED |
| 24 | `canonical_mini_pet_enhancement_rules` | definition | SEED | 강화 단계별 증가값을 정의 규칙으로 투영 |
| 25 | `canonical_owned_mini_pet_instances` | ownership_instance | IMPORT | `member_pet.json`의 `miniPetBag[]` 각 행과 별도 장착 `miniPet` 객체; 장착 객체는 가방과 합치지 않으며 같은 미니펫 N개는 N instance. WBS725가 exact occurrence locator별 crosswalk를 승인한 행만 정의 FK를 연결하고, 정의와 다른 관측 이름·외형만 `custom_name`·`custom_emoji`로 보존. crosswalk가 없으면 display-exact 여부와 무관하게 격리 |
| 26 | `canonical_mini_pet_operation_replays` | operation | RUNTIME_ONLY | 이관 이후 요청 멱등성만 기록 |
| 27 | `canonical_member_title_definitions` | definition | SEED | 일반 타이틀 정의와 기본 판매가는 WBS725 catalog projection에서 확정; 사용자 `list[].price`를 정의값으로 사용하지 않음 |
| 28 | `canonical_owned_member_title_instances` | ownership_instance | IMPORT | `member_title.json` 일반 타이틀 occurrence와 사용자별 `acquisition_price=list[].price` |
| 29 | `canonical_member_title_selections` | relation | IMPORT | 유효한 선택 index를 보유 instance FK로 변환 |
| 30 | `canonical_pet_title_definitions` | definition | SEED | 펫 타이틀 정의와 기본 판매가는 WBS725 catalog projection에서 확정 |
| 31 | `canonical_owned_pet_title_instances` | ownership_instance | IMPORT | `pet_title.json` occurrence와 사용자별 `acquisition_price=list[].price` |
| 32 | `canonical_pet_title_selections` | relation | IMPORT | 사용자·보유 타이틀 결합 검증 후 생성. 현재 schema는 특정 `owned_pet_id`를 영속하지 않음 |
| 33 | `canonical_mini_pet_title_definitions` | definition | SEED | 미니펫 타이틀 정의와 기본 판매가는 WBS725 catalog projection에서 확정 |
| 34 | `canonical_owned_mini_pet_title_instances` | ownership_instance | IMPORT | `miniPet_title.json` occurrence와 사용자별 `acquisition_price=list[].price` |
| 35 | `canonical_mini_pet_title_selections` | relation | IMPORT | 사용자·보유 타이틀 결합 검증 후 생성. 현재 schema는 특정 `owned_mini_pet_id`를 영속하지 않음 |
| 36 | `canonical_pet_skill_definitions` | definition | SEED | 펫스킬 이름·handler_key·안전한 options; 실행 코드는 저장하지 않음 |
| 37 | `canonical_pet_skill_definition_imports` | relation | DERIVE | 펫스킬 원천 locator와 `pet_skill_id` 연결 |
| 38 | `canonical_owned_pet_skill_stacks` | ownership_quantity | IMPORT | `petSkillData.json` 가방 수량 |
| 39 | `canonical_owned_pet_skill_equipments` | relation | IMPORT | DB는 같은 사용자의 보유 펫과 스킬 정의를 연결하며, 보유 stack 수량 존재는 importer 애플리케이션 검증으로 보장 |
| 40 | `canonical_pet_skill_operation_replays` | operation | RUNTIME_ONLY | 이관 이후 요청 멱등성만 기록 |
| 41 | `canonical_currency_definitions` | definition | SEED | 포인트·다이아 등 재화 정의; minor unit 규칙 포함 |
| 42 | `canonical_currency_definition_imports` | relation | DERIVE | 재화 원천 locator와 `currency_id` 연결 |
| 43 | `canonical_player_currency_balances` | ownership_quantity | IMPORT | `member.json`의 현재값; `point`/`points` 충돌 시 격리 |
| 44 | `canonical_currency_operations` | operation | INITIAL_LEDGER | 잔액별 단일 `INITIAL_IMPORT` operation |
| 45 | `canonical_currency_ledger_entries` | history | INITIAL_LEDGER | operation당 현재 잔액과 같은 최초 delta; 합계 대사 |
| 46 | `canonical_package_definitions` | definition | SEED | `packageInfo.json` 패키지 정의 |
| 47 | `canonical_package_definition_imports` | relation | DERIVE | 패키지 원천 locator와 `package_id` 연결 |
| 48 | `canonical_package_reward_groups` | relation | SEED | 패키지별 보상 그룹 |
| 49 | `canonical_package_reward_entries` | relation | SEED | 보상 순서와 typed target 종류 |
| 50 | `canonical_package_item_rewards` | relation | SEED | item target을 `item_id` FK로 연결 |
| 51 | `canonical_package_nested_rewards` | relation | SEED | nested package target을 `package_id` FK로 연결; cycle 거부 |
| 52 | `canonical_package_reward_quarantines` | relation | QUARANTINE | 미해결·모호한 보상 target만 보존 |
| 53 | `canonical_package_definition_replays` | operation | RUNTIME_ONLY | 이관 이후 정의 변경 요청 멱등성만 기록 |
| 54 | `canonical_building_definitions` | definition | SEED | `petSweetHomeInfo.json`과 CODE_SEED의 건물/평수 정의 |
| 55 | `canonical_building_definition_imports` | relation | DERIVE | 건물 원천 locator와 `building_id` 연결 |
| 56 | `canonical_craft_recipe_definitions` | definition | SEED | 조합 명령의 recipe 정의; 명령문 자체가 아닌 데이터만 저장 |
| 57 | `canonical_craft_recipe_definition_imports` | relation | DERIVE | 조합 원천 locator와 `craft_recipe_id` 연결 |
| 58 | `canonical_craft_recipe_item_inputs` | relation | SEED | 입력 아이템을 `item_id` FK로 연결 |
| 59 | `canonical_craft_recipe_currency_inputs` | relation | SEED | 입력 재화를 `currency_id` FK로 연결 |
| 60 | `canonical_craft_recipe_item_outputs` | relation | SEED | 출력 아이템을 `item_id` FK로 연결 |
| 61 | `canonical_craft_recipe_currency_outputs` | relation | SEED | 출력 재화를 `currency_id` FK로 연결 |
| 62 | `canonical_building_craft_recipes` | relation | SEED | 건물과 사용 가능한 조합 recipe 연결 |
| 63 | `canonical_craft_operations` | operation | RUNTIME_ONLY | 과거 조합 실행을 추정하지 않고 전환 이후만 기록 |
| 64 | `canonical_craft_item_ledger_entries` | history | RUNTIME_ONLY | 전환 이후 조합 item delta만 기록 |
| 65 | `canonical_craft_currency_ledger_entries` | history | RUNTIME_ONLY | 전환 이후 조합 currency delta만 기록 |

## 격리 규칙

- 사용자 키가 다른 파일에만 존재하는 cross-file orphan
- `point`와 `points` 등 alias 값 충돌
- 같은 표시명으로 여러 item definition이 후보가 되는 가방 항목
- 음수·비정수·범위 초과 수량 또는 JavaScript 안전정수 손실 위험
- 가구 `rate`를 강화 증가값으로 오해한 투영, 또는 WBS725에서 `purchase_price`·`charm_per_enhancement`를 확정하지 못한 정의
- 현 JSON·검증된 CODE_SEED·승인 historical catalog로도 정의가 확정되지 않는 가구 1,299건/789 signature. WBS725가 provenance와 balance 값이 명시된 inactive legacy-recovered definition crosswalk를 승인하기 전에는 `DEFINITION_REFERENCE_MISSING`
- 동일한 두 가구 signature의 catalog index가 유실된 보유 87건. WBS725가 동일 business definition 병합과 draw multiplicity 분리를 승인하기 전에는 `DEFINITION_REFERENCE_AMBIGUOUS`
- 미니펫 정의 매력·강화 규칙과 맞지 않는 instance 값
- WBS725 승인 occurrence-level locator crosswalk가 없는 모든 미니펫 occurrence. immutable definition locator가 없으므로 display-exact 행도 관측 이름·이모지·등급·가격·매력·강화값으로 base definition을 자동 추론하지 않음
- 일반/펫/미니펫 타이틀의 범위 밖 1-based 선택 ordinal (`null`과 `0`은 미선택)
- 보유하지 않은 펫스킬 장착 또는 다른 사용자 펫과의 결합
- 미해결 package item/nested target, nested cycle
- 미해결 조합 item/currency target
- 다른 사용자 소유 instance를 참조하는 장착·배치·시장 관계
- 동일 source locator에서 payload fingerprint가 달라지는 replay drift
- 실행 payload 성격의 `javascript`, `js`, `sql`, `script`, `executable_payload` 토큰이 키 경계에 포함된 데이터

격리 행은 원본을 삭제·수정하지 않으며, 원천 locator hash, 이유, payload fingerprint, 대사 상태를 보존한다. 표시명 자동 병합으로 격리를 해소하지 않는다.

## 대사 계약

| 범위 | 완료 조건 |
| --- | --- |
| source | RAW file count/bytes/SHA-256과 logical manifest가 일치하고 모든 파일이 `PROJECT` 또는 사유 있는 `IGNORE`로 판정됨 |
| identity | 중복 source locator `0`; 모든 canonical PK는 CUID2 8자리. 플레이어는 generic identity와 같은 ID, 정의는 도메인별 import binding으로 원천 추적 |
| definition | source별 예상 정의 수 = canonical 정의 + quarantine 수 |
| quantity ownership | 사용자·정의별 수량 합계가 lossless decimal/BigInt 기준으로 일치 |
| instance ownership | source occurrence 수 = canonical instance 수 + quarantine 수; 동일 객체 N개가 N개 ID로 유지 |
| selection/equipment/placement | 모든 관계 FK가 동일 owner 범위이며 orphan `0` |
| currency | 사용자·재화 현재 잔액 = balance = `INITIAL_IMPORT` ledger 합계 |
| package/recipe | 모든 typed target FK 해결; unresolved는 전부 quarantine에 존재 |
| replay | bundle/payload와 분리한 stable locator hash를 crosswalk에 결합한다. 같은 locator+object type+payload 재실행은 기존 ID를 반환하고 INSERT/UPDATE `0`; drift/type/target 불일치는 실패 |
| transaction | 전체 bundle preflight 후 정의는 도메인 단위, 보유는 사용자 graph 단위로 원자 커밋. 실패한 사용자 canonical write는 0이며 동일 fingerprint의 확정 replay key만 건너뜀 |

## 의존성 판정

- WBS742 Gate 3·4 구현은 WBS724 Common Staging과 WBS725 Catalog Projection이 Gate 4 이상이어야 시작한다.
- WBS724/725가 완료되기 전 WBS742 내부에 임시 staging/projector를 만들지 않는다.
- Gate 5 입력도 명시 승인된 sealed RAW를 일회용 격리 DB에서만 사용하며 운영 DB와 저장소 snapshot에는 쓰지 않는다.
- WBS743 소비자 전환, WBS744 Shadow, WBS745 운영 배포는 이 문서의 완료 범위가 아니다.

## V2 정의 provenance 직접 이관

- V1의 45개 직접 대상과 COMPLETE replay/rollback 계약은 변경하지 않는다.
- V2 프로필은 `canonical_item_definition_imports`, `canonical_currency_definition_imports`를 정의 단계 직접 대상으로 추가한다(47개 대상, 비감사 컬럼 252개, 정의 대상 25개).
- 펫타이틀권은 `LEGACY_JSON / member.bag / 펫타이틀권🦊(/펫타이틀이름)`을 사용한다. sealed `data/itemList.json#/nonItems/16`의 source order 17과 definition/source-row/file SHA-256을 프로필에 고정했다.
- 포인트는 field-map의 `member.json#/member/{playerKey}/point` 원천에 맞춰 `LEGACY_JSON / member.point / point`를 사용하되, 사용자 잔액 scalar를 이름으로 해석하지 않고 `source_identifier=point`를 `CONSTANT_CONTRACT` 정의 매핑값으로 둔다. `memberCurrency`는 repository 단위테스트의 임의 입력이며 이관 계약이 아니다.
- 두 import 행은 표시명 검색으로 정의를 찾지 않고 같은 catalog projection manifest의 정의 identity locator를 `MANIFEST` FK로 참조한다.
