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

## 2026-09-04 Gate 2 runtime provider checkpoint

위 2026-09-03 기록은 당시의 동결 증거로 보존한다. 이 checkpoint는 이후 적용된 migration/runtime 구현을 별도로 기록하며, 과거 `baseCommit`을 현재 `HEAD`와 같다고 간주하지 않는다. `baseCommit=f97be62292c3f7e8ea79b2d6f302dd25517584d4`는 Gate 1 분류 기준인 ancestor로 유지하고, 동결 해시는 그 commit의 Git blob에서 검증한다. 현재 구현 파일은 별도의 `implementationEvidence.currentImplementationSourceHashes`와 source anchor로 검증하므로 계약 파일을 commit한 뒤에도 `HEAD == baseCommit` 자기참조 실패가 발생하지 않는다.

### 판정

- 상태: `PARTIALLY_IMPLEMENTED_BLOCKING_INGRESS_ADOPTION`
- P0 accepted: `HOIBOT_ENVIRONMENT_CODE` 명시 구성, startup `SELECT DATABASE()` identity 검증, connection-bound `withControlledTransaction`/`withReadOnlySnapshot` capability가 source와 test에서 확인됐다.
- P1 accepted: migration 466, `MariaAppWiringOperationProvider`, `executeAppWiringEntrypoint`, command dispatcher의 `resolveReadOnly`, canonical shadow read provider가 정적·단위 검증을 통과했다.
- P2: 격리 MariaDB forward/replay/rollback/restart 검증은 `UNVERIFIED`다. 정적 migration test를 P2로 승격하지 않는다.
- 실제 runtime ingress adoption: `0`건. `IRIS`, `AUTOMATIC`, `ADMIN`, `WEB` 어느 production source도 `executeAppWiringEntrypoint`를 호출하지 않는다. `server.ts`는 verified `EnvironmentContext`를 `buildRuntimeApp`에 전달하지만 `app.ts`는 optional dependency로 받을 뿐 provider를 구성하거나 runner를 호출하지 않는다.
- 따라서 `migrationFilesChanged=true`, `runtimeFilesChanged=true`, `currentRuntimeCompliant=false`이며 production cutover는 허용되지 않는다.

### accepted source evidence

- `runtime/src/database.ts`: 기존 `DatabaseClient` 호환을 유지하면서 한 connection의 controlled transaction/savepoint와 repeatable-read read-only snapshot capability를 제공한다.
- `runtime/src/config.ts`, `runtime/src/server.ts`: database-enabled startup에서 dev/prod environment를 명시하고 실제 database identity를 검증한 뒤 app을 구성한다.
- `runtime/src/dispatch/command-dispatcher.ts`: claim 전 route 조회용 `resolveReadOnly`와 기존 decision 기록을 분리한다. 현재 app ingress는 아직 기존 `resolve`를 사용한다.
- `runtime/src/dispatch/app-wiring-operation-provider.ts`: route와 `effectMode`를 claim에 저장하고, lease token/generation/expiry/attempt fence, expired CLAIMED takeover, `MUTATION_STARTED` recovery refusal, legacy all-NULL metadata drain을 구현한다.
- mutation T1은 `CLAIMED -> MUTATION_STARTED`, domain participant write, typed receipt `FOR UPDATE` 확인, `canonical_app_wiring_receipt_links` insert, fenced `COMPLETED`를 한 controlled transaction에 둔다. 실패 시 T1 전체 rollback 뒤 별도 terminal failure만 허용한다.
- `runtime/src/dispatch/app-wiring-entrypoint-runner.ts`: 저장된 route/effect만 실행하고 terminal replay를 재사용한다. `MODERN`/`LEGACY_FALLBACK`의 READ_ONLY와 MUTATION capability를 구분하며 SHADOW/REJECT는 write participant를 받지 않는다.
- `runtime/src/catalog/canonical-object-shadow-read-provider.ts`: canonical object domain을 한 read-only snapshot으로 읽고 stable projection/fingerprint를 만든다. legacy comparison ingress는 아직 없다.
- migration `466_object_db_transition_recovery_receipt_links.sql`: 기존 claim store에 effect/lease/generation/recovery metadata를 추가하고 9종 typed operation receipt link를 정확히 하나의 FK로 묶는다. pre-lease all-NULL row 허용은 storage compatibility이며 자동 실행 허가가 아니다.
- `main.js`: Rhino JSON mutation은 Node MariaDB T1에 참여할 수 없으므로 mutation-capable `LEGACY_FALLBACK`은 durable handoff/ack protocol 없이 연결하면 안 된다.

