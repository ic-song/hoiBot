---
name: hoibot-modernization-wbs-runner
description: "Run hoiBot modernization under a classification-first process: classify every active command into a frozen slice catalog before implementation, then execute one assigned slice end-to-end through Gate 1 to Gate 7 with foreman-issued leases, shared providers, DB validation, parity, Shadow, recovery, handoff, and dashboard synchronization."
---

# hoiBot 고도화 슬라이스 실행

현재 CONTROL의 `phase`에 따라 동작한다.

- `CLASSIFY`: 모든 활성 명령을 슬라이스로 분류한다. 구현과 시험 DB 변경을 금지한다.
- `EXECUTE`: 동결된 카탈로그의 배정 슬라이스를 같은 소유자가 Gate 1~7까지 진행한다.

## 고정 리소스

- Google Drive `hoi`: `https://drive.google.com/drive/folders/1wcM4C3GZ0G8NSwXFJ1U0sq_s0FxWlB08`
- 슬라이스 WBS: `https://docs.google.com/spreadsheets/d/1tlvrlQ1dGb2ijRc6kDKEBRkSdLjQyhc1u9OfiJES3Ps/edit`
- Notion 퍼센티지: `https://app.notion.com/p/3bb393bdd7aa81e38bb9ea8d773a8caf?pvs=204`

권위 탭은 `슬라이스_대시보드`, `슬라이스_WBS`, `슬라이스_명령매핑`, `슬라이스_DB매핑`, `슬라이스_검증`, `슬라이스_선점`, `슬라이스_보고수신`이다. `명령어_이관`은 A:I 명령 카탈로그와 사용 상태만 관리한다. Gate, 담당, DB와 evidence를 쓰지 않는다.

상세 작업과 증거는 Sheets에, Notion에는 WBS 링크와 검증된 퍼센티지만 둔다.

## 사용 상태

- `사용`: Phase 1 분류와 Phase 2 실행 대상
- `미사용 검토`: 결정 backlog에 남기고 구현 금지
- `미사용`: Rhino source를 유지하고 분류·실행과 진행률에서 제외

작업자는 상태를 변경하지 않는다. `미사용`이 다시 `사용`이 되면 현재 source를 재검증하고 다음 catalog version에 반영한다.

## 기존 성과

- 기존 Git, DB, 테스트와 Gate evidence를 보존한다.
- 새 카탈로그에 기존 evidence를 연결하되 확인되지 않은 Gate를 승계하지 않는다.
- ACTIVE 구현은 첫 전환 때 현재 원자 작업을 checkpoint하고 `HANDOFF_READY`로 멈춘다.
- 카탈로그 동결 후 같은 소유자를 우선 배정하고 미완료 Gate만 계속한다.

## CONTROL과 프로세스 단계

`슬라이스_보고수신`의 최신 단일 ACTIVE CONTROL checkpoint에 다음을 기록한다.

```text
phase=CLASSIFY|EXECUTE
catalog_version=초안 또는 SC-YYYYMMDD-N
classification_batches=...
ready_queue=...
active_providers=...
```

CONTROL이 없거나 둘 이상이면 모든 쓰기를 중단하고 차단 REPORT를 남긴다.

## Phase 1: CLASSIFY

### batch Lease

작업반장이 `사용` CMD를 도메인과 CMD ID로 겹치지 않게 나누고 `CATALOG-BATCH-*` 실행 ID와 Lease를 발급한다. 작업자는 Lease를 직접 append하지 않는다.

작업자는 지정된 CMD만 source에서 확인한다.

- 대표 명령과 별칭
- 정확한 guard, 자동 흐름과 source 위치
- helper, JSON 경로와 load/save 흐름
- 제안 슬라이스와 함께 묶을 CMD
- 제안 DB 객체와 transaction 경계
- 합성 fixture와 검증 시나리오
- 공용 provider dependency
- 위험과 source 불일치

