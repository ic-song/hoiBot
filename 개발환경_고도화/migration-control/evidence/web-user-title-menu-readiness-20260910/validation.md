# WEB-WBS-011F 사용자 타이틀 독립 메뉴 readiness 감사

- 실행 범위: `Lease2664` / `WEB-WBS-011F`
- 사용자 결정: 타이틀은 가방 분류에서 제외하고 `/account/titles` 별도 메뉴로 구성한다.
- catalog version: `SC-20260902-1`
- delta: `SCD-WEB-20260910-20`
- evidence schema: `web-user-title-menu-readiness-v1`
- 기준선: `0e36833bc250e7dd857181f9cb7731d9aa087072`
- 실행 profile / tier: `READINESS_AUDIT` / `T0`
- 변경 범위: 이 evidence와 WBS011F 체크포인트만 추가한다. source, test, DB, migration, 운영 데이터, `feature/prod`, Gate 8은 변경하지 않는다.

## 판정

**조건부 구현 가능(READY_AFTER_PREDECESSORS)** 이다. 현재 runtime에는 레거시 보유 순서, 획득일, 가격, 장착 상태를 보존하는 `PlayerTitleReadService`와 `lockPlayerTitleOwnedProjection`, 장착 일관성을 보장하는 `PlayerTitleSelectService`가 있다. 따라서 별도 사용자 메뉴의 표시 계약을 확정할 근거는 충분하다.

다만 기존 `PlayerTitleReadService.read()`는 Iris 명령 실행을 위해 `operations`, `command_executions`, `command_audit`, `outbox_messages`를 기록하고 내부 `targetPlayerId`, `titleId`, `outboxId`를 결과에 포함한다. 이 서비스를 웹 GET에 직접 연결하면 read-only DML 0과 최소 공개 DTO를 만족하지 못한다. 웹은 현재 세션의 `playerId`만 받는 별도 SELECT-only provider를 만들고 공개 필드를 다시 정의해야 한다.

또한 migration 448/455의 최종 canonical member-title 테이블은 준비돼 있지만 현재 `PlayerTitleReadService`, `PlayerTitleSelectService`, `lockPlayerTitleOwnedProjection`은 transitional `player_title_instances`, `player_titles`, `title_definitions`를 사용한다. strict canonical 전환은 이름 재매핑이나 이중 합산으로 처리하지 않는다. WBS799 독립 Gate 7과 canonical identity/import/consumer binding이 확인되기 전에는 canonical 테이블을 웹에서 임의로 직접 읽지 않는다.

## 레거시와 현재 runtime 계약 대조

| 항목 | 레거시 기준 | 현재 runtime 기준 | 웹 계약 |
| --- | --- | --- | --- |
| 자기 범위 | `/타이틀목록`, `/타이틀정보 [번호]`는 요청자 자신의 `titleData.member[sender]`만 조회 | 현재 linked Kakao identity의 active/undeleted player를 조회 | refresh된 웹 세션의 현재 `playerId`만 허용. query/body에 nickname, playerId, internal ID를 받지 않음 |
| 표시 순서 | `title.list` 배열 순서, 1부터 시작하는 번호 | instance `display_order,id`, fallback `display_order/acquired_at/title_id`; 합친 뒤 `displayOrder` 순 | provider의 안정 순서를 유지하고 `number=offset+index+1`; DB ID를 번호로 쓰지 않음 |
| 장착 상태 | `title.num`과 현재 index가 같으면 `☞` | 보유 projection의 `equipped`; 선택 service는 한 instance/title만 true가 되게 갱신 | 각 항목에 `equipped:boolean`을 표시하고 현재 장착 카드/배지를 제공. 이번 WBS에는 장착 변경 버튼을 넣지 않음 |
| 목록 표시 | 이름, 10개 초과 시 접힘 표식, 비어 있으면 `보유 타이틀이 없습니다.` | `formatPlayerTitleList`가 같은 이름·장착·순서를 보존 | 이름과 장착 상태를 우선 표시하며 empty/loading/error를 분리. 채팅용 zero-width `allsee`는 웹에 전달하지 않음 |
| 상세 표시 | `/타이틀정보`가 이름, 획득일, 구매액, 판매가를 표시 | `formatPlayerTitleInfo`가 BIGINT-safe 문자열로 `<10000 → 1000000`, 그 외 `30%` 판매가를 계산 | 목록 응답에 상세 필드를 포함해 행을 펼치면 같은 값을 표시. 내부 식별자 없음 |
| 공성전 | `/타이틀정보`는 `castleSiegeFlag` 중 무응답 | WBS799 correction은 활성 `guild_territory_wars`에서 actor/receipt 전 null 반환을 추가, Gate 7 검토 중 | 웹 조회 가용성 정책은 채팅 무응답을 그대로 복제하지 않는다. provider source cutover 전 제품 정책으로 별도 확정하고, 임의 무응답 대신 명시 상태를 사용 |
| side effect | 레거시 JSON 조회 경로는 저장하지 않음 | 명령 read service는 source-domain DML 0이지만 실행 감사/outbox DML이 있음 | title-domain 및 execution/audit/outbox DML 0. 인증 세션 refresh는 기존 auth 경계로 분리 |

