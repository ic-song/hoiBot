# WBS743 소비자 전환 Gate 1/2 검증 증거

## 범위와 기준

- 기준 commit: `f97be62292c3f7e8ea79b2d6f302dd25517584d4`
- 계약: `object-db-consumer-transition.v1.json`
- Gate 1은 17개 소비자 슬라이스의 실제 레거시·현대화 코드 표면을 동결한다.
- Gate 2는 현 canonical 스키마/API와 추가 구현이 필요한 bridge를 구분하며, 누락 schema와 runtime boundary는 `PROPOSED_BLOCKING` 계약으로만 정의한다.
- 이 변경은 소비자 구현, migration 추가, `main.js`, `Info.js`, `runtime/src/app.ts`, 운영 DB/data, 배포를 포함하지 않는다.

## Gate 1 source audit

직접 검색한 표면은 `main.js`, `Info.js`, `COMMAND_INDEX.md`, `COMMAND_REGISTRY.md`, `개발환경_고도화/runtime/src/**`, migrations 001~460이다. 계약 테스트는 다음 핵심 anchor가 기준 commit에 실제 존재하는지 매 실행마다 확인한다.

- 명령/저장: `saveJsonFile`, `loadJsonFile`, `/가방`, `/미니펫가방`, `/펫스킬`, `/패키지사용`
- 집계/칭호: `Info.js`의 `getHomeTotalExp`·`petTitleList`, `main.js`의 `miniPetTitle`
- DEV/PROD·운영·시장: `DEV / PROD Path Rules`, `/전체동기화`, `/자유시장`
- 현대화 app/web/dispatch/outbox: `partialDispatchDecision`, `registerAdminRoutes`, `LEGACY_FALLBACK`, `MODERN`, `outboxId`
- identity SQL: `external_identities.player_id BIGINT UNSIGNED`와 `canonical_players.player_id CHAR(8)`

17개 frozen slice는 CONTEXT-BRIDGE, ITEM, CURRENCY-SHOP, BUILDING-RECIPE, FURNITURE-HOME, HOME-AGGREGATE-RANK, PET-EQUIPMENT, MINI-PET, MEMBER-TITLE, PET-TITLE, MINI-PET-TITLE-COLLECTION, PET-SKILL, MARKET-ORCHESTRATOR, PACKAGE-CATALOG, PACKAGE-USE, ADMIN-LIFECYCLE, ADMIN-WEB-APP-WIRING이다.

`build-object-db-consumer-transition-manifest.ts`가 실제 소스를 다시 읽어 stable ID, kind, predicate, file/symbol, read/write, legacy path/SQL, save/load, environment resolver, provider imports, 정확한 source span/hash, primary/dependent slice, P1 bridge, target selector, interface ID와 transaction owner를 생성한다. 레거시는 `response()` 안에서 상위 명령 branch가 소유하는 내부 검증 조건을 제외하고, 실제 상태 전이 13건과 동적 `/로켓1,`~`/로켓10,`을 별도 logical consumer로 수집한다. 완전성 oracle은 consumer parser를 재사용하지 않고 raw `if` span과 독립 ancestor ownership 규칙으로 대사한다. 부정-only guard 6건은 후보에서 제외하고, 양의 `/매력` guard에 붙은 `/매력박스오픈` 제외 조건은 하나의 정상 진입 조건으로 유지한다. `app.ts`는 `buildApp` 및 실제 dispatch helper만 구조적으로 수집하고 normalizer 내부 조건과 도달 불가능한 ternary handler 6건은 제외한다. 반대로 negative early-return 형태의 `admin_account_suspension`, `mini_pet_bulk_cleanup`, 길드 가입권 소비, 게시판 우표 소비, 캐슬 전투/현황은 실제 소비자로 포함한다. 별도 source oracle이 app 후보 286건(raw guard 2건과 HTTP endpoint 81건 포함)을 만들고 두 set을 대사한다. HTTP는 8개 registrar 자체가 아니라 `METHOD|PATH` 단위로 동결하며 독립 구조 파서가 GET 33, POST 28, PATCH 5, PUT 5, DELETE 10을 확인한다. 관리자 계층은 실제 양의 command guard 78건을 독립 source oracle과 대사하며 helper/formatter는 제외한다. 아이템 가방을 지급하는 펫스킬북·펫던전입장 지급 명령은 이름이 아니라 실제 저장소 기준으로 ITEM에 귀속한다. SQL 저장소는 파일 단위가 아니라 public method 단위이며, 공용 title repository는 member/pet/mini-pet 3개 도메인 인터페이스로 분리한다. 동결 결과는 총 1090개다.

