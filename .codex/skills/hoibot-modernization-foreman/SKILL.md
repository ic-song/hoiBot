---
name: hoibot-modernization-foreman
description: Coordinate hoiBot bot migration, web portal work, and shared integration with incremental catalog changes, resource-scoped leases, stable owners, independent review, and eight-gate evidence. Use when the user says "작업반장", asks to run or redesign modernization in parallel, wants agents to avoid duplicate work, or asks whether the modernization rules should be improved.
---

# hoiBot 고도화 작업반장

고도화를 독립 작업흐름과 공유 자원으로 나누어 운영한다. 기존 Gate와 evidence는 보존하고, 실제로 겹치는 자원만 직렬화한다.

CONTROL·Lease·REPORT 쓰기, 상태 대사와 evidence 재사용 전 [조정 계약](references/coordination-contract.md)을 반드시 읽는다. 실행자와 공유하는 단일 계약이며 아래 요약보다 상세 판정에 우선한다.

## 시작 판단

1. `hoibot-modernization-wbs-runner`, 저장소 `AGENTS.md`, Git 상태와 현재 Codex 작업을 확인한다.
2. `슬라이스_보고수신`에서 최신 non-superseded CONTROL 한 행을 권위 checkpoint로 선택하고, PENDING 보고와 `슬라이스_선점`의 유효 Lease를 대사한다.
3. 원본 Git, DB, 테스트와 WBS evidence를 초기화하거나 근거 없이 낮추지 않는다.
4. 요청을 다음 workstream으로 분류한다.
   - `BOT_MIGRATION`: Rhino 명령과 JSON→DB 이관
   - `WEB_PORTAL`: 이용·운영 사이트의 기획, 기능, 설계와 구현
   - `SHARED_INTEGRATION`: 인증, API, DB, migration, dispatch, fixture, ledger처럼 두 흐름이 만나는 자원
5. 신규 작업이 기존 자원과 겹치는지 resource claim으로 판단한다. 다른 ACTIVE Lease가 있다는 사실만으로 차단하지 않는다.

## CONTROL 권위

- 최초 전체 카탈로그가 없을 때만 `phase=CLASSIFY`로 bootstrap한다.
- 동결 카탈로그가 있으면 `phase=EXECUTE`를 유지하고 신규·변경 범위만 catalog delta로 분류한다.
- CONTROL에는 최소한 `base_catalog_version`, `pending_deltas`, `active_lanes`, `active_leases`, `resource_lock_version`, `evidence_schema_versions`, `lane_workstreams`을 기록한다.
- 과거 CONTROL은 다음 CONTROL의 `supersedes=<row>`로 종료 이력을 남긴다. 과거 행에 `ACTIVE` 문자열이 남아 있다는 이유만으로 현재 CONTROL을 복수로 계산하지 않는다.
- 최신 non-superseded CONTROL이 없거나 둘 이상이면 신규 Lease와 canonical WBS 쓰기만 중단한다. 읽기 전용 조사, Git 확인과 복구 진단은 계속한다.
- `catalog_version`은 frozen mapping 내용, `delta_id`는 변경 제안, `evidence_schema_version`은 증거 파일 형식을 뜻한다. 세 값을 서로 대신 사용하지 않는다.
- 기존 runtime evidence의 `catalogVersion`과 `evidence_schema_version`은 바꾸지 않는다. delta 승인으로 새 catalog version이 생겨도 기존 evidence를 재라벨링하지 않는다. 새 범위는 별도 delta bundle을 쓰거나 해당 catalog를 지원하는 새 schema·validator를 함께 만든다.

## 절대 안전 규칙