Phase 1에서는 runtime, schema, migration, fixture loader, 시험 DB와 Gate를 변경하지 않는다. `명령어_이관` 상태와 다른 batch의 canonical 행도 수정하지 않는다.

분류 결과는 작업반장이 지정한 staging 범위 또는 task-scoped manifest에 기록한다. canonical WBS merge는 카탈로그 검수 담당자 한 명이 직렬 수행한다.

### 분류 규칙

- 모든 `사용` CMD는 정확히 하나의 primary 슬라이스를 가진다.
- 별칭은 대표 명령과 같은 슬라이스에 둔다.
- 같은 사용자 결과, helper와 transaction을 공유하면 묶는다.
- 독립 rollback과 사용자 결과가 다르면 나눈다.
- 공용 migration, dispatch, fixture와 runtime은 `SL-COMMON-*` provider로 분리한다.
- 자동 흐름과 최종 데이터 세트도 슬라이스에 연결한다.
- 검색 실패는 부재가 아니라 미확인으로 기록한다.

### 동결 검증

- 활성 `사용` CMD mapped = total
- unmapped CMD = 0
- duplicate primary mapping = 0
- alias·자동 흐름·최종 데이터 orphan = 0
- slice ID collision = 0
- source mismatch와 `미사용 검토` 결정 backlog 분리
- 모든 슬라이스에 DB·fixture·검증 초안과 위험도 존재
- provider dependency graph 존재
- 기존 evidence 연결 완료

validator 통과 후 `catalog_version=SC-YYYYMMDD-N`을 기록하고 CONTROL을 `phase=EXECUTE`로 변경·재읽는다. 동결 전에는 Phase 2 Lease를 발급하지 않는다.

## Phase 2: EXECUTE

### Gate

1. 현행 조사
2. DB 매핑
3. 합성데이터
4. 구현
5. 통합
6. parity
7. Shadow
8. 운영 준비

분류 카탈로그는 Gate evidence가 아니다. 전담자는 catalog draft를 현재 source와 재확인하며 Gate 1부터 진행한다. 기존 슬라이스의 검증된 Gate만 승계한다.

- `개발 검증 완료`: Gate 1~6 evidence와 commit·push·격리 검증 완료
- `Shadow 완료`: Gate 1~7 완료, 최대 87.5%
- `최종 검증 완료`: Gate 1~8과 운영 전환 근거 완료

### 실행 Lease

신규 실행 ID와 Lease는 작업반장만 발급한다.

```text
A 슬라이스 ID | B 도메인 | C 작업 레인 | D 작업자명 | E 실행 ID
F Worktree | G Branch | H 선점 시각 | I Heartbeat | J 만료
K 상태 | L 인계 대상 | M 체크포인트 | N 비고
```

1. 작업반장이 catalog version, dependency, ACTIVE Lease, 파일·DB·migration·dispatch 충돌을 확인한다.
2. READY 슬라이스에 실행 ID, branch와 worktree를 정해 append한다.
3. 같은 슬라이스의 유효 ACTIVE 행을 사후 재읽어 단독 소유권을 확인한다.
4. 작업자는 claim A:N과 WBS 실행 ID를 재읽고 일치할 때만 시작한다.
5. Heartbeat 전 자신의 슬라이스 ID, 실행 ID와 ACTIVE를 비교한다.
6. Gate 1~7 동안 같은 작업자, task, 실행 ID, Lease, branch와 worktree를 유지한다.

고정 행 번호, 다음 빈 행 추정과 동시 fixed-range Lease 쓰기를 금지한다.

### 실행 순서

```text
source·자동 흐름 재검증
→ DB 테이블·컬럼·키·transaction 확정
→ 비식별 합성 fixture
→ 최소 범위 구현
→ provider dependency와 통합
→ parity·transaction·멱등성·restart
→ Shadow
→ evidence·checkpoint·Sheets
→ commit·push
```