- LEGACY_COMMAND 684
- AUTOMATIC_CALLBACK 3
- RUNTIME_DISPATCH 199
- ADMIN_COMMAND 78
- HTTP_WEB_ROUTE 81
- APP_WIRING 5
- SQL_REPOSITORY 40
- consumer set SHA-256: `02168aa02b9fde44b0f0d9a1ebb178e5ac4468d7ddeabf6471ce955e771de226`
- exact-one primary slice: 1090/1090, legacy/app/admin/HTTP source 후보 orphan 0, extra 0, logical duplicate 0, undeclared selector 0
- active object registry row 367건을 source guard와 대조했다. mismatch 10건은 `/길드계급표`, `/길드스타터오픈4`, `/길드스타터오픈5`, `/길드영지오픈1`, `/다이아패스삭제`, `/다이아패스추가`, `/오픈하면어른이됩니다`, `/창세오픈`, `/펫탐험시작`, `/호월오픈`이다. 실제 guard가 없고 label/comment/helper 또는 내부 비교에만 있으므로 실행 consumer로 추론하지 않는다. `/패키지제거`, `/패키지알림`은 정규식 alias로 정상 대조된다.

분류 기준과 실제 코드의 차이도 숨기지 않고 계약에 봉인했다. `/가구조합` active trigger는 네 소스에서 찾지 못했으므로 새 명령으로 추론하지 않는다. 조합·건물 recipe 소비 범위에서 후속 확인 대상으로만 유지한다.

## Gate 2 mapping

각 슬라이스는 다음 항목을 필수로 가진다.

- 정확한 `TABLE.COLUMN:SQL_TYPE` binding과 CHAR(8) CUID reference
- 기존 API 재사용 또는 additive port 계획
- 안정 lock 순서
- transaction, rollback, replay, outbox 경계
- 동일 요청 replay 0-write 및 payload drift fail-closed 원칙
- PROD/DEV database identity partition

각 manifest consumer는 `selector:<primarySlice>` 하나와 구체적인 `interfaceId`, interface method, transaction owner/participant, operation receipt table 또는 `P1-MISSING-PORTS`를 가진다. HTTP는 endpoint별 access를 판정하되 interface-property provider를 정적으로 확정할 수 없는 81건 모두 `PORT_ONLY`, `unresolvedDynamicCallCount > 0`, `P1-MISSING-PORTS`로 남기고 추정 SQL을 기록하지 않는다. `/기도` legacy/runtime는 동일 `pet-skill.daily-prayer.execute`에서 펫스킬을 READ하고 ITEM stack 보상만 WRITE한다. 자동·수동 펫탐험 정산은 동일 `pet-explore.settlement.execute`에서 관련 도메인을 READ하고 ITEM stack만 WRITE한다. APP_WIRING 정산의 상세 SQL은 과대 추정하지 않고 미해석 provider 경계로 남긴다. 로켓 10개는 동일 `item.admin-grant.execute` 인터페이스로 묶는다. SQL repository는 public method별 source span과 호출되는 private method closure에서 SELECT와 mutation table을 따로 계산한다. 영수증은 slice 전체 합집합이 아니라 실제 write table과 명령 소유 경계에서 산출한다. 현재 참조되는 영수증 테이블 30개 중 아직 DDL이 없는 11개는 manifest audit와 `requiredAdditiveReceiptTables`에 동일하게 노출한다. receipt가 아직 특정되지 않은 171개 mutation은 허위 공통 영수증을 부여하지 않고 `P1-MISSING-PORTS`로 차단한다.

