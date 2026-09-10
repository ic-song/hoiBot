---
name: hoibot-modernization-wbs-runner
description: Run one assigned hoiBot bot-migration, web-portal, or shared-integration work item with incremental catalog deltas, resource-scoped leases, stable ownership, eight-gate evidence, recovery, handoff, and dashboard synchronization. Use for 고도화 진행, 이어서 진행, 통합, 인계, 복구, 현황 갱신, or parallel website work tied to modernization.
---

# hoiBot 고도화 실행

동결된 성과를 유지하면서 배정 범위만 진행한다. ACTIVE Lease의 개수가 아니라 resource claim의 실제 충돌로 병행 여부를 판단한다.

## 고정 리소스

- Google Drive `hoi`: `https://drive.google.com/drive/folders/1wcM4C3GZ0G8NSwXFJ1U0sq_s0FxWlB08`
- 봇 슬라이스 WBS: `https://docs.google.com/spreadsheets/d/1tlvrlQ1dGb2ijRc6kDKEBRkSdLjQyhc1u9OfiJES3Ps/edit`
- 이용·운영 사이트 WBS: `https://docs.google.com/spreadsheets/d/1r0mkJL43iWndCi0CHKI4RLU5oE6keEWtRBtEpWLNfmU/edit`
- Notion 퍼센티지: `https://app.notion.com/p/3bb393bdd7aa81e38bb9ea8d773a8caf?pvs=204`

봇 WBS의 권위 탭은 `슬라이스_대시보드`, `슬라이스_WBS`, `슬라이스_명령매핑`, `슬라이스_DB매핑`, `슬라이스_검증`, `슬라이스_선점`, `슬라이스_보고수신`, `고도화_보완기준`이다. `명령어_이관`은 명령 카탈로그와 사용 상태만 관리한다.

웹 WBS의 권위 탭은 `기획서`, `기능_정의서`, `기존_고도화_대조`, `설계`, `구축_WBS`, `협업_규칙`, `에이전트_할당`, `통합_기준선`, `파일_소유권`, `실행_현황`이다.

상세 작업과 evidence는 Sheets에, Notion에는 검증된 WBS 링크와 퍼센티지만 둔다.

CONTROL·Lease를 대사하거나 WBS 쓰기·evidence 재사용을 하기 전 [공유 조정 계약](../hoibot-modernization-foreman/references/coordination-contract.md)을 반드시 읽는다. 작업반장 패키지와 함께 배포하며, 계약을 읽을 수 없으면 해당 쓰기를 보류한다.

## 작업 모드

1. `BOOTSTRAP`: 최초 frozen catalog가 없을 때 전체 `사용` CMD를 분류한다.
2. `DELTA`: frozen catalog 이후 새 명령·mapping·공유 계약의 변경분만 분류한다.
3. `BOT_MIGRATION`: 배정 슬라이스를 Gate 1~7까지 실행한다.
4. `WEB_PORTAL`: 별도 웹 WBS를 기획부터 동결·구현까지 실행한다.
5. `SHARED_INTEGRATION`: API, 인증, DB, migration과 provider 접점을 직렬 통합한다.

작업 모드가 불명확하면 요청 산출물과 resource claim으로 가장 좁은 모드를 선택한다.

## 사용 상태와 기존 성과

- `사용`: 분류·실행 대상
- `미사용 검토`: 결정 backlog, 구현 금지
- `미사용`: Rhino source 유지, 분류·진행률 제외

작업자는 상태를 변경하지 않는다. Git, DB, 테스트와 검증된 Gate evidence를 보존하고 확인되지 않은 Gate는 승계하지 않는다.

## CONTROL 읽기

`슬라이스_보고수신`에서 최신 non-superseded CONTROL 한 행을 권위로 사용한다.

```text
base_catalog_version=SC-YYYYMMDD-N
pending_deltas=SCD-...
active_lanes=<등록된 lane ID 목록>
lane_workstreams=<lane ID와 workstream의 명시적 매핑>
active_leases=n
resource_lock_version=...
evidence_schema_versions=<지원 schema ID 목록>
supersedes=row...
```

- 과거 행에 `ACTIVE`가 남아 있어도 최신 CONTROL이 명시적으로 supersede하면 현재 충돌로 세지 않는다.
- 최신 권위 CONTROL이 없거나 둘 이상이면 신규 Lease와 canonical WBS 쓰기만 중단한다.
- 읽기 전용 조사, Git 확인과 복구 진단은 계속한다.
- `catalog_version`은 frozen mapping 내용, `delta_id`는 변경 제안, `evidence_schema_version`은 증거 파일 형식이다. 세 값을 서로 대신 사용하지 않는다.
- 기존 runtime evidence의 `catalogVersion`과 schema version을 덮어쓰거나 재라벨링하지 않는다.