### consumer manifest 재생성

builder는 transition 계약에서 immutable `baseCommit`을 읽고 현재 source를 재감사한다. 2026-09-04 결과는 총 1,092건, SHA-256 `c98128fdfe88d7c1c02bdfe1d92bfcb59620a7581bd755b1ec51683fa4a07b8e`다.

- LEGACY_COMMAND 684
- AUTOMATIC_CALLBACK 3
- RUNTIME_DISPATCH 199
- ADMIN_COMMAND 78
- HTTP_WEB_ROUTE 81
- APP_WIRING 5
- SQL_REPOSITORY 42
- orphan/extra/duplicate-primary/undeclared-selector 0
- 참조 operation receipt table 30개, DDL 누락 0개. 과거 `requiredAdditiveReceiptTables` 11개는 additive migration으로 authoritative table에 존재하며 historical requirement 목록으로 유지한다.

### 검증

```text
node --import tsx scripts/build-object-db-consumer-transition-manifest.ts
=> PASS, 1,092 consumers, SHA c98128fdfe88d7c1c02bdfe1d92bfcb59620a7581bd755b1ec51683fa4a07b8e

node --test --import tsx test/object-db-transition-runtime-boundary.test.ts test/object-db-consumer-transition-contract.test.ts
=> PASS 17/17 after contract correction; manifest exact re-derivation, baseline/current hash separation, runtime boundary and ingress-zero assertions 포함

npm run typecheck
=> PASS

git diff --check
=> PASS; 기존 작업트리 파일의 LF/CRLF 경고만 있으며 whitespace error 없음
```

남은 차단 조건은 (1) P2 MariaDB rehearsal, (2) 네 ingress family의 effect metadata/normalized payload/replay loader/typed receipt adapter 연결, (3) legacy mutation durable handoff, (4) 실제 handler가 raw `DatabaseClient` 대신 runner가 제공한 participant를 사용하도록 이행하는 것이다.

## 2026-09-04 REJECT 보정 B: EOL canonicalization과 immutable baseline pin

직전 checkpoint의 `baseCommit`/hash 검증을 fresh checkout의 `core.autocrlf`와 mutable contract 변경으로부터 독립시켰다.

- exact baseline pin은 `runtime/src/data-migration/object-db-consumer-baseline.ts`의 `OBJECT_DB_CONSUMER_BASELINE_COMMIT`이며 값은 `f97be62292c3f7e8ea79b2d6f302dd25517584d4`다.
- builder는 더 이상 `object-db-consumer-transition.v1.json`에서 `baseCommit`을 읽지 않는다. 독립 pin만 `deriveConsumerManifest`에 전달한다.
- 계약의 `baseCommit`도 exact pin과 같아야 하고, pin은 `HEAD`의 ancestor여야 한다. 둘 중 하나라도 어긋나면 계약 테스트가 실패한다.
- 공용 `canonicalizeObjectDbConsumerSourceText`는 CRLF와 bare CR을 모두 LF로 바꾼다. object consumer audit, HTTP route surface audit, builder 경로와 계약 테스트는 이 canonical text를 사용한다.
- source span의 start/end와 span SHA-256, frozen Git blob hash, `currentImplementationSourceHashes`, HTTP route span, consumer 배열과 `consumerSetSha256`은 모두 canonical LF 입력에서 산출·검증한다.
- 직접 EOL 회귀 테스트는 동일한 LF/CRLF/bare-CR fixture의 canonical text와 SHA-256이 같음을 확인한다.

