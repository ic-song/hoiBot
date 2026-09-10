# WBS801 Wave34 잔여 후보 감사 체크포인트

- 실행: `WBS801-CANDIDATE-AUDIT-20260910`
- Lease: `Lease2672` (`BOT_MIGRATION`, read-only audit)
- 기준 commit: `3af9d4dae4cb850cc5c0ed1f39425a7ddb73b3dd`
- branch: `codex/object-db-wave34-residual-candidate-audit-v1-20260910`
- catalog/delta: `SC-20260902-1` + proposed `SCD-OBJ-20260910-34`
- execution profile / tier: `MUTATION_TRANSACTIONAL` / `T2`
- 운영 데이터·운영 DB·3306·`feature/prod`·Gate 8: 변경하지 않음

## 선택 결과

다음 WBS801 실행 후보는 `SL-MEMBER-TITLE-LEGACY-SELECT-PARITY-01`로 고정한다.

| consumer | source | frozen/effective classification | 현재 verdict | interface owner |
|---|---|---|---|---|
| `legacy-9cd62419b853c929` | `main.js:17077`의 `/타이틀 [번호]` | `READ_WRITE` / `MUTATION` | `STATIC_ONLY`, `C_DIRECT_EXECUTION` | `member-title.legacy-command.67bb6a613d19` |
| `runtime-dispatch-d9a426f3b9d18d3a` | `app.ts`의 `handlerKey=player_title_select` | `READ_WRITE` / `MUTATION` | `STATIC_ONLY`, `C_DIRECT_EXECUTION` | `member-title.player-title-select.execute` |

두 ID는 id registry에서 `ACTIVE`다. Wave33의 `SCD-OBJ-20260910-33`은 `legacy-bda1428003a5b522` 한 건만 보정하므로 위 두 소비자의 effective classification은 frozen manifest와 같다. Wave34 delta는 access class를 바꾸지 않고 두 소비자의 실행 묶음, 공성전 read dependency, 증거 경로를 결합하는 compatible dependency/scope binding으로 만든다. 기존 frozen manifest와 기존 evidence의 catalog/schema 표기는 바꾸지 않는다.

이 묶음은 MEMBER-TITLE 잔여 16건의 연속 작업이고, 레거시 명령과 이미 연결된 runtime dispatch/service를 한 번에 검증한다. gift는 ticket stack·definition grant가 추가되고, sell은 단일/범위 판매와 currency participant가 함께 필요하므로 select 두 건보다 범위가 크다.

## 레거시 현행 계약

`main.js:17077-17101`을 기준으로 확인했다.

- trigger: `msg.startsWith("/타이틀 ")`
- 공성전: `castleSiegeFlag`가 참이면 reply와 저장 없이 즉시 반환한다.
- parse: `/^\/타이틀\s+(\d+)\s*$/`; 양의 보유 목록 번호를 사용한다.
- actor/authorization: 별도 관리자·방 guard가 없다. `data.member[sender]`가 없으면 `${sender}는(은) 존재하지 않는 사용자입니다.`를 응답한다.
- success: `member_title.json`의 `title.num`을 선택 번호로 바꾸고 `saveJsonFile`로 저장한다.
- success reply: `[${checkRank(...)}] 님의 타이틀이\n[${title.name}] (으)로 적용되었습니다.`
- boundary replies: 존재하지 않는 번호는 `해당 번호의 타이틀이 존재하지 않습니다.`, 형식 오류는 `올바른 타이틀 설정 명령어 형식을 사용해주세요. 예: /타이틀 [번호]`다.
- source span SHA-256 in frozen manifest: `122c4ea1db48aa686e2a12ef5bc73c87942166851609601038bf202b471cbc2b`

## 런타임 연결과 트랜잭션