- 명령 사용 상태 `사용`, `미사용 검토`, `미사용`을 임의로 변경하지 않는다.
- `미사용 검토`는 결정 backlog로 두고 구현하지 않는다.
- `미사용`은 Rhino source를 유지하고 분류·이관 진행률에서 제외한다.
- 운영 JSON, 운영 DB, 3306, 실운영방과 `feature/prod`를 작업자에게 허용하지 않는다.
- 검증된 Gate와 evidence를 삭제하거나 근거 없이 승계하지 않는다.
- 지정된 단일 작업반장 writer만 조정 계약의 FOREMAN_LEASE 또는 검증된 단일 writer fallback 아래 신규 Lease와 canonical REPORT를 append한다.
- 같은 쓰기 자원, migration 번호, 공용 dispatch, fixture loader, ledger/receipt 또는 DB 객체를 둘 이상에게 동시에 맡기지 않는다.
- mutation은 transaction, 멱등성, restart replay와 Shadow 근거를 유지한다.
- Gate 8은 별도 운영 준비와 승인 범위가 확인될 때만 진행한다.

## 카탈로그 운영

### 최초 bootstrap

동결 카탈로그가 없을 때 모든 `사용` CMD, 별칭, 자동 흐름과 최종 데이터 세트를 분류한다. 구현, schema, migration, fixture runtime과 시험 DB 변경은 금지한다.

다음 조건을 모두 충족해야 최초 `SC-YYYYMMDD-N`을 동결한다.

- `사용` CMD가 정확히 하나의 primary 슬라이스에 연결됨
- 미분류와 중복 primary mapping이 0건
- source 불일치와 `미사용 검토`가 결정 backlog로 분리됨
- 각 슬라이스의 DB, fixture, 검증 초안, 위험도와 provider dependency가 있음
- 기존 evidence가 해당 슬라이스와 연결되고 validator가 통과함

### 증분 delta

동결 후 새 명령, 명령 이동·분할·병합 또는 공유 계약 변경이 생기면 변경된 범위만 `SCD-YYYYMMDD-N`으로 검수한다.

- 영향을 받지 않는 슬라이스와 workstream은 계속 실행한다.
- primary mapping이나 공유 계약이 바뀌는 범위만 잠근다.
- 신규 웹 화면·문서·독립 웹 기능은 bot catalog를 재동결하지 않는다.
- bot 명령 mapping이 바뀌면 delta 승인 후 다음 catalog version을 발행한다.
- delta merge는 catalog 검수자 한 명이 canonical 행에 직렬 반영한다.
- evidence 형식과 validator 계약이 그대로이고 validator가 base+delta를 지원하면 별도 delta bundle을 쓴다. 형식 또는 validator 계약이 바뀔 때만 새 evidence schema를 만든다.

## 웹사이트 workstream

`WEB_PORTAL`은 별도 사이트 WBS에서 다음 순서로 진행한다.

```text
기획서 → 기능 정의서 → 기존 고도화 대조 → 설계 → WBS 동결 → 구현·검증
```

- 각 기능에는 한 명의 책임 소유자와 파일 소유권을 둔다.
- 웹 기획·화면·독립 파일은 `BOT_MIGRATION` Lease와 병행할 수 있다.
- 인증, API, 같은 DB 객체나 공용 runtime에 닿는 시점에 `SHARED_INTEGRATION` claim을 만들고 dependency를 연결한다.
- bot 슬라이스 Gate와 웹 5단계 WBS의 퍼센티지를 합산하지 않는다.
- 구현 claim 전 import, build 설정, route, API/data contract와 shared entrypoint를 확인해 직접·간접 자원을 manifest에 포함한다. 의존성이 미확인이면 read-only로 제한하거나 넓은 보수적 claim을 사용한다.

## resource claim

기존 `슬라이스_선점` A:N을 유지한다.

- C `작업 레인`: CONTROL에 등록된 lane ID (`BOT_*`, `OBJECT_*`, `WEB_*`, `SHARED_*` 등); workstream은 명시적 매핑으로 판정
- M `체크포인트`: manifest와 evidence 위치
- N `비고`: `resources=<mode>:<type>:<key>,...`

예: `resources=W:FILE:hoibot/admin/app.ts,R:DB:hoibot/catalog.item,W:PROVIDER:hoibot/ledger-receipt`

`mode`는 `R` 또는 `W`, `type`은 `FILE`, `DIR`, `SCRIPT`, `TEST`, `FIXTURE`, `EVIDENCE`, `DELTA`, `CONTRACT`, `DB`, `MIGRATION`, `ROUTE`, `PROVIDER`, `LEDGER`, `RECEIPT`, `WBS`를 사용한다. 논리 type의 실제 파일·DB 매핑과 type 간 충돌은 조정 계약을 따른다.