## BOOTSTRAP과 DELTA

### BOOTSTRAP

최초에만 모든 `사용` CMD, 별칭, 자동 흐름, 최종 데이터, DB·fixture·검증 초안과 provider dependency를 분류한다. 구현과 시험 DB 변경은 금지한다.

mapped=total, unmapped=0, duplicate primary=0, orphan=0, 충돌=0과 validator 통과 후 `SC-YYYYMMDD-N`을 동결한다.

### DELTA

동결 후 변경 범위만 `SCD-YYYYMMDD-N` manifest에 기록한다.

- `base_catalog_version`을 함께 기록한다.
- `evidence_schema_version`을 별도로 기록한다.
- 영향을 받는 CMD, 슬라이스, shared contract와 resource를 명시한다.
- 다른 lane은 계속 실행한다.
- primary mapping 또는 shared contract가 바뀔 때만 catalog 검수자가 canonical merge와 새 catalog version을 승인한다.
- 신규 웹 기능이 bot command mapping을 바꾸지 않으면 bot catalog를 재동결하지 않는다.
- 새 catalog version은 mapping snapshot에만 적용한다. 증거 형식이 같아도 exact catalog const가 다른 기존 파일은 수정하지 않고 별도 delta bundle 또는 해당 catalog를 지원하는 새 schema·validator를 사용한다.
- evidence 형식과 validator 계약이 그대로이고 validator가 base+delta를 지원하면 delta bundle을 쓴다. 형식 또는 validator 계약이 바뀔 때만 새 evidence schema를 만든다.

분류 결과는 지정 staging 또는 task-scoped manifest에 기록하고 canonical merge는 한 명이 직렬 수행한다.

## WEB_PORTAL

웹사이트는 다음 순서를 지킨다.

```text
기획서 → 기능 정의서 → 기존 고도화 대조 → 설계 → WBS 동결 → 구현·검증
```

1. `기획서`에서 대상 사용자, 운영 목적, 범위, 정책과 성공 조건을 확정한다.
2. `기능_정의서`에서 회원가입, 로그인, 권한, 운영 기능, 예외와 수용 조건을 기능 ID로 관리한다.
3. `기존_고도화_대조`에서 봇 명령·DB·API와 연결, 재사용, 충돌, 미정 항목을 기록한다.
4. `설계`에서 화면, 사용자 흐름, API/data contract, 보안과 오류 처리를 확정한다.
5. `구축_WBS`를 동결하고 기능 책임자, 파일 소유권, dependency, 검수자와 완료 조건을 배정한다.
6. 서로 다른 파일과 resource를 가진 기능을 병행한다.

웹 기획·화면·독립 파일은 bot Lease와 병행한다. 인증, 같은 DB 객체, 공용 API/runtime에 닿으면 `SHARED_INTEGRATION` claim을 먼저 받는다.

구현 claim 전 import, build 설정, route, API/data contract와 shared entrypoint를 확인하고 직접·간접 자원을 manifest에 넣는다. 의존성이 미확인이면 read-only로 제한하거나 넓은 보수적 claim을 사용한다.

## resource-scoped Lease

기존 `슬라이스_선점` A:N 형식을 유지한다.

```text
C lane=<CONTROL 등록 ID; OBJECT_* 등 legacy ID 보존>
M checkpoint=<manifest/evidence>
N resources=<mode>:<type>:<key>,...
```

예: `resources=W:FILE:hoibot/admin/app.ts,R:DB:hoibot/catalog.item,W:PROVIDER:hoibot/ledger-receipt`

- `mode`: `R` 또는 `W`
- `type`: `FILE`, `DIR`, `SCRIPT`, `TEST`, `FIXTURE`, `EVIDENCE`, `DELTA`, `CONTRACT`, `DB`, `MIGRATION`, `ROUTE`, `PROVIDER`, `LEDGER`, `RECEIPT`, `WBS`. 논리·물리 자원 매핑과 type 간 충돌은 공유 조정 계약을 따른다.
- 같은 key의 R/R은 병행하고, 하나라도 W이면 직렬화한다.
- 디렉터리와 하위 파일, 중앙 shell entrypoint와 해당 route처럼 포함 관계인 key도 충돌한다.
- key 앞에는 등록된 repository ID를 붙인다. FILE key는 `<repo>/<상대경로>`, `/` 구분자, `./` 제거와 Windows 대소문자 무시로 정규화한다. `..`와 절대경로 key를 금지한다.
- migration 번호와 provider 승격은 W 전용이다.
- 같은 슬라이스라도 독립 전문 작업은 별도 sub-claim으로 범위를 제한한다.
- 읽기 전용 조사·기획은 canonical WBS와 source를 쓰지 않으면 Lease 없이 할 수 있다.

