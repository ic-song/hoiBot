# WEB-WBS-011E typed 가방 category 준비도 감사

- 실행 범위: `Lease2658` / `WEB-WBS-011E`
- delta: `SCD-WEB-20260910-17`
- evidence schema: `web-typed-bag-category-readiness-v1`
- 기준선: `e0d3c871` 이후 공유 branch에서 관찰한 `d4dc4050`
- 실행 profile / tier: `READINESS_AUDIT` / `T0`
- 변경 범위: 이 evidence와 WBS011E 체크포인트만 추가했다. 구현, 테스트, DB, migration, 운영 JSON은 수정하지 않았다.

## 판정 기준

현재 웹 계약은 `GET /api/v1/inventory/current?category=general|furniture`와 세션에서 새로 확인한 `playerId`만 사용한다. `CurrentPlayerBagCategory`와 repository가 `general | furniture`만 지원하므로 아래 네 분류는 현재 호출하면 안 된다. 빈 배열 반환, 일반 가방 이름 필터, 표시명 기반 canonical 매핑은 준비 완료가 아니다.

`REUSE`는 현 계약 그대로 사용할 수 있음, `EXTEND`는 공유 current-player category route/service를 확장하면서 typed repository가 필요함, `NEW`는 선행 schema/import 또는 별도 projection 계약이 먼저 필요함을 뜻한다.

## 현행 명령·데이터·표시 계약

### 1. 미니펫가방 — `BLOCKED`, `EXTEND + NEW canonical read provider`

- 트리거/권한: `main.js:21240`의 `/미니펫가방`은 인자 없는 self exact 명령이다. 대상 조회는 alias가 아니라 별도 `/미니펫정보 <닉네임>`이며 `main.js:21358`에서 운영자(`isAdmin`) 또는 총괄 운영자(`isMaster`)만 허용한다.
- 원천: `/sdcard/호이랜드/member_pet.json`의 `miniPetBag`과 `miniPet`, `/sdcard/호이랜드/miniPetData.json`, 미니펫 칭호·컬렉션 및 member/pass/rank projection이다.
- formatter/순서: `buildMiniPetBagMessage`가 `refreshMiniPetSortIndex`를 호출한다. 전투 매력 내림차순, 등급 우선순위 내림차순, 한글 이름순으로 정렬하고 1-based `sortIndex`를 다시 쓴다. 네 번째 행 앞 `allsee`를 넣는다.
- 번호/capacity: 표시 번호는 재계산된 `sortIndex`; 기본 10칸, 호이패스 프리미엄 +5칸이다. 장착, 칭호, 컬렉션, 총 매력·순위도 한 메시지에 합성된다.
- 현행 read 부작용: 두 조회 명령 모두 formatter 뒤 `member_pet.json`을 저장한다. 웹 read는 같은 정렬을 메모리에서 계산하고 legacy `sortIndex`를 쓰지 않는 SELECT-only여야 한다.
- mutation/거래 연계: 뽑기·패키지·조합·관리자 지급, 강화, 장착, 판매·범위 정리, 귀속 해제, 당근 거래, 자유시장 등록·구매·취소, 컬렉션 등록이 같은 occurrence를 소비한다.
- modern 자산: `447_canonical_mini_pet.sql`의 `canonical_mini_pet_definitions`, `canonical_mini_pet_enhancement_rules`, `canonical_owned_mini_pet_instances`, replay가 있다. WBS736은 Gate 1~4이고 Gate 5~7을 미완료로 기록했다. WBS742 domain importer/receipt/ledger는 Gate 1~5 격리 리허설까지 있으나 실제 보유 occurrence를 이름으로 연결하지 않고 승인된 exact locator crosswalk가 있는 행만 허용한다. `canonical-object-shadow-read-provider`에는 typed SELECT가 있지만 웹 read model/provider는 아니다. WBS744는 공용 Shadow Gate 5까지이며 소비자별 Gate 6/7은 남았다.
- 선행: WBS736 → WBS742 exact occurrence binding → WBS743 `MINI-PET` consumer port → WEB-WBS-011C/011D 공유 category 확장.
- 최소 DTO: `{category:"miniPet", ownerLabel, capacity:{used,limit}, items:[{number,displayName,emoji,grade,upgrade,battleCharm,equipped}], pagination}`. `ownedMiniPetId`, definition ID, source locator는 공개하지 않는다. 칭호·컬렉션·순위는 별도 profile/summary API로 분리하거나 명시적 composite 계약 뒤 추가한다.
- session 범위: 일반 사용자는 refresh된 세션 `playerId` self만. 운영자 대상조회는 현재 사용자 route와 분리된 admin route에서만 운영자(`isAdmin`)|총괄 운영자(`isMaster`) 정책을 명시하며, `/미니펫정보` 권한을 근거로 일반 API에 `target`을 추가하지 않는다.

