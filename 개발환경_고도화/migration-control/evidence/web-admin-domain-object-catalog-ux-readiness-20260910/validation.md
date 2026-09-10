# WEB-WBS-016A 도메인별 오브젝트 관리 UX readiness

## 판정

- 실행 ID: `개발자-WEB-WBS-016A-20260910`
- Lease: `Lease2667`
- 기준 commit: `3dc59c41b8a0f8e5959d5f7c5cdb474a182b72c5`
- catalog version: `SC-20260902-1`
- delta: `SCD-WEB-20260910-21`
- evidence schema version: `web-admin-domain-object-catalog-ux-readiness-v1`
- execution profile: `SHARED_PROVIDER`
- validation tier: readiness `T0`, 후속 조회/UI `T1`, 후속 등록·수정 `T2`
- readiness 결과: `PARTIAL EXTENSION`
- Gate: Gate 1·2만 `TRUE`, Gate 3~8은 `FALSE`

현재 generic 오브젝트 화면을 그대로 운영 UI로 승격하면 안 된다. 합성 placeholder를 운영자가 실제 입력 예시로 오해할 수 있고, `objectKey`, `objectType`, `metadata`, canonical source는 도메인별 identity 계약을 모르는 운영자가 안전하게 결정할 수 없는 내부 필드다. 화면은 다이아상점·펫스킬·아이템·가구·미니펫 메뉴로 나누고, 운영자는 도메인 필드·변경 사유·확인만 입력한다. stable identity와 source/metadata는 서버 allowlist와 canonical source에서 생성해야 한다.

## 스크린샷 값의 정체와 저장 여부

스크린샷의 다음 값은 모두 운영 데이터가 아니라 WBS617/Lease2374 합성 fixture다.

- `currency.lease2374_credit`
- `Lease2374 합성 크레딧`
- `RUNTIME_DB|currency_definitions|lease2374_credit`
- operator/login/session에 사용된 `2374` 표식

근거는 `runtime/test/fixtures/admin-object-catalog-web-consumer.ts`의 `syntheticObjectCatalogObject`와 정확히 일치한다. 현재 `127.0.0.1` 관리자 미리보기는 `runtime/test/support/admin-web-shell-preview.ts`에서 이 fixture를 `new Map(...)`에 넣으며, POST/PATCH/active 요청도 그 프로세스의 `objects`/`completedObjects` Map만 바꾼다. 따라서 미리보기에서 제출한 값은 MariaDB에 저장되지 않고 프로세스를 재시작하면 사라진다.

실제 `runtime/src/app.ts`가 등록하는 POST `/api/v1/admin/object-catalog/objects`는 다른 경계다. 이 경로는 `ObjectCatalogWebAdapterProvider`의 한 MariaDB transaction에서 다음을 수행한다.

1. 현재 operator와 `manager|super_admin` 역할을 재확인한다.
2. `operations`에 namespaced idempotency operation을 만들고 같은 key replay/fingerprint conflict를 검사한다.
3. 입력 source가 object type의 allowlist와 실제 canonical target에 존재하는지 확인한다.
4. `object_registry`에 `object_key`, `object_type`, `display_name`, `active`, `metadata_json`을 저장한다.
5. 요청에 따라 `object_aliases`, `object_source_bindings`를 저장한다.
6. `object_catalog_change_log`에 REGISTER/UPDATE 이력을 저장한다.
7. `command_audit`에 운영자·사유·before/after를 저장한다.
8. `outbox_messages`에 `object_catalog.changed`를 기록하고 `operations` 결과를 completed로 고정한다.

즉, 스크린샷 자체는 메모리 합성 화면이지만 같은 모양의 실제 실행 route에 유효한 값을 제출하면 raw metadata/source도 실제 object catalog와 audit/outbox에 저장된다. 이 mutation은 아이템 보유량이나 `inventory_ledger`를 변경하지 않으며, canonical 정의 테이블에도 새 정의를 만들지 않는다. 이미 존재하는 정의를 검증한 뒤 object catalog의 identity/reference만 등록한다.