canonical 방식으로 재생성한 manifest는 `sourceTextNormalization=CRLF_AND_CR_TO_LF_BEFORE_SPAN_AND_HASH`를 기록한다.

- total 1,092
- LEGACY_COMMAND 684, AUTOMATIC_CALLBACK 3, RUNTIME_DISPATCH 199, ADMIN_COMMAND 78, HTTP_WEB_ROUTE 81, APP_WIRING 5, SQL_REPOSITORY 42
- consumer set SHA-256: `59ec618ab69de51a161e59171275f6d7f96567128960a8dec57613ca5b04ea85`
- orphan/extra/duplicate-primary/undeclared-selector 0

검증 결과:

```text
node --import tsx scripts/build-object-db-consumer-transition-manifest.ts
=> PASS, 1,092 consumers, canonical SHA 59ec618ab69de51a161e59171275f6d7f96567128960a8dec57613ca5b04ea85

node --test --import tsx test/object-db-consumer-transition-contract.test.ts test/http-route-surface-audit.test.ts
=> PASS 13/13, FAIL 0

npm run typecheck
=> PASS on final rerun. 최초 실행에서는 범위 밖 동시 변경 중이던 두 DomainImportPolicy fixture의 acceptedImportContractSha256 누락을 관찰했으나, 최종 재실행 시 해당 외부 변경이 정리되어 통과했다.

scoped git diff --check
=> PASS; LF/CRLF checkout 안내 경고만 있고 whitespace error 없음
```

최초 typecheck 오류가 발생했던 import/parity 파일은 이 보정 범위에서 수정하지 않았다.

## 2026-09-04 PET_EXPLORE IRIS SHADOW/REJECT 첫 production ingress 통합 checkpoint

앞선 ingress 0건 checkpoint와 REJECT 보정 기록은 당시 증거로 그대로 보존한다. 이후 독립 검수에서 PET_EXPLORE 구현, stable consumer ID, production runtime adoption audit가 각각 ACCEPT 되었고, 이 checkpoint는 그 승인된 결과만 현재 계약과 manifest에 통합한다.

### 현재 판정

- 전체 상태는 계속 `PARTIALLY_IMPLEMENTED_BLOCKING_INGRESS_ADOPTION`이다. `currentRuntimeCompliant=false`, `cutoverClaimed=false`를 유지한다.
- 승인된 production runner call은 정확히 1건이다. `IRIS`의 `PET_EXPLORE` 도메인에서 `EVENT_CONTROL`, `SETTLEMENT` 두 consumer family가 하나의 `PetExploreAppWiringIngress.handle` callsite를 공유한다.
- 허용 effect는 `SHADOW`, `REJECT`뿐이다. `MODERN`은 fail-closed이며 `LEGACY_FALLBACK`은 Node claim/runner 밖에 남겨 legacy writer와 이중 쓰기를 만들지 않는다.
- settlement SHADOW는 실제 `previewPetExploreSettlementInput` read path와 `buildPetExploreSettlementInput`을 재사용한다. one-current/next-auto round, pinned policy/hash, 정확한 11 destination, participant revision/hash/gap, threshold/premium/up-item/>100%, ticket/fallback/reward plan을 read-only snapshot 안에서 검증한다.
- 아직 미완료인 범위는 IRIS MODERN, durable legacy handoff, 나머지 IRIS, AUTOMATIC, ADMIN, WEB ingress, typed mutation receipt/participant 전환, P2 MariaDB rehearsal이다.
- 실제 MariaDB forward/replay/rollback/restart는 `UNVERIFIED`이며 정적·합성 검증을 P2로 승격하지 않는다.

### 승인 해시와 call-graph 근거