### 2. 펜던트가방 — `BLOCKED`, `NEW canonical ownership + EXTEND web category`

- 트리거/권한: `main.js:19899`의 `/펜던트가방` 또는 `/펜던트가방 <자유 형식 닉네임>`. self는 누구나, target은 총괄 운영자(`isMaster`)만 가능하며 운영자(`isAdmin`)는 대상 조회 권한이 없다. 대상 미존재는 formatter의 `펫 데이터가 없습니다.`로 귀결된다.
- 원천: `member_pet.json`의 `pendantBag`과 장착 `pendant`.
- formatter/순서: `buildPendantBagMessage`는 `창조, 창세, 초월, 신화, 최상급+, ... 최하급` 등급순, 이름순, 원래 index tie-break로 정렬한다. 1-based 표시 번호, 여섯 번째 행 앞 `allsee`, `50`칸 고정이다. 이름/아이콘, 등급, 승급별, 내구도/최대 내구도, 강화 수치를 표시한다.
- mutation/거래 연계: 뽑기, 장착·해제, 복구, 강화·승급, 판매·범위/전체 정리, 귀속 해제, 당근 거래, 자유시장 등록·구매·취소, 관리자 지급·삭제·강화·내구도·장착 초기화가 같은 instance를 소비한다.
- modern 자산: `031_pet_info_projection.sql`의 `player_pet_pendants`는 펫당 장착 projection이며 가방 instance table이 아니다. `PendantBagService`는 generic `inventory_instances`를 명시적 `attributes_json/objectType='pendant'`로 읽고 `super_admin` target만 허용하므로 이름 휴리스틱은 아니지만 canonical pendant 소유 모델·WBS742 import 대상은 아니다. service formatter는 현재 `promotionLevel`과 `창조 승급` 안내를 보존하지 않아 현행 parity도 부족하다. migration125의 `PENDANT_BAG_READ` SHADOW와 synthetic probe는 재사용 조사 자산일 뿐 canonical web readiness 근거가 아니다.
- 선행: WBS735 `PET-EQUIPMENT`/WBS743 consumer mapping에 더해 canonical pendant definition, owned instance, equipped relation, exact import binding을 신규 동결해야 한다. migration 파일 번호를 foreman이 할당하기 전에는 schema write Lease를 발급하면 안 된다.
- 최소 DTO: `{category:"pendant", ownerLabel, capacity:{used,limit:50}, items:[{number,displayName,icon,grade,promotionLevel,durability,maxDurability,upgrade,equipped}], pagination}`. instance/internal item ID는 비공개다.
- session 범위: current-player route는 self-only. 운영자 target route는 총괄 운영자(`isMaster`/`super_admin`)만 허용해야 하며 운영자(`isAdmin`)를 포함하면 현행보다 권한이 넓어진다.

### 3. 펫스킬가방 — `BLOCKED`, `EXTEND + NEW canonical read provider`