지정된 단일 작업반장 writer만 신규 Lease와 canonical REPORT를 append한다. 작업자는 보고 요청을 task-scoped staging 또는 지정 작업반장 task에 전달하며 canonical REPORT를 직접 append하지 않는다. 자신의 claim Heartbeat와 배정된 WBS 행 변경은 기존 자원 권한 범위에서만 수행한다. 상태 전이는 공유 조정 계약을 따르며 REVIEW·CORRECT·HANDOFF_READY를 Lease 해제로 해석하지 않는다. 작업자는 고정 행 번호나 다음 빈 행을 추정하지 않는다.

### append 용량 사전 점검

1. `슬라이스_선점` 또는 `슬라이스_보고수신`의 `rowCount`와 마지막 사용 행을 읽고 빈 행을 최소 100개 확보한다.
2. 여유가 부족하면 작업반장만 행을 확장한다.
3. `슬라이스_선점`을 확장할 수 없고 `슬라이스_보고수신`에는 여유가 있으면 작업반장이 `용량 차단` REPORT를 append하고 Lease를 발급하지 않는다.
4. append 결과가 반환한 실제 행을 사용한다.
5. 해당 행과 같은 슬라이스의 유효 ACTIVE claim을 재읽어 단독 쓰기 권한을 확인한다.

`슬라이스_보고수신`이 가득 차고 확장도 불가능하면 그 탭에 REPORT를 쓰지 않는다. task-scoped checkpoint에 `EMERGENCY_WBS_CAPACITY_BLOCK`, 실행 ID, 마지막 확인 행, Git 상태와 다음 행동을 기록하고 작업반장 task에 직접 알린다. 복구 후 작업반장이 REPORT로 옮겨 ACK한다.

## BOT_MIGRATION Gate

`슬라이스_WBS` A:X와 Gate G:N, `COUNTIF(G:N,TRUE)/8` 진행률을 그대로 유지한다.

1. 현행 조사
2. DB 매핑
3. 합성데이터
4. 구현
5. 통합
6. parity
7. Shadow
8. 운영 준비

분류 카탈로그는 Gate evidence가 아니다. 현재 source를 재확인하고 새 Gate는 FALSE에서 시작한다. 기존 Gate는 실제 Git·DB·테스트 evidence가 있을 때만 유지한다.

### 검증 비용 등급

Gate 수와 의미는 바꾸지 않고 evidence 깊이만 조절한다.

`execution_profile`은 `READ_UI`, `STANDARD_CONSUMER`, `MUTATION_TRANSACTIONAL`, `SHARED_PROVIDER`, `DATA_MIGRATION`, `OPERATIONS` 중 하나이며 Gate별 필수 근거를 정한다. `validation_tier` T0~T3는 변경 영향에 따른 검증 실행량을 정한다.

| execution_profile | Gate 2·3 핵심 근거 | Gate 6·7 핵심 근거 |
| --- | --- | --- |
| `READ_UI` | API·RBAC·read-model 계약, 계약 fixture | 기능·접근성·오류 UI, staging 또는 동등 replay |
| `STANDARD_CONSUMER` | 저장·API 매핑, 정상·경계·실패 fixture | 기존 결과 parity, restart와 representative Shadow |
| `MUTATION_TRANSACTIONAL` | table·key·transaction, 중복·restart fixture | atomicity·멱등성·replay, 실제 Shadow |
| `SHARED_PROVIDER` | versioned contract·소비자 목록, 호환 fixture | 소비자 matrix와 영향 회귀, 대표 소비자 Shadow |
| `DATA_MIGRATION` | schema·checksum·rollback, 비식별 dataset | dry-run·재실행·대사, staging rehearsal |
| `OPERATIONS` | 권한·runbook·복구 조건, 실패 drill | backup/restore·cutover·rollback, 승인 smoke |

Gate 1 현행 조사, Gate 4 구현과 Gate 5 통합은 모든 실행 profile에 공통이다.

- `T0` 기획·문서·WBS: 링크, 일관성, 중복, 승인 조건
- `T1` 독립 UI·조회·작은 기능: focused test, build, 계약 fixture, 접근성·오류 UI
- `T2` mutation·shared provider: transaction, 멱등성, restart, migration, parity, Shadow
- `T3` 통합 기준선·운영 준비: 전체 회귀, backup/restore, cutover, rollback

공유 조정 계약의 commit SHA, 입력·schema·fixture hash, 실행 환경과 결과 digest를 모두 검증한 evidence만 재사용한다. 공용 계약 승격, 통합 후보 변경, 실패 또는 영향 범위 불명확 때 전체 회귀를 수행한다. N/A인 검증도 사유와 근거를 남겨야 Gate를 TRUE로 둘 수 있다.