- `runtime/src/app.ts` canonical-LF SHA-256: `8d82b81895b92d49d1ec7e6828303f3f5b301042cca637d97de1cb06228bdbd8`
- `runtime/src/pet/pet-explore-app-wiring-ingress.ts` canonical-LF SHA-256: `1cf1a67eeee1db07b2d08f7e9f7de977eb86f3e48f7f3521cdc6fc21c9d415dc`
- `runtime/src/pet/pet-explore-settlement-input-snapshot-provider.ts` canonical-LF SHA-256: `6eed73249632a5b4df2e3ed4b3dca537edcb6f5902ba5b11424131d56d88946e`
- `runtime/src/data-migration/object-db-runtime-adoption-audit.ts` canonical-LF SHA-256: `1484a0b77a2efabf708413b8bb2a7e7ab742fbed7015bd638a4b0e30d2e6c7aa`
- 계약 테스트는 app/server/dispatcher 문자열에서 runner 이름을 직접 세지 않는다. 승인된 두 source hash를 필수 입력으로 받아 실제 composition, IRIS route callback, 두 wrapper guard/forwarding, ingress runner options와 닫힌 route를 따라가는 `auditObjectDbRuntimeAdoption` 결과와 계약의 call count/family를 exact 비교한다.

### consumer manifest와 stable ID

builder를 immutable baseline pin으로 재실행한 결과는 1,092건이며 consumer 배열의 current evidence SHA-256은 `5058ed8b3c591da230b5eae7db63c6918aa22df1d9fcc14aa28dd5208c5e2ecc`다.

- LEGACY_COMMAND 684
- AUTOMATIC_CALLBACK 3
- RUNTIME_DISPATCH 199
- ADMIN_COMMAND 78
- HTTP_WEB_ROUTE 81
- APP_WIRING 5
- SQL_REPOSITORY 42
- stable registry 1,092건과 logicalKey→consumerId drift 0, registry orphan 0
- registry의 `sourceManifestConsumerSetSha256=59ec618ab69de51a161e59171275f6d7f96567128960a8dec57613ca5b04ea85`는 stable ID를 채택할 때의 immutable seed provenance다. 현재 manifest self-hash와 역할이 다르므로 덮어쓰지 않는다.

### 검증 결과

```text
node --import tsx scripts/build-object-db-consumer-transition-manifest.ts
=> PASS, 1,092 consumers; LEGACY_COMMAND 684 / AUTOMATIC_CALLBACK 3 / RUNTIME_DISPATCH 199 / ADMIN_COMMAND 78 / HTTP_WEB_ROUTE 81 / APP_WIRING 5 / SQL_REPOSITORY 42; current consumerSet SHA 5058ed8b3c591da230b5eae7db63c6918aa22df1d9fcc14aa28dd5208c5e2ecc

node --test --import tsx test/object-db-consumer-transition-contract.test.ts
=> PASS 11/11; manifest exact re-derivation, 1,092 consumer inventory, current implementation hashes, helper-derived one-call adoption 포함

node --test --import tsx test/object-db-transition-runtime-boundary.test.ts test/object-db-runtime-adoption-audit.test.ts
=> PASS 34/34; reviewed hash와 reachable call graph에서 IRIS/PET_EXPLORE SHADOW+REJECT 1건, EVENT_CONTROL+SETTLEMENT을 도출

node --test --import tsx test/pet-explore-app-wiring-ingress.test.ts test/pet-explore-settlement-input-snapshot.test.ts test/pet-explore-settlement-command-consumer.test.ts test/pet-explore-settlement-provider.test.ts
=> PASS 29/29; query-only claim boundary, replay 0 evaluator, payload drift, failure persistence, settlement parity preview 검증

node --test --import tsx test/object-db-consumer-stable-id.test.ts
=> PASS 5/5; seed provenance와 current manifest evidence hash 분리, 1,092 stable mapping 0 drift

npm run object-data:validate
=> PASS, 등록 대상 93개

npm run typecheck
=> PASS

scoped git diff --check
=> PASS; checkout의 LF/CRLF 안내 경고만 있고 whitespace error 없음
```

Gate 2 전체를 완료로 표시하지 않는다. 이 checkpoint는 첫 production ingress의 read-only SHADOW/REJECT 채택 증거이며, Gate 2 완료와 production cutover의 증거가 아니다.

## 2026-09-04 Gate 2 P2 isolated MariaDB migration and mutation checkpoint