- 트리거/권한: `main.js:4335`의 `/펫스킬가방`은 self exact. 대상 조회는 별도 `/스킬정보 <닉네임>`과 `/펫스킬정보 <닉네임>`이며 `Admin || Master`다. `/펫스킬정보`는 일반 사용자가 실제 닉네임을 지정하면 권한 거부, 아니면 스킬 정의 조회로 분기한다.
- 원천: `/sdcard/호이랜드/petSkillData.json`의 `petSkills.bag` 이름→수량 stack, `equipped`, `lockedPremium`.
- formatter/순서: `getPetSkillBagList`는 `PET_SKILL_LIST` 정의 순서, 미등록 정의는 뒤에서 한글 이름순이다. 1-based 번호, 총 수량 `/100`, 호이패스 header·rank·도움말과 `allsee`를 출력한다. formatter/init 뒤 JSON 저장이 발생할 수 있다.
- mutation/거래 연계: 지급·일괄 지급·오픈, 장착·소멸·프리미엄 잠금/복구, 판매·전체 판매·책 분해, 컬렉션, 당근 거래, 자유시장 등록·구매·취소, 길드/패키지 보상이 같은 stack을 소비한다.
- modern 자산: `030_pet_creation_foundations.sql`의 `pet_skill_inventory`와 `skill_definitions`를 읽는 `PetSkillBagReadService` 및 migration186 `PET_SKILL_BAG_READ` SHADOW가 있다. 이 provider는 이름순이고 capacity/premium/rank를 누락해 현행 출력 parity가 아니며 canonical DB를 읽지 않는다. WBS738 migration449의 `canonical_pet_skill_definitions`, import, `canonical_owned_pet_skill_stacks`, equipment, replay는 Gate 1~4; WBS742 import/receipt는 Gate 1~5; WBS743 `PET-SKILL` port와 소비자별 Shadow는 미완료다.
- 선행: WBS738 → WBS742 exact definition/import binding → WBS743 `PET-SKILL` consumer port → WEB-WBS-011C/011D 공유 category 확장.
- 최소 DTO: `{category:"petSkill", ownerLabel, capacity:{used,limit:100}, items:[{number,displayName,grade,quantity,equipped,lockedPremium}], pagination}`. canonical/legacy skill ID와 pet ID는 비공개다. 정의 순서를 유지하려면 canonical definition에 승인된 display order가 필요하며 이름 정렬로 대신하지 않는다.
- session 범위: 일반 current-player route self-only. 운영자 target route는 별도이며 운영자(`isAdmin`)|총괄 운영자(`isMaster`) 권한과 대상 exact identity lookup을 사용한다.

### 4. 패키지가방 — `BLOCKED`, `EXTEND projection; 별도 typed inventory 신규 금지`

- 트리거/권한: `main.js:16246`의 `/패키지가방` 또는 `/패키지가방 <닉네임>`. self는 누구나, target은 `Admin || Master`이고 member 존재를 검사한다.
- 원천/정체성: 별도 패키지 보유 JSON이 아니다. `member.json`의 일반 `bag` stack을 `packageInfo.json` catalog의 정확한 항목과 project한 결과다. 따라서 category는 `general bag ownership + package definition/catalog projection`이다.
- formatter/순서/번호: `getUserPackageBagList`가 `packageInfo` catalog 순서로 수량 양수 항목만 compact한다. 표시 번호와 `/패키지사용 번호`는 compact된 현재 목록의 1-based index다. 원래 `listNumber`를 반환값에 보존하지만 화면 번호로 쓰지 않는다. capacity는 없다. 활성/비활성, 사용 안내, 호이패스와 영지·무쌍·출석 자동 설정까지 합성한다.
- mutation/거래 연계: `/패키지사용`이 일반 bag stack을 차감하고 reward/ledger를 갱신한다. 관리자 지급, catalog 추가·수정·제거·활성·알림과 패스/자동설정도 같은 화면의 상태에 영향을 준다.
- modern 자산: legacy numeric `package_catalog.consume_item_id` → `item_definitions.code` → `inventory_stacks`를 명시적으로 join하는 `MariaPackageHubApplication.listBag`과 PACKAGE_BAG/USE CANARY·Shadow가 있다. 이것은 일반 이름 필터보다 안전하지만 canonical current-player category provider는 아니다. WBS739 migration451은 canonical package definition/reward graph/import/replay를 제공하지만 canonical package definition과 소비 item ownership 사이의 안정 typed relation이 없다. WBS742는 `member bag → canonical item stack`, `packageInfo → canonical package/reward`를 각각 import한다. 패키지 전용 owned table을 새로 만들면 이 소유권 모델을 중복한다.
- 선행: WBS733 canonical item ownership + WBS739 package definition/reward + WBS742 import + WBS743 `PACKAGE-CATALOG/PACKAGE-USE`; 여기에 canonical package↔consume-item exact relation/display order 계약을 추가한 뒤 WEB-WBS-011C/011D category를 확장한다.
- 최소 DTO: `{category:"package", ownerLabel, items:[{number,displayName,quantity,enabled,maxUseCount}], pagination}`. `capacity`는 `null` 또는 필드 생략을 schema에서 하나로 고정한다. pass/automation 상태는 inventory DTO에 섞지 않고 별도 API에서 제공한다. 제품이 legacy composite 전체를 요구하면 별도 composite endpoint/WBS가 필요하다.
- session 범위: current-player route self-only. 별도 운영자 target route에서만 운영자(`isAdmin`)|총괄 운영자(`isMaster`). 일반 route의 query/body로 nickname이나 playerId를 받지 않는다.

