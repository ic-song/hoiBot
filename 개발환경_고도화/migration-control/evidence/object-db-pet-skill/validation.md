# WBS738 펫스킬 오브젝트 DB화 Gate 1~4 증거

- 기준 커밋: `47d84abde86c9aeca06fa8698c4cdc0f5ce70823`
- 카탈로그: `SC-20260902-1`
- 브랜치: `codex/object-db-pet-skill-v1-20260903`
- 운영 `data/*`, 운영 DB, `feature/prod`, Rhino 명령 로직은 변경하지 않았다.

## Gate 1 현행 조사

검색어: `펫스킬`, `petSkill`, `PET_SKILL_LIST`, `PET_SKILL_COMPAT_GROUPS`, `initPetSkillUser`, `addPetSkillToBag`, `removePetSkillFromBag`, `petSkillDataPath`, `saveJsonFile(petSkillData`.

- `main.js`의 `petSkillData[user].petSkills.bag`은 스킬명별 수량 map이다.
- `equipped`는 가방 수량 1개를 차감한 뒤 스킬명을 넣으며, 개체별 강화·경험치 같은 상태는 없다.
- `lockedPremium`은 프리미엄 종료/복구 과정의 장착 대기 상태다. Gate 5 소비자 이관에서 장착 관계 상태로 별도 매핑해야 한다.
- `/펫스킬가방추가`, `/펫스킬일괄지급`, `/펫스킬오픈`, 판매·분해·시장·장착·소멸·컬렉션이 같은 JSON을 소비한다.
- `saveJsonFile(petSkillData, petSkillDataPath)` 호출이 여러 mutation 뒤에 존재하고 DEV/PROD 경로는 `resolveActiveDataPath`가 결정한다.
- 현행에서 스킬 보유를 실제로 검사하는 명령 연결은 롤렉스 `/자랑`, 품행제로 `/결투`, 기도 `/기도`, 오픈런 `ㅊㅊ`이며 canonical DB에는 이 문자열이나 실행문 대신 코드 registry의 의미 식별자만 저장한다.
- 기존 `skill_definitions`, configuration catalog, `PET_SKILL_LIST` seed/CRUD는 재사용 조사 대상이지만 PK가 bigint이고 `code`를 사용하므로 신규 8자리 CUID2 표준 테이블을 대체하지 못한다.
- 검색 실패는 부재로 단정하지 않았다. 자유시장, 홈, 결투, 강화, 탐험 등 간접 소비자가 많아 Gate 5~7 전체 consumer parity가 필요하다.

## Gate 2 DB 매핑

- 정의: `canonical_pet_skill_definitions`. 이름·설명·등급·허용된 `handler_key`·타입 검증 `options_json`·활성 상태만 저장한다.
- source 연결: `canonical_pet_skill_definition_imports`. 이름을 식별자로 사용하지 않고 원문 source locator를 보존한다.
- 보유: `canonical_owned_pet_skill_stacks`. 현행 근거에 따라 `(player_id, pet_skill_id)`별 수량형이다.
- 장착: `canonical_owned_pet_skill_equipments`. `owned_pet_id`와 `player_id` 복합 FK로 다른 소유자의 펫 장착을 DB가 거부한다.
- 멱등성: `canonical_pet_skill_operation_replays`. `(player_id, request_key)` UNIQUE와 `operation_kind + payload_fingerprint`로 동일 key의 다른 payload를 거부한다.
- 선행 의존은 `444_canonical_item_inventory.sql:canonical_players.player_id`, `446_canonical_pet_equipment.sql:canonical_owned_pet_instances(owned_pet_id, player_id)`로 정확히 고정했다. 형식만 맞는 다른 migration 파일명과 복합 소유자 UNIQUE 누락은 validator가 거부한다.
- 실행 가능한 JavaScript/SQL은 저장하지 않는다. `canonical-pet-skill-handler-registry.ts`에 등록된 세 handler만 선택할 수 있다.

## Gate 3 합성 데이터

`canonical-pet-skill-v1.json`은 수치형 패시브, 명령 사용 허용 데이터, 연출 전용 스킬과 수량 2 → 장착 후 1 시나리오를 포함한다. 운영 snapshot은 읽기만 했고 fixture에 사용자 식별 정보는 복사하지 않았다.

## Gate 4 구현

- migration: `449_canonical_pet_skill.sql`
- runtime: handler allowlist/typed option validator, MariaDB definition/grant/equip repository
- 정의 등록과 수량/장착 mutation은 공용 CUID2·KST 감사 provider를 사용한다.
- definition/grant/equip은 transaction, row lock, 업무 UNIQUE와 1205/1213 제한 재시작, committed replay 재조회, payload conflict 검증을 포함한다.
- equip은 수량을 변경하기 전에 정의의 `active_flag`, `handler_key`, `options_json`을 코드 registry로 다시 검증한다.

## 미완료 Gate

- Gate 5: migration 444/446/449를 함께 적용한 MariaDB 통합 및 모든 legacy consumer 연결 미완료
- Gate 6: 운영 snapshot 대사, 명령별 JSON↔DB parity, restart replay 미완료
- Gate 7: Shadow 미완료