- 전용 harness: `runtime/scripts/rehearse-object-db-transition-gate2-p2.ps1`
- 전용 test: `runtime/test/object-db-transition-gate2-p2-mariadb.integration.test.ts`
- MariaDB: 로컬 설치 12.2, 격리 listener `127.0.0.1:3323`, 합성 DB `hoibot_rehearsal_wbs743_gate2_p2`
- migration 001~465를 fresh 합성 DB에 적용한 뒤 migration 466과 470을 실제 MariaDB에서 검증했다.
- 잘못된 terminal payload는 첫 DDL 전에 `ER_SUBQUERY_NO_1_ROW`로 거부됐고, 7개 컬럼과 receipt-link table은 생성되지 않았다.
- 유효 legacy claim backfill, 7개 컬럼, 2개 index, 16개 CHECK, migration 466 receipt-link table의 10개 FK와 migration 470 적용 후 11개 FK를 확인했다.
- migration 466/470 forward와 re-entry가 성공했고, 최신 재검증에서 MariaDB 재시작 전후 PID `1236 -> 10612`로 persistence를 확인했다. 두 migration checksum도 재시작 전후 대사했다.
- 실제 `MariaAppWiringOperationProvider`/runner로 SHADOW·REJECT terminal replay의 evaluator/handler 재실행 0, payload drift 거부, active lease 거부, expired CLAIMED generation/attempt 증가 takeover, legacy all-NULL active drain 거부를 확인했다.
- 실제 EVENT_CONTROL MODERN 요청 두 개를 같은 claim lock에 경합시켜 domain mutation 실행자가 1명뿐임을 확인했고, 두 번째 요청은 저장된 terminal 결과를 재생했다.
- domain 변경, legacy operation/change/audit/execution/outbox, canonical typed receipt/link와 app-wiring `COMPLETED`를 같은 T1에서 확정했다. terminal update trigger fault에서는 이 전체가 rollback되고 별도 `FAILED` claim만 남았다.
- handler 실행 중 시계를 lease 만료 뒤로 이동해 다음 DML을 차단하고, 새 generation takeover 뒤 이전 prepared owner의 재실행도 `APP_WIRING_LEASE_FENCE_CONFLICT`로 거부했다.
- 재시작 뒤 관련 claim, typed receipt/link, runtime config, legacy operation/change/relocation/audit/execution/outbox의 전체 행 snapshot이 그대로였고 domain handler 재실행과 새 DML은 0이었다. link fingerprint 또는 claim `referenceId`를 고의로 손상하면 replay가 fail closed하고, 복원 후 정상 재생했다.
- EVENT_CONTROL durable receipt가 남아 있는 rollback 470은 첫 DDL 전에 거부됐다. 합성 link, typed receipt와 완료 mutation claim을 함께 제거한 pre-cutover 조건에서 rollback, rollback re-entry와 migration 466/470 re-forward가 성공했고 완료 mutation orphan 0을 재검증했다.
- 운영 `3306` listener 소유자는 전후 동일했고, 종료 후 `3323` listener와 `.tmp/wbs743-gate2-p2-mariadb`는 제거됐다.
- 실행 결과: prepare `1/1 PASS`, restart/rollback `1/1 PASS`, typecheck PASS.
- 최종 harness 결과: `migration466ChecksumVerified=true`, `migration470ChecksumVerified=true`, `liveReceiptRollbackPreflight=true`, `concurrentSingleOwner=true`, `expiredLeaseFenced=true`, `mutationAtomicity=true`, `terminalFaultRollback=true`, `replayReceiptValidated=true`, `restartReplayDmlZero=true`.
- 따라서 WBS743 Gate 2의 P2 실제 MariaDB provider/recovery 증거는 완료로 판정한다. 다만 나머지 ingress family의 MODERN 채택, durable legacy handoff와 소비자별 typed participant 이행은 남아 있으므로 Gate 2 전체는 완료로 표시하지 않는다.

## 2026-09-04 PET_EXPLORE EVENT_CONTROL MODERN adoption checkpoint