## 권장 구현 순서

1. `펫스킬`: canonical stack/definition이 이미 있고 상태가 단순 수량형이므로 exact import binding과 display order를 닫은 뒤 self read를 구현한다.
2. `미니펫`: canonical instance는 있으나 occurrence crosswalk와 파생 charm/capacity provider 결합을 먼저 닫는다.
3. `패키지`: 별도 inventory를 만들지 말고 canonical package↔consume-item 관계와 catalog order를 동결한 뒤 general stack projection으로 구현한다.
4. `펜던트`: canonical ownership/import가 없으므로 schema slice부터 신규로 시작한다.

이 순서는 구현 난이도와 선행 자산 기준이다. UI category enum/route/service 파일은 공유 객체이므로 네 범주를 동시에 쓰지 않는다.

## 정확한 후속 Lease 자원과 직렬화 경계

모든 아래 경로는 `hoibot/` repository qualifier를 포함한다. 실제 slice는 필요한 행만 claim하고 같은 `W:`가 겹치면 직렬화한다.

### 공용 WEB provider phase (`각 category별 한 Lease씩 직렬화`)

- `W:FILE:hoibot/개발환경_고도화/runtime/src/inventory/current-player-bag-service.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/src/inventory/current-player-bag-web-routes.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/src/inventory/maria-bag-repository.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/current-player-bag.test.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/current-player-bag-web-routes.test.ts`
- `W:ROUTE:hoibot/GET:/api/v1/inventory/current`
- `W:PROVIDER:hoibot/current-player-bag-category`
- `R:PROVIDER:hoibot/session-current-player`

### category별 typed read 자원

- miniPet: `R:DB:hoibot/canonical_mini_pet_definitions`, `R:DB:hoibot/canonical_mini_pet_enhancement_rules`, `R:DB:hoibot/canonical_owned_mini_pet_instances`, `R:DB:hoibot/data_migration_object_domain_import_runs`, `R:DB:hoibot/data_migration_object_domain_import_decisions`, `R:DB:hoibot/data_migration_object_domain_import_records`, `W:PROVIDER:hoibot/current-player-mini-pet-bag-read`.
- pendant prerequisite: `W:DB:hoibot/canonical_pendant_definitions`, `W:DB:hoibot/canonical_owned_pendant_instances`, `W:DB:hoibot/canonical_owned_pendant_equipments`, `W:PROVIDER:hoibot/current-player-pendant-bag-read`. migration file은 다음 번호를 예약한 뒤 `W:MIGRATION:hoibot/개발환경_고도화/runtime/migrations/<reserved>_canonical_pendant.sql`로 exact claim해야 하며 예약 전 placeholder claim은 금지한다.
- petSkill: `R:DB:hoibot/canonical_pet_skill_definitions`, `R:DB:hoibot/canonical_owned_pet_skill_stacks`, `R:DB:hoibot/canonical_owned_pet_skill_equipments`, `R:DB:hoibot/data_migration_object_domain_import_runs`, `R:DB:hoibot/data_migration_object_domain_import_decisions`, `R:DB:hoibot/data_migration_object_domain_import_records`, `W:PROVIDER:hoibot/current-player-pet-skill-bag-read`.
- package: `R:DB:hoibot/canonical_item_definitions`, `R:DB:hoibot/canonical_owned_item_stacks`, `R:DB:hoibot/canonical_package_definitions`, `R:DB:hoibot/data_migration_object_domain_import_runs`, `R:DB:hoibot/data_migration_object_domain_import_decisions`, `R:DB:hoibot/data_migration_object_domain_import_records`, `W:DB:hoibot/canonical_package_consume_item_links`, `W:PROVIDER:hoibot/current-player-package-bag-read`. 새 relation의 migration도 foreman의 exact 번호 예약 뒤에만 file claim한다.