## canonical 자산과 현재 공백

### 사용 가능한 자산

- `448_canonical_title_domains.sql`: `canonical_member_title_definitions`, `canonical_owned_member_title_instances`, `canonical_member_title_selections`를 분리한다. 보유 순서는 `acquisition_sequence`, 장착은 selection의 owned instance FK로 표현한다.
- `455_title_instance_acquisition_price.sql`: occurrence별 `acquisition_price`를 추가한다. 기존 imported row의 값이 unknown이면 `NULL`을 유지하며 definition 가격으로 추정하지 않는다.
- `canonical_player_identity_crosswalks`: external identity에서 canonical player로 가는 stable crosswalk 계약이 있다.
- `MariaCanonicalTitleRepository`: canonical 정의/보유/선택의 mutation/read primitive가 있으나 사용자 웹 read model은 아니다.
- 현재 transitional `PlayerTitleReadService`와 `PlayerTitleSelectService`: 목록·상세·선택의 legacy parity oracle이며, WBS798 목록과 WBS799 상세 실행 근거에 연결된다.

### 구현 전 닫을 공백

1. **WBS799 Gate 7:** Lease2663 독립 검토가 GO이고 exact commit이 통합돼야 한다. 이 감사는 진행 중 Gate를 대신하거나 초기화하지 않는다.
2. **권위 provider 선택:** 첫 웹 구현은 현재 검증된 transitional projection을 SELECT-only로 읽거나, canonical consumer binding이 Gate 7을 받은 뒤 canonical projection을 읽는다. 두 저장소를 표시명으로 merge/fallback하면 안 된다.
3. **canonical self binding:** strict canonical 경로는 웹 세션의 current player가 정확히 하나의 linked canonical player로 해석되는지, revoked/missing/duplicate crosswalk가 fail closed하는지 증명해야 한다.
4. **nullable acquisition price:** `NULL`은 `가격 기록 없음`으로 표시하고 판매가도 미표시한다. `base_sale_price`로 occurrence 구매액을 만들어내지 않는다.
5. **공용 shell 직렬화:** 현재 Lease2662는 `user-shell-assets.ts`를 R로만 보유하므로 이번 readiness R/R과 충돌하지 않는다. `/account/titles` UI는 `user-shell.ts`, `user-shell-assets.ts`, 관련 테스트를 W로 쓴다. 향후 WEB-WBS-009A 구현 Lease가 같은 shell 파일을 W로 claim하면 011F UI 구현과 직렬화한다.

## 동결 API와 UI 계약

### 사용자 API

- route: `GET /api/v1/titles/current?limit=<1..100>&offset=<0..>`
- authentication: `hoibot_user_session` refresh 성공 필수
- scope: current session player self-only
- success shape:

```json
{
  "ok": true,
  "ownerLabel": "⭐사용자",
  "items": [
    {
      "number": 1,
      "displayName": "보유 타이틀",
      "acquiredDisplay": "2026-08-27 23:00",
      "acquisitionPrice": "15000",
      "salePrice": "4500",
      "equipped": true
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 1, "hasMore": false },
  "requestId": "fastify-request-id"
}
```