- `PetExploreAppWiringIngress`는 EVENT_CONTROL family에만 `MODERN/MUTATION`을 허용한다. SETTLEMENT MODERN과 모든 Node `LEGACY_FALLBACK` 실행은 계속 fail closed다.
- EVENT_CONTROL mutation은 app-wiring participant 안에서 권한, config lock/CAS, relocation evidence, legacy operation/change/audit/execution/outbox, canonical typed receipt와 receipt link를 한 T1로 처리한다.
- 완료된 MUTATION 재생은 claim `referenceId`와 typed operation ID의 일치, claim `resultFingerprint`, 정확히 1개인 typed link, discriminator/typed ID, typed operation의 `COMPLETED` 상태와 fingerprint를 모두 다시 검증한다.
- mutation participant의 각 DML과 terminal 전환은 현재 lease token/generation/expiry를 재검증한다. 만료 writer와 takeover 이전 generation은 새 DML 및 terminal 기록을 할 수 없다.
- migration 470 rollback은 EVENT_CONTROL durable receipt가 존재하면 첫 DDL 전에 실패한다. 이는 pre-cutover destructive rollback 조건을 명시적으로 강제한다.
- 최신 manifest는 1,092건, SHA-256 `46ebbadc662eeb8397f3097038e85d094b50350d428da708638a60f85bc48a44`다. 종류별 수 `684/3/199/78/81/5/42`, orphan/extra/duplicate-primary/undeclared-selector 0과 stable ID 검증 5/5를 유지한다.
- 최신 전환 계약·runtime adoption·runtime boundary 검증은 53/53 PASS, provider/runner/ingress/event-control 집중 검증은 46/46 PASS, additive migration/stable-ID 검증은 19/19 PASS, object-data manifest 93개와 typecheck가 PASS다.
- Gate 2 상태는 계속 `PARTIALLY_IMPLEMENTED_BLOCKING_INGRESS_ADOPTION`이다. 이 checkpoint는 첫 MODERN mutation family와 P2 완료 증거이며, 전체 1,092 consumer parity 또는 Gate 2 완료를 의미하지 않는다.

## 2026-09-04 stack-bag Shadow provider 및 manifest 재동기화 checkpoint

- `/가방`, `ㄴㄴㄴ`의 현재 modern stack-bag 읽기 범위에 한해 SELECT-only Shadow parity provider를 추가했다.
- identity/crosswalk 단일 `LINKED` 매핑, Unicode·emoji, lossless BIGINT, `legacyBagOrder`, row-order 독립 fingerprint, 누락·추가·수량·순서 mismatch를 검증한다.
- `parity`는 stack 영역만 뜻하며, 감지된 item instance는 `hasOutOfScopeRecords`와 `cutoverReady=false`로 분리한다. header·owner label·advertisement 및 equipment/pet 영역은 명시적으로 범위 밖이다.
- 독립 검토의 P1/P2/P3 지적을 모두 보정한 뒤 집중 테스트 14/14와 재검토 11/11을 통과했다.
- 현재 source에서 manifest를 재생성한 결과는 1,094건, SHA-256 `8c5834753651a364ac62c31c4b7a93bd59c6a08c9e48b000ce56fca31ba45b2c`다. 종류별 수는 `684/3/199/78/81/5/44`다.
- stable consumer ID registry도 동일한 1,094 logical key로 재동기화했으며, 신규 SQL repository 2건은 bag Shadow compare와 PET_EXPLORE EVENT_CONTROL execute다.
- migration 470과 최종 receipt-link shape를 object-data-model manifest에 등록했고 validator는 94개 표준 테이블을 검증한다.
- 두 WBS743 계약의 P2 상태는 `VERIFIED_ISOLATED_MARIADB_FORWARD_REPLAY_ROLLBACK_RESTART`로 동기화했다.
- Gate 2 상태는 계속 `PARTIALLY_IMPLEMENTED_BLOCKING_INGRESS_ADOPTION`이다. 이 checkpoint는 전체 1,094 consumer parity, 전체 `/가방` parity 또는 Gate 2 완료를 의미하지 않는다.