## 현재 generic UI 위험

- `web-shell-assets.ts`의 등록 폼이 합성 `currency.lease2374_credit`와 `RUNTIME_DB|...|lease2374_credit`를 placeholder로 노출한다.
- object type 10종을 한 select에 넣고 raw JSON/source string을 운영자에게 직접 작성하게 한다.
- generic GET은 stable key 단건 조회만 지원하며 목록/필터/도메인 탐색 API가 없다.
- 기존 provider는 source target 존재, RBAC, idempotency, expected version, audit, outbox, active semantics를 지키지만 stable key의 도메인별 생성 정책까지 소유하지 않는다.
- ITEM key는 `item.ring.grade-*`, `item.direct_bag.<hash>`, `item.common.<definition-code>`처럼 여러 동결 규칙을 사용한다. 단순히 `item.<code>`로 생성하면 기존 identity와 충돌할 수 있다.
- FURNITURE 기존 link는 `furniture.catalog_<canonical-code>` 및 `LEGACY_JSON|petSweetHomeInfo.furnitureDraw|...`를 사용하지만 generic adapter의 legacy allowlist는 `petSweetHomeInfo`만 허용한다.
- MINI_PET 기존 link는 `mini_pet.catalog_<source-index>` 및 `LEGACY_JSON|miniPetData.miniPet|...`를 사용하지만 generic adapter의 allowlist는 `miniPetInfo`, `MINI_PET_LIST`만 허용한다.
- 따라서 가구·미니펫 기존 object의 UPDATE/SET_ACTIVE를 현재 generic validator로 재사용하면 source-domain mismatch가 발생할 수 있다. allowlist를 느슨하게 넓히는 방식은 금지하고 동결된 crosswalk와 source policy를 exact하게 반영해야 한다.

## 도메인별 현재 상태

| 메뉴 | 현재 API/provider | readiness | 선행 조건 |
|---|---|---|---|
| 다이아상점 | GET `/api/v1/admin/diamond-shop/catalog`, POST `/catalog/items`, DELETE `/catalog/items/:productId`; `DiamondShopCatalogWebAdapterProvider` | `READY_REUSE` | 현재 전용 메뉴, catalog version, manager/super_admin, idempotency/audit/outbox 회귀만 수행한다. object generic form으로 합치지 않는다. |
| 펫스킬 | GET current/version, draft 생성·publish·rollback·retire·delete; `PetSkillCatalogCrudProvider` | `READY_REUSE` | 현재 versioned 전용 메뉴와 active version 계약을 유지한다. object generic form으로 합치지 않는다. |
| 아이템 | `item_definitions`와 다수의 frozen object link는 존재. 관리자 도메인 목록/허용필드 adapter는 없고 generic exact-key API만 존재 | `READ_READY / WRITE_BLOCKED` | 정의 authority와 각 subtype별 stable-key/source policy를 resolver로 고정하고 기존 source binding 중복을 대사해야 한다. |
| 가구 | `furniture_definitions`와 migration 398 object link 존재. 전용 관리자 목록/route 없음 | `READ_READY / WRITE_BLOCKED` | `petSweetHomeInfo.furnitureDraw` crosswalk와 runtime definition code의 단일 identity 선택, 기존 generic allowlist mismatch 교정이 필요하다. |
| 미니펫 | `mini_pet_definitions`, source binding catalog와 migration 397 object link 존재. 전용 관리자 목록/route 없음 | `READ_READY / WRITE_BLOCKED` | source index 기반 stable key와 definition code 관계를 서버 resolver로 고정하고 generic allowlist mismatch를 교정해야 한다. |

패키지는 이미 별도 `패키지 카탈로그` 메뉴와 전용 API가 있으므로 아이템 generic 등록 폼에 섞지 않는다. 타이틀은 사용자 결정대로 가방/오브젝트 메뉴와 분리하고 WEB-WBS-011F 및 별도 관리자 title WBS에서 다룬다.