- 같은 정규화 key에서 둘 다 R이면 병행한다.
- 같은 key에서 하나라도 W이면 직렬화한다.
- 디렉터리와 그 하위 파일, 중앙 shell entrypoint와 해당 route처럼 포함 관계인 key도 충돌로 본다.
- key 앞에는 등록된 repository ID를 붙인다. FILE key는 `<repo>/<상대경로>`, `/` 구분자, `./` 제거와 Windows 대소문자 무시로 정규화한다. `..`와 절대경로 key를 금지한다.
- migration 번호와 provider 승격은 항상 W로 본다.
- 읽기 전용 조사와 기획은 source·시험 DB·canonical WBS를 쓰지 않는 한 실행 Lease 없이 진행할 수 있다.
- claim이 넓거나 모호하면 발급 전에 파일·DB·route 단위로 좁힌다.

## Lease 발급과 용량

1. 조정 writer 소유권을 검증한 뒤 dependency, 유효 예약·ACTIVE Lease와 resource claim의 R/W 충돌을 확인한다.
2. append 전에 대상 탭의 `rowCount`와 마지막 사용 행을 확인하고 빈 행을 최소 100개 확보한다.
3. 여유가 부족하면 작업반장만 행을 확장한다. `슬라이스_선점`을 확장할 수 없고 REPORT 탭에는 여유가 있으면 `용량 차단` REPORT를 append하고 Lease를 발급하지 않는다.
4. 실행 ID, branch, worktree, lane과 resource claim을 append한다.
5. 도구가 반환한 실제 append 행과 같은 슬라이스의 유효 ACTIVE claim을 재읽어 소유권을 확인한다.
6. 작업자는 claim A:N과 WBS 실행 ID가 일치할 때만 쓰기를 시작한다.
7. Heartbeat에는 현재 task, branch/worktree, checkpoint와 만료 기준을 남긴다. 만료 처리는 재읽기와 task 상태 확인 후 작업반장만 수행한다.

고정 행 예약, 다음 빈 행 추정과 동시 fixed-range 쓰기를 금지한다. `슬라이스_선점`과 `슬라이스_보고수신` 모두 같은 용량 사전 점검을 적용한다.

`슬라이스_보고수신` 자체가 가득 차고 확장할 수 없으면 REPORT append를 시도하지 않는다. task-scoped checkpoint에 `EMERGENCY_WBS_CAPACITY_BLOCK`과 실행 ID, 마지막 확인 행, Git 상태와 다음 행동을 남기고 작업반장 task에 직접 알린다. 용량 복구 후 작업반장이 이를 REPORT로 옮겨 ACK한다.

## 역할과 모델

| 역할 | 기본 모델 | 사용 범위 |
| --- | --- | --- |
| 작업반장·구조 설계 | GPT-5.6 Sol / High | catalog delta, resource 충돌, 인증·DB 계약, Gate 7 승인 |
| 기능 책임 소유자 | GPT-5.6 Terra / Medium | 독립 슬라이스·웹 기능 구현과 증거 정리 |
| 조사·문서·현황 | GPT-5.6 Luna / Medium | read-only 조사, WBS 문서와 상태 동기화 |
| 고위험 독립 검수 | GPT-5.6 Sol / High | mutation, 공유 provider, 통합 기준선, 보안 검수 |

- 기능마다 책임 소유자 한 명을 유지한다.
- 전문 작업자는 별도 resource sub-claim으로 독립 부분만 맡고 Gate를 단독 확정하지 않는다.
- 저위험 교차 검수는 Terra / Medium, 인증·mutation·공용 계약은 Sol / High를 사용한다.
- 책임 소유자 변경은 검증된 Gate 경계에서 checkpoint와 작업반장 ACK를 거친다. Gate 도중 인계하면 진행 중 Gate는 FALSE로 두고 완료된 원자 evidence만 checkpoint해 새 소유자가 그 Gate를 다시 확정한다.
- 인계는 이전 claim 재읽기 → 이전 Lease를 `RELEASED` 또는 `REVOKED`로 종료 → 종료 상태 사후 재읽기 → 새 Lease append → 새 소유자의 단독 ACTIVE 재읽기 순서로 수행한다. 이전 Lease가 ACTIVE인 동안 동일 W claim의 새 Lease를 발급하지 않는다.

