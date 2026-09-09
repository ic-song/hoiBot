# WBS736 미니펫 오브젝트 DB화 Gate 1~4 증거

## 범위와 기준선

- catalog version: `SC-20260902-1`
- baseline: `47d84abde86c9aeca06fa8698c4cdc0f5ce70823`
- branch: `codex/object-db-minipet-v1-20260903`
- migration: `447_canonical_mini_pet.sql`
- 표준: `docs/database/OBJECT_DATA_MODEL_STANDARD.md`
- 운영 DB와 Android 경로에는 쓰지 않았다. `data/*.json`은 읽기 전용 집계만 수행했다.

## Gate 1 현행 조사

검색어는 `미니펫`, `miniPet`, `miniPetBag`, `miniPetData`, `memberPetPath`, `saveJsonFile(petData, memberPetPath)`, `refreshMiniPetSortIndex`, `runMiniPetUpgradeOnce`, `createMiniPetFromCombination`, `removeMiniPetsFromBag`이다.

- 정의 원본: `data/miniPetData.json`, 런타임 `/sdcard/호이랜드/miniPetData.json`
- 보유 원본: `data/member_pet.json`, 런타임 `/sdcard/호이랜드/member_pet.json`
- load/save: `main.js`와 `Info.js`가 `memberPetPath`를 로드하고, 획득·강화·장착·판매·거래·조합 후 `saveJsonFile(petData, memberPetPath)`로 저장한다.
- 주요 함수: `addMiniPetToUserBag`, `refreshMiniPetSortIndex`, `runMiniPetUpgradeOnce`, `setMiniPetEquipState`, `createMiniPetFromCombination`, `removeMiniPetsFromBag`.
- 정의 스냅샷: 1,078행, signature 1,078개, 등급 확률 14행, SHA-256 `b361e9d2922a9e7997416f49e49187fd6924642a5aec8018ab68d6c8c9d2b5a7`.
- 보유 스냅샷: 352명, 가방+장착 3,890개, 장착 350개, SHA-256 `9366caded5be5dea9ec30a2bece5675a642844123a4dbc9dcd16ec5c56f2e1c8`.
- 같은 정의를 중복 보유한 사용자는 96명이며 한 사용자의 최대 동일 정의 보유량은 38개다. 수량형이 아니라 인스턴스형이 필요하다는 실제 근거다.
- 관찰된 보유 필드는 `name`, `emoji`, `grade`, `price`, `battleExp`, `castleExp`, `raidExp`, `sortIndex`, `upgrade`다. 앞의 공통 정의값과 최종 매력은 canonical 보유 행에 복제하지 않는다.
- `sortIndex`는 매력·등급·이름으로 매번 재정렬해 다시 부여되므로 canonical 식별자가 아니다.
- 중복 가능 로직: 미니펫 생성은 뽑기, 패키지, 조합, 관리자 지급, 자유시장 복원 경로에 분산돼 있다. Gate 5 소비자 전환 전에 공통 획득 경계를 재확인해야 한다.

## Gate 2 DB 매핑

- `canonical_mini_pet_definitions`: 이름, 이모지, 등급, 판매가, 기본 battle/castle/raid 매력, 최대 강화 단계.
- `canonical_mini_pet_enhancement_rules`: 비선형 단계별 매력 증가량, 성공 확률, 포인트 비용, 강화석 수량. 레거시의 `MINI_CHARM_*`, `MINI_PROB`, `MINI_COST`를 사용자 행에 복제하지 않는다.
- `canonical_owned_mini_pet_instances`: `owned_mini_pet_id`, `player_id`, `mini_pet_id`와 강화·장착·귀속·소유 상태만 저장한다.
- `canonical_mini_pet_operation_replays`: `(player_id, request_key)` 멱등 획득 기록과 payload fingerprint.
- 모든 신규 PK/FK는 의미형 `CHAR(8) ascii_bin`, 모든 테이블은 네 감사 컬럼과 KST 19자 CHECK를 가진다. 단독 `id`, 오브젝트 `CODE`, 비즈니스 `version`, 최종 매력 snapshot은 없다.
- `canonical_players(player_id)`는 이 branch에 생성하지 않으며 `444_canonical_item_inventory.sql`을 `integrationOnlyTables`로 명시했다. 잘못된 migration 이름은 validator가 거부한다.

## Gate 3 합성 데이터

- `canonical-mini-pet-v1.json`은 비식별 사용자 1명, 정의 1건, 비선형 강화 규칙 3건, 같은 정의의 보유 인스턴스 2건을 포함한다.
- 레벨 2 매력은 `1000 + 100 + 150 = 1250`으로 조회 시 계산하고 보유 행에는 저장하지 않는다.
- 운영 snapshot을 복사·수정하거나 fixture로 직접 사용하지 않았다.

## Gate 4 구현

- `MariaCanonicalMiniPetRepository.acquire`는 공용 CUID2/감사 provider를 같은 트랜잭션에서 사용한다.
- 서로 다른 request key로 같은 `mini_pet_id`를 획득하면 서로 다른 `owned_mini_pet_id`가 생성된다.
- 같은 request key와 같은 payload는 replay하고, payload가 바뀌면 거부한다. 동시 UNIQUE 충돌은 committed replay를 다시 읽는다.
- gap lock 경합에서 MariaDB `ER_LOCK_DEADLOCK`/1213 또는 `ER_LOCK_WAIT_TIMEOUT`/1205가 발생하면 최대 3개 transaction으로 제한 재시도한다. 다음 transaction은 먼저 committed replay를 다시 조회한다.
- request key는 `${playerId}:${requestKey}`가 source locator 191자를 넘지 않도록 최대 182자로 제한하며 183자는 DB 접근 전에 거부한다.
- `equip`은 사용자 소유 행을 잠근 뒤 기존 장착을 해제하고 동일 사용자·`owned` 상태 대상만 장착한다.
- `calculateCanonicalMiniPetCharm`은 정의 기본값과 단계 규칙을 합산하며 사용자 행의 최종 매력 snapshot에 의존하지 않는다.

## 검증과 미완료 Gate

- object data contract validator: PASS, 등록 대상 6개
- typecheck: PASS
- build: PASS
- focused tests: 26/26 PASS
- `node --check main.js`, `node --check Info.js`, `git diff --check`: PASS
- Gate 1~4: 구현 및 정적 검증 완료
- Gate 5: 미완료. migration 444와 함께 격리 MariaDB에 실제 적용하고 FK/CHECK/rollback/restart를 검증해야 한다.
- Gate 6: 미완료. RAW→Domain Import에서 1,078개 정의와 3,890개 인스턴스의 정확한 매력 역산, 미매핑, 중복, 합계를 대사해야 한다.
- Gate 7: 미완료. 레거시 JSON 소비자와 canonical 소비자의 획득·강화·장착·판매·거래·조합 결과 Shadow 비교가 필요하다.
- Gate 8 및 운영 배포: 수행하지 않았다.

레거시는 강화 성공 때 최종 `battleExp`, `castleExp`, `raidExp`를 인스턴스에 누적 저장한다. canonical 모델은 이를 복제하지 않으므로 기존 행의 정의 기본값과 강화 단계 규칙이 정확히 맞지 않는 경우를 임의 보정하지 말고 Gate 6 격리 대상으로 남겨야 한다.