- `acquisitionPrice`와 `salePrice`는 decimal/uint64 정밀도를 잃지 않는 문자열이며 unknown은 둘 다 `null`이다.
- 공개 금지: runtime/canonical player ID, title definition/instance ID, account/link ID, crosswalk/source locator, operation/audit/outbox/receipt ID.
- 200 empty: `items=[]`, `total=0`. 401 session invalid, 404 active current player/canonical binding 없음, 422 pagination invalid. 모든 오류는 stable application code와 사용자 문구를 가진다.
- GET provider는 title/operation/outbox/audit/import/ledger DML을 실행하지 않고 `FOR UPDATE`도 사용하지 않는다.

### `/account/titles` UI

- 왼쪽 내비게이션에 `타이틀` / `보유·장착` 항목을 추가하고 deep link·refresh·history 경로를 지원한다.
- 가방 tablist에는 일반 가방, 가구가방 등 실제 가방 category만 남기며 타이틀 tab을 추가하지 않는다.
- 상단은 현재 장착 타이틀을 이름으로 요약한다. 목록 각 행은 번호·이름·장착 배지를 표시하고, 상세 버튼으로 획득일·구매액·판매가를 펼친다.
- 상세 버튼은 실제 `button`, 최소 44×44px, `aria-expanded`와 `aria-controls`를 사용한다. visual order와 tab order가 같고 focus ring을 유지한다.
- route 진입 시 `titles-title`로 focus를 옮기고, loading/empty/error/retry 상태를 분리하며 screen reader live status를 갱신한다.
- 401/logout에서는 title payload, 장착 요약, 상세 text를 모두 제거한다. stale pagination/detail response가 현재 route state를 덮지 않는다.
- 375, 768, 1024, 1440px에서 horizontal overflow 0. 작은 화면은 wide table 대신 card/definition-list layout을 사용하고 긴 한글 이름과 20자리 가격 문자열을 줄바꿈한다.

UI/UX Pro Max 검색은 keyboard navigation과 visible focus, viewport meta, horizontal overflow 방지, nav-heavy page의 skip link를 우선 항목으로 반환했다. 현 셸의 skip link·반응형 sidebar 계약을 유지하고 새 메뉴와 상세 제어에 같은 규칙을 적용한다.

## 구현 Lease 자원

repository qualifier는 모두 `hoibot/`이다. backend와 UI를 분리해 공용 shell W 충돌 시간을 줄인다.

### Backend SELECT-only provider/API — WBS799 Gate 7 GO 후

**R**

- `R:FILE:hoibot/Info.js`
- `R:FILE:hoibot/main.js`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/player/player-title-read-service.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/player/player-title-select-service.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/player/player-title-owned-projection.ts`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/user-auth/user-auth-service.ts`
- `R:DB:hoibot/players`
- `R:DB:hoibot/player_profiles`
- `R:DB:hoibot/player_legacy_rank_profiles`
- `R:DB:hoibot/player_title_instances`
- `R:DB:hoibot/player_titles`
- `R:DB:hoibot/title_definitions`
- `R:PROVIDER:hoibot/session-current-player`
- `R:EVIDENCE:hoibot/object-db-executable-parity-ledger-wave31-wbs798`
- `R:EVIDENCE:hoibot/object-db-executable-parity-ledger-wave32-wbs799`

**W**

- `W:FILE:hoibot/개발환경_고도화/runtime/src/player/current-player-title-service.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/src/player/current-player-title-web-routes.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/src/app.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/current-player-title.test.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/current-player-title-web-routes.test.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/site-web-app-wiring.test.ts`
- `W:ROUTE:hoibot/GET:/api/v1/titles/current`
- `W:PROVIDER:hoibot/current-player-title-read`
- `W:EVIDENCE:hoibot/web-user-title-menu-provider-v1`
- `W:WBS:hoibot/WEB-WBS-011F-backend`

이 phase에는 `W:DB`와 `W:MIGRATION`이 없다. WBS799가 승인한 transitional projection을 한 authority로 사용하며, strict canonical source를 같은 response에 섞지 않는다.

### Strict canonical provider cutover — 별도 T2 Lease

첫 T1 provider가 stable DTO를 제공한 뒤 canonical consumer binding이 준비되면 같은 provider authority를 교체한다. 이 Lease는 transitional DB와 canonical DB를 한 response에서 merge하는 작업이 아니다.