## 동결 UX 정책

1. 좌측 카탈로그 그룹에 `다이아상점`, `펫스킬`, `아이템`, `가구`, `미니펫`을 명시하고 각각 deep link와 active state를 가진다.
2. 1차 화면에는 검색·상태 필터·도메인 필드·변경 사유·확인만 표시한다.
3. 운영자에게 raw `objectKey`, `objectType`, Definition ID, expectedVersion, Metadata JSON, Canonical source 입력을 노출하지 않는다.
4. list API가 발급한 `definitionRef`만 mutation에 받는다. 서버가 domain allowlist로 object type, stable key, source binding, metadata projection을 생성한다.
5. 클라이언트가 object type/key/source/metadata를 보내면 무시하지 말고 422로 거부한다.
6. 내부 상세가 필요하면 `개발자 정보` 읽기 전용 disclosure에서만 key/version/source를 표시한다. JSON textarea와 편집 버튼은 두지 않는다.
7. 합성 fixture는 `합성 데이터` 배지를 명시하고 운영 UI placeholder에는 나타나지 않아야 한다. `lease####`, `synthetic`, 합성 canonical source 문자열의 운영 UI 검색 결과는 0건이어야 한다.
8. 삭제는 hard delete가 아니라 기존 active/disable semantics를 유지한다. 변경은 CSRF, Idempotency-Key, reason, confirmed, optimistic version과 audit/outbox 원자성을 유지한다.
9. 375/768/1024/1440px에서 수평 overflow 0, 모든 조작 대상 44px 이상, label 연결, 키보드 순서와 visible focus, loading/success/inline error를 검증한다.

UI/UX Pro Max의 확인된 지침 중 이 화면에 적용되는 항목은 associated form label, submit loading/success/error, visible keyboard focus, active navigation state, deep-linkable URL이다.

## 권장 API 계약

기존 전용 다이아상점·펫스킬 API는 그대로 재사용한다. ITEM/FURNITURE/MINI_PET에는 다음 domain facade를 추가한다.

- `GET /api/v1/admin/object-catalog/domains/:domain?cursor=<opaque>&limit=<n>&status=<all|active|inactive|unlinked>`
  - domain allowlist: `item|furniture|mini-pet`
  - 응답: 운영자 표시 필드, active/link 상태, opaque `definitionRef`, 다음 cursor
  - 내부 numeric ID, raw source, metadata JSON은 기본 응답에서 제외
- `POST /api/v1/admin/object-catalog/domains/:domain/objects`
  - 입력: `{ definitionRef, reason, confirmed }`
  - 서버 생성: `objectType`, stable `objectKey`, display name, metadata projection, canonical source binding
  - 기존 link면 새 등록을 만들지 않고 409 또는 명시적 existing result를 반환
- `POST /api/v1/admin/object-catalog/domains/:domain/objects/:definitionRef/active`
  - 입력: `{ expectedVersion, active, reason, confirmed }`
  - UI는 expectedVersion을 화면에 입력받지 않고 직전 조회 응답에서 그대로 전달

기존 exact-key GET과 generic mutation route는 호환성 때문에 즉시 삭제하지 않는다. 메뉴와 운영 UI에서는 제거하고, 후속 소비자 대사 후 개발자 전용/비공개 경계 여부를 결정한다.

## 분할 WBS와 exact Lease 자원

### WEB-WBS-016A1 — 안전한 메뉴·generic raw form 제거 (`READ_UI`, T1)

선행: WEB-WBS-013B Gate7, Lease2666 종료.

W:

- `FILE:hoibot/개발환경_고도화/runtime/src/admin/web-shell-assets.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/admin-web-shell.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/admin-domain-object-catalog-ux.test.ts`
- `WBS:WEB-WBS-016A1`
- `EVIDENCE:web-admin-domain-object-catalog-ux-v1`