순수 문서·workflow인 T0는 bot Gate 분모 밖에서 관리한다. 실행 슬라이스에 포함된 문서 변경은 해당 profile의 Gate evidence로 연결한다.

### 실행과 기록

```text
source·자동 흐름 재검증
→ DB 계약·transaction 확정
→ 비식별 합성 fixture
→ 최소 범위 구현
→ provider dependency 통합
→ risk profile 검증
→ Shadow
→ evidence·checkpoint·Sheets
→ commit·push
```

- 명령 조사: `hoibot-command-navigator`
- 저장·데이터: `hoibot-save-flow-guard`
- Rhino 코드: `hoibot-rhino-js-review`
- 운영 `data/*`, 운영 DB, 3306와 실운영방 사용 금지

Gate 시작 때 모든 탭을 갱신하지 않는다. Gate 완료나 resource boundary 변경 때 변경된 WBS·mapping·검증 행만 재읽기→쓰기→사후 재읽기한다. Heartbeat는 claim 행만 갱신한다.

## 소유권·검수·인계

- 기능마다 책임 소유자 한 명을 유지한다.
- 전문 작업자는 별도 resource sub-claim에서 조사·구현·검수 일부를 맡을 수 있다.
- 책임 소유자는 Gate 근거와 기록, 최종 통합을 정리한다. Gate 7은 독립 검수와 작업반장 ACK 이후에만 확정하며 Gate 8은 별도 운영 승인 범위를 따른다.
- Gate 7 검수자는 현재·이전 책임 소유자와 검수 대상 구현·evidence 작성자를 제외한다. 이전 소유자는 사실을 제공할 수 있지만 ACK하지 않는다.
- 책임 소유자 변경은 Gate 경계에서 checkpoint와 작업반장 ACK 후 수행한다. Gate 도중 인계하면 진행 중 Gate는 FALSE로 두고 완료된 원자 evidence만 넘겨 새 소유자가 그 Gate를 다시 확정한다.
- 인계는 이전 claim 재읽기 → 이전 Lease `RELEASED` 또는 `REVOKED` 기록 → 종료 상태 사후 재읽기 → 새 Lease append → 새 소유자의 단독 ACTIVE 재읽기 순서다. 이전 Lease가 ACTIVE인 동안 동일 W claim의 새 Lease를 발급하지 않는다.
- checkpoint에는 mode, catalog/delta, 실행 ID, claim, branch/worktree, commit, Gate evidence, resource, provider, 위험과 다음 행동을 기록한다.
- 인수자는 새 실행과 Lease로 미완료 Gate만 이어간다.

## shared provider

공용 자산 전체를 한 Lease로 묶지 않는다. `MIGRATION`, `ROUTE`, `PROVIDER`, `DB` key별 담당자 한 명만 W claim을 가진다.

1. 소비자는 누락 자원에 `공용 변경 요청`을 남긴다.
2. 작업반장은 같은 resource key 요청을 묶어 provider Lease를 발급한다.
3. 다른 resource key의 provider는 병행할 수 있다.
4. provider commit과 evidence가 ACK되면 소비자가 재개한다.
5. 소비자 책임자는 자신의 parity, restart와 Shadow를 확인한다.

## 보고와 완료

REPORT 사건과 requested action을 먼저 분리한다. 보고는 새 구현 권한을 부여하지 않는다. REPORT 사건은 `bootstrap 완료`, `delta 검수 요청`, `공용 변경 요청`, `resource 충돌`, `용량 차단`, `인계`, `Gate7 완료`만 사용한다. 정상 Gate 1~6과 Heartbeat는 보고하지 않는다.

Gate 7 REPORT에는 catalog/delta, 슬라이스, 실행·claim, resource, Gate evidence, commit·push, risk profile 검증, provider dependency, 운영 자산 불변과 Gate 8 위험을 기록한다.

작업반장 ACK 후 소비자는 `RELEASED`, provider는 `INTEGRATED`로 종료한다.

## 현황 갱신과 Gate 8

`고도화 현황 갱신`은 Git/worktree, Sheets metadata, CONTROL, catalog/delta, active lanes, resource claims와 Gate 수식을 읽기 전용 검산한다. 현재 `SL-*` 행의 G:N을 진행률 권위로 사용하고 catalog·delta staging은 분모에서 제외한다. O열의 수식·숫자·문자열이 혼재하면 G:N으로 차이를 보고하고, ACTIVE claim을 checkpoint한 별도 schema migration에서 validation과 대시보드를 정리한다. 차이가 있을 때만 Notion WBS 링크와 검증된 퍼센티지를 갱신하고 사후 재읽기한다.

Gate 8은 별도 운영 준비 wave다. snapshot 대사, 전체 backup/restore, 승인 smoke, cutover와 rollback을 확인하고 총괄 운영자와 개발자의 승인 범위를 따른다.