- ingress/dispatch: `app.ts`가 후보를 `/타이틀`로 정규화하고 `player_title_select` handler에서 `PlayerTitleSelectService.select()`를 호출한다.
- registry/migration: `233_player_title_select.sql`이 `PLAYER_TITLE_SELECT`, handler `player_title_select`, auth scope `VERIFIED_USER`, `/타이틀` alias를 등록한다.
- service: `player-title-select-service.ts`는 하나의 `withTransaction`에서 actor를 잠그고 operation을 claim한 뒤 `lockPlayerTitleOwnedProjection()`으로 고정 display order를 잠근다.
- business mutation: `player_title_instances.equipped`와 `player_titles.equipped`를 갱신한다.
- receipts: 같은 transaction에서 `operations`, `command_executions`, `command_audit`, `outbox_messages`를 기록한다.
- frozen target contract: `canonical_member_title_definitions`, `canonical_member_title_selections`, `canonical_owned_member_title_instances`, `canonical_players`와 연관 read projections. participant는 `member-title.ownership.mutate`, receipt table은 `canonical_member_title_operations`다.
- 정상·번호 없음·형식 오류·회원 없음 reply는 레거시 문구와 일치한다. 정상 선택 output은 기존 MariaDB test가 정확히 고정한다.

## 확인된 구현·증거 gap

### P1: 공성전 중 mutation/reply 차단 누락

레거시는 mutation보다 먼저 `castleSiegeFlag`를 검사한다. 런타임 select service에는 `guild_territory_wars.active=TRUE` 조회가 없어 공성전 중에도 operation claim, title 변경, receipt/outbox 기록과 reply가 진행된다. Wave32 read service가 사용하는 선행 `SELECT id FROM guild_territory_wars WHERE active=TRUE ORDER BY id LIMIT 1 FOR UPDATE` 패턴을 같은 transaction의 첫 query로 적용하고, active row가 있으면 `null`을 반환해야 한다. app handler도 nullable result일 때 reply를 추가하지 않아야 한다.

### P1: payload drift fail-closed 누락

`player-title-select-service.ts:48-89`는 scope를 actor로, idempotency key를 eventId로만 만들고, 저장된 `result_json`이 있으면 `input.message`를 parse하기 전에 반환한다. 따라서 같은 eventId의 `/타이틀 1` 이후 `/타이틀 2` 요청은 다른 payload임에도 첫 결과를 재생한다. 정규화한 선택 번호와 command identity를 SHA-256으로 저장한 versioned result envelope가 필요하다. 동일 payload는 business DML 0으로 replay하고, index 또는 command identity가 달라지거나 과거 raw 결과라 비교할 수 없으면 `PLAYER_TITLE_SELECT_PAYLOAD_DRIFT`로 rollback해야 한다.

### P1: 숫자 경계 output 불일치

레거시 정규식은 `\d+`이므로 `/타이틀 0`과 매우 큰 digit 문자열도 형식에는 맞고, 보유 배열에서 찾지 못해 `해당 번호의 타이틀이 존재하지 않습니다.`를 응답한다. 현재 runtime parser는 `index > 0`과 safe integer를 요구해 두 입력을 `invalid_format`으로 바꾼다. 기존 unit test도 `/타이틀 0`과 safe integer 초과를 invalid로 고정하고 있어 레거시 parity와 반대다. 숫자 문자열 형식과 실제 보유 index 존재 여부를 분리하고, 이 경계를 legacy actual target과 runtime actual invocation으로 고정해야 한다.

### P1: 필수 실행 증거 부족

현재 `player-title-select.test.ts`의 parser/normalizer 3건은 실제 실행에서 `3/3 PASS`했다. 기존 MariaDB test는 success, duplicate, audit failure rollback, SHADOW, reconnect를 다루지만 다음 strict receipt 근거가 없다.

- `PAYLOAD_DRIFT_FAIL_CLOSED`
- `CONCURRENCY_SINGLE_WRITER`
- 공성전 중 무응답·business DML 0
- zero/overflow digit의 `title_not_found` output parity
- 소비자별 독립 harness case / invocation / receipt

`AUTH_DENIED`와 `WRONG_ROOM_REJECTED`는 두 frozen ledger entry 모두 각각 `SOURCE_CLASSIFICATION_HAS_NO_AUTH_GUARD_V1`, `SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1`로 N/A다.

## successor Lease 제안

다음 책임 소유자에게 아래 단독 W claim을 발급한다. WEB Lease2671의 관리자 web-shell 파일·테스트·review evidence와 겹치지 않는다.

### W