R:

- 기존 diamond/pet-skill/package/object route와 provider 파일
- `FILE:hoibot/개발환경_고도화/runtime/src/app.ts`

완료 조건: 5개 메뉴/deep link/active state, raw 입력·합성 placeholder 0, 기존 다이아상점·펫스킬 기능 회귀, 4 viewport와 keyboard/accessibility PASS.

### WEB-WBS-016A2 — ITEM/FURNITURE/MINI_PET 목록 projection (`SHARED_PROVIDER`, T1)

선행: 각 canonical definition authority와 object/source crosswalk read 계약 확정.

W:

- `FILE:hoibot/개발환경_고도화/runtime/src/catalog/object-catalog-domain-read-provider.ts`
- `FILE:hoibot/개발환경_고도화/runtime/src/admin/object-catalog-domain-web-routes.ts`
- `FILE:hoibot/개발환경_고도화/runtime/src/app.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/object-catalog-domain-read-provider.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/admin-object-catalog-domain-web-consumer.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/fixtures/admin-object-catalog-domain-web-consumer.ts`
- `PROVIDER:hoibot/admin-object-catalog-domain-read-v1`
- `ROUTE:hoibot/GET:/api/v1/admin/object-catalog/domains/:domain`
- `WBS:WEB-WBS-016A2`
- `EVIDENCE:web-admin-domain-object-catalog-read-v1`

R:

- `DB:hoibot/item_definitions`
- `DB:hoibot/furniture_definitions`
- `DB:hoibot/mini_pet_definitions`
- `DB:hoibot/mini_pet_definition_source_bindings`
- `DB:hoibot/object_registry`
- `DB:hoibot/object_aliases`
- `DB:hoibot/object_source_bindings`
- 기존 object catalog 및 canonical shadow provider

완료 조건: domain allowlist, 안정된 pagination/order, linked/unlinked 정확성, inactive 필터, raw ID/source/metadata leak 0, DML/FOR UPDATE 0, empty/error/401/403 UI.

### WEB-WBS-016A3 — 서버 생성 identity/source mutation facade (`MUTATION_TRANSACTIONAL`, T2)

선행: 016A2 및 item/furniture/mini-pet별 identity resolver 승인. 현재 이 선행이 충족되지 않아 구현 시작 금지.

W:

- `FILE:hoibot/개발환경_고도화/runtime/src/catalog/object-catalog-domain-web-adapter-provider.ts`
- `FILE:hoibot/개발환경_고도화/runtime/src/admin/object-catalog-domain-web-routes.ts`
- `FILE:hoibot/개발환경_고도화/runtime/src/app.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/object-catalog-domain-web-adapter-provider.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/object-catalog-domain-web-adapter-provider-mariadb.integration.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/admin-object-catalog-domain-web-consumer.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/support/admin-web-shell-preview.ts`
- `PROVIDER:hoibot/admin-object-catalog-domain-mutation-v1`
- `ROUTE:hoibot/POST:/api/v1/admin/object-catalog/domains/:domain/objects`
- `ROUTE:hoibot/POST:/api/v1/admin/object-catalog/domains/:domain/objects/:definitionRef/active`
- `DB:hoibot/operations`
- `DB:hoibot/object_registry`
- `DB:hoibot/object_aliases`
- `DB:hoibot/object_source_bindings`
- `DB:hoibot/object_catalog_change_log`
- `DB:hoibot/command_audit`
- `DB:hoibot/outbox_messages`
- `WBS:WEB-WBS-016A3`
- `EVIDENCE:web-admin-domain-object-catalog-mutation-v1`

R:

- `FILE:hoibot/개발환경_고도화/runtime/src/catalog/object-catalog.ts`
- `FILE:hoibot/개발환경_고도화/runtime/src/catalog/maria-object-catalog-repository.ts`
- `FILE:hoibot/개발환경_고도화/runtime/src/catalog/object-catalog-web-adapter-provider.ts`
- `DB:hoibot/admin_operators`
- `DB:hoibot/admin_operator_roles`
- `DB:hoibot/admin_roles`
- ITEM/FURNITURE/MINI_PET canonical definition/crosswalk tables

schema/RBAC 변경이 없으면 migration claim은 필요 없다. identity resolver가 신규 canonical mapping table 또는 permission을 요구한다고 확인될 때만 별도 migration 번호를 재확인해 직렬 Lease를 추가한다.

완료 조건: 클라이언트 raw identity/source/metadata 거부, exact allowlist derivation, duplicate source/identity 차단, version conflict, same-key replay, different-payload conflict, restart replay, audit/outbox 실패 전체 rollback, canonical 정의/보유/ledger 불변, MariaDB Shadow와 browser 4 viewport PASS.

## Gate 근거

| Gate | 상태 | 근거 |
|---|---|---|
| Gate 1 현행 조사 | TRUE | screenshot fixture provenance, preview Map 경계, 실제 route/provider/UI 및 5개 도메인 자산을 source로 확인 |
| Gate 2 DB/API 매핑 | TRUE | 실제 transaction write set, domain별 read/write 선행, route와 exact Lease 자원 확정 |
| Gate 3 합성데이터 | FALSE | 후속 domain fixture 미작성 |
| Gate 4 구현 | FALSE | source/test/UI/DB/migration 미변경 |
| Gate 5 통합 | FALSE | app wiring 미변경 |
| Gate 6 parity | FALSE | domain facade 회귀 미실행 |
| Gate 7 Shadow | FALSE | 독립 검토·MariaDB/browser Shadow 미실행 |
| Gate 8 운영 준비 | FALSE | 운영 DB, 배포, cutover, 승인 범위 아님 |

## source hashes

- `runtime/src/admin/web-shell-assets.ts`: `3a8ce1e497589ff1ca1e09e76653c4ddd646fef7`
- `runtime/test/fixtures/admin-object-catalog-web-consumer.ts`: `bc73187f0b7323693d7206f631719a828d13d9be`
- `runtime/test/support/admin-web-shell-preview.ts`: `862ca67a503eeaca4ecbf3bb763e3a06a6ae178d`
- `runtime/src/admin/object-catalog-web-routes.ts`: `24915f831d59c1e2450c5a79fa34a3533861d0d3`
- `runtime/src/catalog/object-catalog-web-adapter-provider.ts`: `47d2b08268dc940cfccc8a1208332698ec053cb9`
- `runtime/src/catalog/maria-object-catalog-repository.ts`: `37696b037a682b40dbd19ae7a69b0a5a8f02f550`
- `runtime/migrations/384_object_catalog_core.sql`: `60fe4c8fac6cb80a03d1bba8ec7aabf657b15271`
- `runtime/src/admin/diamond-shop-catalog-web-routes.ts`: `ec9d5e13a0683c9288999addd7082228d827f11b`
- `runtime/src/admin/pet-skill-catalog-web-routes.ts`: `5a424f35529b83f9efbf9102cdbcc8814881c7b7`
- `runtime/src/admin/package-catalog-web-routes.ts`: `1307da33e6d676e619169a99d5e96cc670b1e83c`
- `runtime/migrations/397_minipet_object_catalog_link.sql`: `05b27828477a8e2bdce5ed2d07d5077f6861a9fc`
- `runtime/migrations/398_furniture_object_catalog_link.sql`: `462ebcde8a4175a69838c26534be7ed8c1a2798c`

## 불변 확인

- source/test/DB/migration 변경 0
- 운영 DB·운영 JSON·`feature/prod` 접근/변경 0
- 기존 object catalog provider, RBAC, idempotency, audit, version, active semantics 변경 0
- 중앙 Sheets 변경 0
- Lease2666과 공유한 `web-shell-assets.ts`는 R/R 조사만 수행