## 검증 비용 등급

Gate 1~8 열과 진행률 수식은 유지한다. 등급은 Gate 수를 줄이지 않고 필요한 evidence 깊이만 조절한다.

`execution_profile`은 Gate별 필수 근거를, `validation_tier`는 변경 영향에 따른 검증 실행량을 정한다. profile은 `READ_UI`, `STANDARD_CONSUMER`, `MUTATION_TRANSACTIONAL`, `SHARED_PROVIDER`, `DATA_MIGRATION`, `OPERATIONS` 중 하나를 사용한다.

- `T0`: 기획·문서·WBS. 링크, 일관성, 중복과 승인 조건을 검증한다.
- `T1`: 독립 UI·조회·작은 기능. focused test, build, 접근성·오류 UI와 계약 fixture를 검증한다.
- `T2`: DB mutation·공용 provider. transaction, 멱등성, restart, migration, 소비자 parity와 Shadow를 검증한다.
- `T3`: 통합 기준선·운영 준비. 전체 회귀, backup/restore, cutover와 rollback을 검증한다.

조정 계약의 commit SHA, 입력·schema·fixture hash, 실행 환경과 결과 digest를 모두 검증한 evidence만 재사용한다. 공용 계약 승격, 통합 후보 변경, 실패 또는 영향 범위 불명확 때만 전체 회귀를 다시 수행한다.

순수 문서·workflow인 T0는 bot Gate 분모 밖에서 관리한다. 실행 슬라이스에 포함된 문서 변경은 해당 profile의 Gate evidence로 연결한다.

## Gate와 기록

`BOT_MIGRATION`은 기존 Gate 1~8을 유지한다: 현행 조사, DB 매핑, 합성데이터, 구현, 통합, parity, Shadow, 운영 준비.

- Gate 시작 때 모든 탭을 쓰지 않는다. 필요한 행을 재읽고 작업한다.
- Gate 완료나 resource boundary 변경 때 변경된 WBS·mapping·검증 행만 쓰고 사후 재읽기한다.
- Heartbeat는 claim 행만 갱신한다.
- Gate 7 검수자는 현재·이전 책임 소유자와 검수 대상 구현·evidence 작성자를 제외한다. 이전 소유자는 사실을 제공할 수 있지만 ACK하지 않는다.
- Gate 7 ACK 후 소비자는 `RELEASED`, provider는 `INTEGRATED`로 종료한다.

## 보고 사건

REPORT의 사건과 requested action을 먼저 분리하고, 처리 상태는 조정 계약을 따른다. REPORT는 `bootstrap 완료`, `delta 검수 요청`, `공용 변경 요청`, `resource 충돌`, `용량 차단`, `인계`, `Gate7 완료`에만 사용한다. 정상 Gate 1~6과 Heartbeat는 보고하지 않는다.

작업자는 사건 직전 최신 CONTROL을 읽고 관련 원장을 먼저 갱신한다. 작업반장은 지정 REPORT, claim, 변경 행, Git과 provider 근거만 읽어 같은 회차에 ACKED 또는 REJECTED와 다음 행동을 기록한다.

## 사용자 보고

- base catalog version과 pending delta
- BOT, WEB, SHARED workstream별 상태
- 작업자별 책임 기능, Gate 또는 웹 WBS 단계
- ACTIVE resource claim과 실제 충돌
- provider, Gate 7 승인과 Gate 8 위험
- 운영 데이터와 `feature/prod` 불변 여부

대시보드는 현재 `SL-*` 행의 G:N을 기준으로 계산한다. catalog·delta staging을 Gate 분모에 넣지 않고, O열 값이 혼재하면 G:N을 권위로 검산한 뒤 별도 schema migration에서 정리한다.

Notion에는 검증된 WBS 링크와 퍼센티지만 동기화한다. 상세 내역, claim과 evidence는 Google Sheets에 둔다.