- `FILE:hoibot/개발환경_고도화/runtime/src/player/player-title-select-service.ts`
- `FILE:hoibot/개발환경_고도화/runtime/src/app.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/player-title-select.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/object-db-consumer-executable-parity-wave34.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/object-db-consumer-executable-parity-wave34-blocker.test.ts`
- `FILE:hoibot/개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave34-member-title-select-target.mjs`
- `FILE:hoibot/개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-34.v1.json`
- `FILE:hoibot/개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-34.v1.schema.json`
- `FILE:hoibot/개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave34-member-title-select-v1.json`
- `FILE:hoibot/개발환경_고도화/migration-control/contracts/object-db-consumer-mutation-evidence-wave34.v1.schema.json`
- `FILE:hoibot/개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave34-v1.json`
- `FILE:hoibot/개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json`
- `FILE:hoibot/개발환경_고도화/migration-control/contracts/object-db-consumer-residual-work-plan.v1.json`
- Wave34 전용 build/validate script 및 evidence directory
- 기존 SCD-aware ledger/residual build·validator의 Wave34 입력과 누적 기대값 변경이 실제로 필요할 때 해당 파일만 추가 W claim

### R

- `main.js`
- `개발환경_고도화/runtime/src/player/player-title-owned-projection.ts`
- `개발환경_고도화/runtime/migrations/233_player_title_select.sql`
- 기존 player title select unit/MariaDB tests
- frozen manifest, id registry, transition contract, ledger/residual과 Wave30~33 evidence

DB/migration/provider route를 새로 만들 필요는 없다. synthetic isolated MariaDB만 사용하고 운영 DB·운영 데이터·3306은 금지한다.

## 필수 시나리오와 예상 누적 변화

각 consumer에 다음 6개 required scenario를 독립 receipt로 만든다.

1. `MUTATION_SUCCESS`
2. `DOMAIN_FAILURE_ROLLBACK`
3. `DUPLICATE_REPLAY_DML_ZERO`
4. `PAYLOAD_DRIFT_FAIL_CLOSED`
5. `RESTART_REPLAY`
6. `CONCURRENCY_SINGLE_WRITER`

공성전 무응답은 별도 parity probe로 두 consumer의 reply·business DML 0을 고정한다. AUTH와 wrong room은 위 N/A 사유를 유지한다.

- receipts: `401 + 12 = 413`
- DIRECT: `57 + 2 = 59`
- EQUIVALENT: `12` 유지
- proven: `69 + 2 = 71`
- residual: `1,064 - 2 = 1,062`
- category: `C_DIRECT_EXECUTION 982 → 980`, `D_PREREQUISITE 82` 유지
- MEMBER-TITLE residual: `16 → 14`

수치는 두 소비자의 actual invocation, strict AJV, deterministic rebuild, cumulative prefix 보존, 독립 Gate 7 GO가 모두 통과한 뒤에만 확정한다.

## 입력 봉인

| file | bytes | SHA-256 |
|---|---:|---|
| manifest | 8,457,693 | `f575bff8d417bd8babb54d9cb4193498f839e3d98cbc988b90e5f7f395428e2a` |
| id registry | 274,294 | `8c541d74ca60be939848a5ed088f6077434e24d88edcf7ec6eec6abe70a2a7fd` |
| ledger | 5,149,277 | `830d59dfe6681a189d4b7bb788e3eff21e0dca7405eeac90c8a688fb1ac0dd10` |
| residual | 5,088,581 | `c803d4321d725791646a1133ae87ca9797e4da2e5ff4c192b51484630593fd3f` |
| receipt401 | 2,081,171 | `8fd118c56fb99c9d5eef5ce10b05f3b5fb0e99e0dd66a0950dc596f413c5db8b` |

현재 ledger summary는 총 1,133, DIRECT 57, EQUIVALENT 12, STATIC_ONLY 982, BLOCKED_DYNAMIC 82다. residual summary는 1,064(`C=982`, `D=82`), MEMBER-TITLE 16이다.

## 감사 검증

- branch/base/clean: exact base에서 시작, 감사 전 clean
- focused parser/normalizer: `node --import tsx --test test/player-title-select.test.ts` → `3/3 PASS`
- broad `npm test -- --test-name-pattern ...` 호출은 npm script가 전체 glob을 로드했고 이 worktree의 dependency tree에 `@paralleldrive/cuid2`가 없어 다수 unrelated module-load failure가 발생했다. 후보 판정 근거로 사용하지 않는다.
- 정적 transaction/order audit: P1 두 건 확인
- source/tests/contracts/fixtures/ledger/residual/Sheets: 수정 없음