Identity/environment/single-writer는 실제 소비자 경계로 전파한다. canonical player FK가 실제 선택된 소비자 947개는 exact identity crosswalk, SQL repository를 제외한 entrypoint 1,050개는 DB environment identity, 실제 non-read entrypoint 562개는 mutation 시작 후 fallback 금지 조건을 가진다. 추가 schema 제안은 누락 receipt 11개, identity crosswalk, participant/ledger support, `canonical_app_wiring_operations`를 정의한다. 모든 신규 PK는 CUID2 `CHAR(8) ascii/ascii_bin`, FK는 참조 키와 이름·타입이 동일하며 감사 4컬럼과 KST `CHAR(19)` 정책을 가진다. 두 제안 계약은 아직 실행 migration이나 runtime 구현이 아닌 `PROPOSED_BLOCKING` 상태다.

7개 P1 bridge는 구현되기 전까지 `BLOCKING_UNTIL_IMPLEMENTED`이다.

1. BIGINT legacy player에서 CHAR(8) canonical player로 가는 exact persisted identity crosswalk
2. 누락 lifecycle/read port와 pet core repository
3. DEV/PROD partition
4. market/package/building의 cross-domain transaction·replay·outbox
5. furniture draw-rate policy와 furniture_id binding
6. aggregate/admin cleanup의 canonical owner graph
7. app dispatch single-writer

표시명 추론, generic object CODE, 정의값의 소유 테이블 복제는 모두 명시적으로 금지한다. Pet/mini-pet title selection이 현재 player-scope라는 스키마 제약도 명시한다.

## 검증 명령

2026-09-03 KST freeze 후보에서 실행했다.

```text
node --import tsx scripts/build-object-db-consumer-transition-manifest.ts
=> PASS, 1090 consumers, SHA 02168aa02b9fde44, legacy/app/admin/HTTP source orphan/extra/logical-duplicate/undeclared-selector 0

node --import tsx --test test/object-db-consumer-transition-contract.test.ts
=> PASS 9/9, FAIL 0; 1090건 소스 재도출, HTTP endpoint와 prayer/explore directional contract 포함

node --import tsx --test test/http-route-surface-audit.test.ts test/object-db-consumer-additive-schema-plan.test.ts test/object-db-transition-runtime-boundary.test.ts
=> PASS 19/19, FAIL 0; HTTP 81 endpoint 독립 oracle, additive schema, environment/single-writer 계약 포함

npm run typecheck
=> PASS

npm run build
=> PASS

npm test
=> 이전 전체 실행 1,808 tests 중 PASS 1,799 / SKIP 8 / FAIL 1: 새 audit 파일이 legacy currency provider scan에 포함된 회귀. canonical audit marker 추가 후 해당 회귀 test 8/8 PASS. 최신 전체 suite 재검증 필요.

node --check ../../main.js
=> PASS

node --check ../../Info.js
=> PASS

git diff --check
=> PASS after `git add -N` intent-to-add for all twelve WBS743 files (untracked content included)

node JSON UTF-8 parse (manifest + transition + additive schema + runtime boundary contracts)
=> PASS
```

`npm ci --ignore-scripts`로 lockfile 그대로 의존성을 설치했으며 tracked dependency 파일 변경은 없다. `npm audit`은 기존 의존성에 moderate 1/high 1을 보고했지만 이 Gate1/2 계약 변경의 코드·lockfile 변경은 아니다.

## Gate 판정

- Gate 1: 9/9 계약과 HTTP 81 endpoint 독립 구조 검증, 최종 독립 reviewer 승인으로 TRUE 유지
- Gate 2: 방향성·영수증·schema/runtime-boundary 제안 계약과 독립 reviewer 승인은 통과했다. 필수 additive receipt DDL 11개와 app-wiring claim store, identity/environment/single-writer, 누락 port의 실제 구현이 없으므로 FALSE
- Gate 3 이후 소비자 구현: 시작하지 않음