UI phase는 provider 뒤 별도 Lease로 `W:FILE:hoibot/개발환경_고도화/runtime/src/site-web/user-shell-assets.ts`, `W:FILE:hoibot/개발환경_고도화/runtime/test/user-shell.test.ts`, `R:ROUTE:hoibot/GET:/api/v1/inventory/current`, `R:PROVIDER:hoibot/current-player-bag-category`를 claim한다. 모든 category가 같은 enum, route, repository, UI tab state를 공유하므로 provider끼리 W/W, UI끼리 W/W를 직렬화한다. canonical DB read와 mutation/market Lease는 R/W가 겹치므로 같은 테이블을 쓰는 import·거래·장착 slice 동안 read rehearsal을 직렬화한다.

## T0~T3와 same-input Shadow 계획

| tier | 공통 검증 | category 추가 검증 |
| --- | --- | --- |
| T0 | source anchor, schema/import/provider 존재, 권한·DTO·Lease 계약 정적 검사 | 이 문서의 readiness 감사. 구현 완료 증거가 아님 |
| T1 | synthetic repository fixture, route auth/self-scope, uint64/CUID 비노출, pagination, empty/error | mini duplicate/equipped/charm/capacity; pendant 등급·승급·내구도; skill stack/order/100; package catalog order/disabled/no capacity |
| T2 | 격리 MariaDB migration replay, exact import receipt, rollback/restart, SELECT-only 전후 checksum | 미니펫 occurrence crosswalk; pendant 신규 instance/equip FK; skill stack/equipment; package consume-item relation과 일반 stack join |
| T3 | 동일 production-like 봉인 입력을 legacy formatter와 modern provider에 동시에 주고 row order/number/quantity/capacity/권한 결과 비교 | mismatch 0, restart 동일 fingerprint, mutation/outbox/audit/import/ledger 0-write, 승인된 기간 Shadow 후 Gate 7 독립 검토 |

same-input은 같은 봉인 JSON occurrence/source locator와 그 exact import record로 만든 canonical 행을 사용한다. legacy 쪽은 복사본을 formatter에 넣어 정렬 부작용을 격리하고, modern 쪽은 read-only principal로 조회한다. 비교에서 표시명으로 재매핑하지 않는다. 패키지는 같은 `packageInfo` catalog 순서와 consume-item link를 사용하고, 펜던트 target 권한은 총괄 운영자 전용, 미니펫/펫스킬/패키지는 운영자 또는 총괄 운영자를 각각 별도 negative fixture로 확인한다.

## Gate 판정

- Gate 1: `TRUE` — 네 현행 명령과 modern 자산의 실제 code/schema/evidence를 재확인했다.
- Gate 2: `TRUE` — category별 DTO, self-scope, 선행조건, exact Lease와 금지 fallback을 동결했다.
- Gate 3~6: `FALSE` — 이번 audit은 fixture, 구현, 격리 DB, same-input Shadow를 만들지 않았다.
- Gate 7: `FALSE` — 독립 검토 전이다.
- Gate 8: `FALSE` — 운영 준비·관찰 범위가 아니다.

기존 WBS736/738/739/742/743/744 evidence의 Gate를 이 schema로 재라벨링하지 않는다. 이 문서는 `SCD-WEB-20260910-17`의 새 `web-typed-bag-category-readiness-v1` audit evidence다.

## 봉인 source hash

- `main.js`: `f673162accd216f8d22ccd45c026df6b6bce3ef191b67fd68459887ac2ebbbdd`
- `runtime/src/inventory/current-player-bag-service.ts`: `881bce90ee0165b225f4376a5dba1bf70552b7d22cf881caa0a44b8c48f7ab3c`
- `runtime/src/pet/pendant-bag-service.ts`: `4f440202a1d51088614e586d96e0886cdbd0b1d14270f18392d9afa8a2a9ac23`
- `runtime/src/pet/pet-skill-bag-read-service.ts`: `71852b57aca1d0ce75a1556250d4eeb341a5c3d73d1405efe1eb02c4595adf6b`
- `runtime/src/package/maria-package-hub-application.ts`: `81cbdef1a3535ff837f2c81c058476dcbb8f752914eac042e2b020736b030b8a`
- migrations `447/449/451/460`: 각각 `55cb58ffbbfbe89e347732171adedc57f1131c2d2273250e687c1844602d3dd9`, `0689bb72c87456e00e6e1e7b510c7dc6eed65b5d87f6bd808722b5a61196d942`, `877fdc539b885575b150c6af641c69de36daafac70de5a7f22ca38296797b2f3`, `806638e029008b760b2df0390f7935ae7700b9ea760649fcf4dfebfdf257af9f`.