- 명령 조사: `hoibot-command-navigator`
- 저장·데이터: `hoibot-save-flow-guard`
- Rhino 코드: `hoibot-rhino-js-review`
- 운영 `data/*`, 운영 DB와 실운영방 사용 금지

Gate 시작·완료마다 관련 WBS, 명령매핑, DB매핑, 검증과 claim을 대상 행 재읽기, 쓰기, 사후 재읽기 순서로 동기화한다. 정상 Gate 1~6 전환은 REPORT나 작업반장 ACK 없이 계속한다.

## 공용 provider

공용 migration 순서, dispatch, fixture loader와 shared runtime은 공용 provider 담당자 한 명만 별도 `SL-COMMON-*` Lease에서 수정한다.

provider가 없으면 소비자에서 임시 구현하지 않는다.

1. 소비자 전담자가 `공용 변경 요청` REPORT를 남긴다.
2. 작업반장이 같은 요청을 묶어 provider Lease를 발급한다.
3. 소비자 branch, worktree와 checkpoint를 보존한다.
4. provider commit과 evidence가 ACK되면 같은 소비자 실행에서 재개한다.
5. 소비자 전담자가 parity, restart와 Shadow를 직접 확인한다.

## 보고

REPORT 사건은 `분류 batch 완료`, `카탈로그 검수 완료`, `공용 변경 요청`, `차단`, `인계`, `Gate7 완료`만 사용한다. 정상 Gate 1~6, Heartbeat와 진행 상황은 보고하지 않는다.

사건 직전에 최신 ACTIVE CONTROL을 읽고 원장을 먼저 갱신한 뒤 REPORT를 append한다. 작업반장에게 `보고 준비 | row<행번호> | claim<행번호> | <사건> | ACK 대기`만 보낸다.

작업반장은 지정 REPORT, claim, WBS와 필요한 manifest/Git/provider 근거만 읽어 ACKED 또는 REJECTED와 다음 행동을 같은 회차에 기록한다. Gate 7 ACK 전 Lease 종료와 신규 슬라이스 착수를 금지한다.

## 체크포인트·인계·복구

체크포인트에 phase, catalog version, 슬라이스, 실행 ID, claim, branch, worktree, commit, Gate evidence, JSON·DB, fixture, provider commit, 위험과 다음 행동을 남긴다.

인계는 Lease 만료, 명시 차단, 사용자 승인 또는 소유자가 계속할 수 없을 때만 한다. 토큰, 보고 수, 대화 길이와 Gate 전환은 인계 사유가 아니다.

인계자는 `HANDOFF_READY`와 checkpoint를 남긴다. 인수자는 작업반장이 발급한 새 실행과 단독 Lease로 미완료 Gate만 이어간다. ACTIVE Lease가 없고 소유권 근거가 구분될 때만 복구한다.

## Gate 7 완료

다음을 REPORT한다.

- catalog version, 슬라이스, 실행 ID와 claim
- Gate 1~7 evidence
- 명령, JSON·DB, fixture와 provider dependency
- commit, push, typecheck, build와 validator
- transaction, 멱등성, restart replay와 Shadow
- 사용 상태, 운영 데이터와 `feature/prod` 불변
- Gate 8 위험과 다음 행동

작업반장 ACK 후 소비자 Lease는 `RELEASED`, provider는 `INTEGRATED`로 종료한다.

## 현황 갱신

`고도화 현황 갱신`은 실행과 분리한다. Git/worktree, Sheets metadata, phase, catalog version, 분류율과 Gate 수식을 읽기 전용 검산하고, 차이가 있을 때만 Notion의 WBS 링크와 퍼센티지를 갱신한 뒤 사후 재읽기한다.

## Gate 8

모든 대상 슬라이스가 Gate 1~7을 갖춘 뒤 별도 운영 준비 wave로 진행한다. snapshot 대사, 전체 backup/restore, 승인 smoke, cutover와 rollback을 확인하고 총괄 운영자와 개발자가 승인한다.