**R**

- `R:FILE:hoibot/개발환경_고도화/runtime/migrations/448_canonical_title_domains.sql`
- `R:FILE:hoibot/개발환경_고도화/runtime/migrations/455_title_instance_acquisition_price.sql`
- `R:FILE:hoibot/개발환경_고도화/runtime/src/title/maria-canonical-title-repository.ts`
- `R:DB:hoibot/external_identities`
- `R:DB:hoibot/canonical_player_identity_crosswalks`
- `R:DB:hoibot/canonical_players`
- `R:DB:hoibot/canonical_member_title_definitions`
- `R:DB:hoibot/canonical_owned_member_title_instances`
- `R:DB:hoibot/canonical_member_title_selections`
- `R:DB:hoibot/data_migration_object_domain_import_runs`
- `R:DB:hoibot/data_migration_object_domain_import_records`
- `R:DB:hoibot/data_migration_object_domain_import_decisions`
- `R:EVIDENCE:hoibot/object-db-domain-import`
- `R:EVIDENCE:hoibot/object-db-executable-parity-ledger-wave31-wbs798`
- `R:EVIDENCE:hoibot/object-db-executable-parity-ledger-wave32-wbs799`

**W**

- `W:FILE:hoibot/개발환경_고도화/runtime/src/player/current-player-title-service.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/current-player-title.test.ts`
- `W:PROVIDER:hoibot/current-player-title-read`
- `W:EVIDENCE:hoibot/web-user-title-canonical-provider-cutover-v1`
- `W:WBS:hoibot/WEB-WBS-011F-canonical-cutover`

이 cutover도 `W:DB`와 `W:MIGRATION`이 없다. exact crosswalk/import가 없으면 새 schema나 표시명 fallback을 이 Lease에 추가하지 않고 별도 prerequisite WBS로 돌려보낸다.

### UI consumer — backend Gate 1~6 handoff 후

**R**

- `R:ROUTE:hoibot/GET:/api/v1/titles/current`
- `R:PROVIDER:hoibot/current-player-title-read`
- `R:EVIDENCE:hoibot/web-user-title-menu-provider-v1`

**W**

- `W:FILE:hoibot/개발환경_고도화/runtime/src/site-web/user-shell.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/src/site-web/user-shell-assets.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/user-shell.test.ts`
- `W:FILE:hoibot/개발환경_고도화/runtime/test/site-web-app-wiring.test.ts`
- `W:ROUTE:hoibot/GET:/account/titles`
- `W:EVIDENCE:hoibot/web-user-title-menu-ui-v1`
- `W:WBS:hoibot/WEB-WBS-011F-ui`

같은 file/route/provider에 W가 하나라도 있는 Lease와 직렬화한다. 특히 WEB-WBS-009A가 `user-shell.ts` 또는 `user-shell-assets.ts`를 W로 claim하면 UI phase는 동시에 실행하지 않는다. backend `app.ts`와 UI `site-web-app-wiring.test.ts`도 단계 사이 W/W이므로 동시에 commit하지 않는다.

## 검증 tier와 acceptance

구현 profile/tier는 **READ_UI / T1**로 판정한다. DB/migration mutation과 장착 mutation을 포함하지 않기 때문이다. 다만 strict canonical source로 전환하면 shared provider 소비자 영향과 exact import/crosswalk Shadow가 추가되므로 그 provider 전환만 **SHARED_PROVIDER / T2**로 분리한다.

### T1 acceptance

1. legacy 순서·1-based 번호·중복 occurrence·장착 상태·상세 가격 공식의 same-input fixture mismatch 0.
2. 0/1/11/101개, duplicate definition instance, instance+fallback, no equipped, exactly one equipped, inactive definition, sold/removed를 검증.
3. `9999`, `10000`, uint64 max, acquisition price `NULL`을 문자열/unknown 규칙으로 검증하고 JS Number 변환 0.
4. self session만 조회하고 query/body target 값은 수용하지 않음. 401/404/422와 empty 200 exact schema 검증.
5. response forbidden key/value scan에서 raw/internal identifier 0.
6. provider SQL은 SELECT-only, `FOR UPDATE`/transaction execute/title·operation·outbox·audit DML 0.
7. route 등록 exactly once, 기존 login/account/inventory/currencies focused regression PASS, typecheck/build/diff-check PASS.
8. UI는 success/empty/401/404/422/500, retry, pagination, stale response, logout clearing, deep-link/refresh/popstate를 검증.
9. keyboard-only 상세 열기/닫기, visible focus, 44px target, semantic heading/list/button/live status와 375/768/1024/1440 overflow 0.
10. 구현/evidence 작성자가 아닌 독립 검토자가 actual service→route→shell→browser 동일 입력을 재생해 Gate 7을 판정.

### T2 canonical cutover acceptance

- session current player → exact canonical player crosswalk cardinality 1, missing/revoked/duplicate fail closed.
- sealed legacy occurrence와 domain import receipt가 canonical definition/owned/selection에 exact 연결되고 표시명 추론 0.
- `acquisition_sequence`, selection FK, acquired time, nullable acquisition price parity mismatch 0.
- read-only principal의 전후 title/import/ledger checksum 동일, restart fingerprint 동일, rollback 이후 동일.
- transitional provider와 canonical provider를 동시에 합산하지 않고 한 authority만 선택.

## Gate 판정

- Gate 1: `TRUE` — 사용자 결정, 레거시 목록·상세, 현 runtime read/select/projection, canonical schema와 공백을 source 기준으로 재확인했다.
- Gate 2: `TRUE` — self scope, 공개 DTO, 순서·상세·장착 규칙, exact R/W Lease, 직렬화와 acceptance를 동결했다.
- Gate 3~6: `FALSE` — fixture, 구현, 통합, parity/Shadow를 이번 audit에서 만들지 않았다.
- Gate 7: `FALSE` — 구현과 독립 검토 전이다.
- Gate 8: `FALSE` — 운영 반영·관찰·승인 범위가 아니다.

`catalog_version`, `delta_id`, `evidence_schema_version`은 별개다. 이 문서의 delta는 최신 non-superseded CONTROL이 Lease2664에 연결한 값을 사용하며, 기존 WBS798/WBS799 evidence를 새 schema로 재라벨링하지 않는다.

## 봉인 source hash

- `Info.js`: `13ef68e34131d34569c8bca6dd29b6146d2f44573afae64691fb8c6f8737a5f9`
- `main.js`: `f673162accd216f8d22ccd45c026df6b6bce3ef191b67fd68459887ac2ebbbdd`
- `runtime/src/player/player-title-read-service.ts`: `45d8ecaee356f4f01775d0f5d82c050ef995364f4dcd483390c81ad05ee7c618`
- `runtime/src/player/player-title-select-service.ts`: `7fa7deb761e33fc63650509c2a6b0ddbc3ceb735ed76d9e0897f594dd99b4526`
- `runtime/src/player/player-title-owned-projection.ts`: `8070006568d6c15203cbfcc0a1908ba26abb6a4f1fef3bd3d2cd980178544197`
- `runtime/migrations/448_canonical_title_domains.sql`: `6d54953b152ea9414ecef1213bef9d708fe421d6c0139df0d6e95abf510efc9c`
- `runtime/migrations/455_title_instance_acquisition_price.sql`: `c0429bb6067fd5c8a0775618437f3c90934579611f51199fd06cfe19c8281b54`
- `runtime/src/title/maria-canonical-title-repository.ts`: `5e6b2251b35a0c10a84acda15d10b081b818118fd2ef8ba75f65903379006252`
- `runtime/src/site-web/user-shell.ts`: `ac5175c51ff0da97bf870eeb5316e4e8b6e39cfd36e3a696702510bfa6e00cbe`
- `runtime/src/site-web/user-shell-assets.ts`: `12287ff775c15d0c217d1c76fc9c01ffd811b92773a502df005daf246a599348`
- `runtime/src/app.ts`: `601618a26adf0749374ca50b2c4fe883701a9ad2685608ad5c3bedb866c22454`
- WBS799 Gate 1~6 source branch: `86dbf439ef68f0bf95e6403dbe9db271db4222a6`; checkpoint SHA-256 `7fbb3f66ba9de6db5c1da8f2e7a41093620be077d72f8a54e16e5dc17246086c`.
