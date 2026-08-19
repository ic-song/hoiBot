---
name: hoibot-modernization-wbs-runner
description: Use as the dedicated hoiBot modernization skill for 고도화진행, slice-scoped continuation, integration, handoff, recovery, or percentage-dashboard refresh. Preserves verified work without reset, prevents duplicate work with slice claims and leases, and moves each command-and-data slice through DB mapping, synthetic fixtures, implementation, parity, Shadow, and operational-readiness gates.
---

# hoiBot 고도화 슬라이스 실행

Google Sheets의 슬라이스 WBS를 진행 기준으로 삼아 작업 분류·선점·복구·이관·검증·인계를 수행한다. 슬라이스는 이관 시점에만 쓰는 임시 묶음이 아니라 이후 수정·회귀 검증에도 재사용하는 기능 작업 단위다.

## 고정 리소스

- Google Drive `hoi` 폴더: `https://drive.google.com/drive/folders/1wcM4C3GZ0G8NSwXFJ1U0sq_s0FxWlB08`
- Google Sheets 슬라이스 WBS: `https://docs.google.com/spreadsheets/d/1tlvrlQ1dGb2ijRc6kDKEBRkSdLjQyhc1u9OfiJES3Ps/edit`
- Notion 퍼센티지 대시보드: `https://app.notion.com/p/3bb393bdd7aa81e38bb9ea8d773a8caf?pvs=204`

새 기준 탭은 `슬라이스_대시보드`, `슬라이스_WBS`, `슬라이스_명령매핑`, `슬라이스_DB매핑`, `슬라이스_검증`, `슬라이스_선점`, `슬라이스_보고수신`이다. `슬라이스_보고수신`은 작업자 보고의 대상·수신 확인·작업반장 인계만 관리하며 Gate·진척률·Lease의 권위는 기존 슬라이스 탭에 그대로 둔다. 기존 WBS 탭은 완료 이력과 미분류 명령을 보존하는 참고 원장이다. 구현 정확성은 현재 코드, Git, DB와 검증 증거로 판정한다.

`명령어_이관`은 명령 카탈로그다. `A:I`의 명령 ID, 단계, 도메인, 대표 명령, 입력형식·별칭, 소스파일, 동작유형, 코드 확인과 사용 상태만 관리한다. 이관 상태, 진척률, 담당자, 선행 작업, DB 매핑, 검증 근거, 다음 작업과 비고를 이 탭에 중복 기록하지 않는다. 개발 진행과 증거는 해당 `슬라이스_*` 탭만 권위 원장으로 사용한다.

Notion에는 WBS 링크와 퍼센티지만 둔다. 상세 명령, 건수, 작업자, 표와 근거는 Google Sheets에서 확인한다.

역할을 표현해야 할 때는 `사용자`, `운영자`, `총괄 운영자`, `개발자`만 사용한다.

## 슬라이스 정의

한 슬라이스에는 다음을 함께 담는다.

- 사용자 또는 운영자 관점의 완료 가능한 기능
- 같은 동작·helper·저장 흐름을 공유하는 명령, 별칭, 인자와 자동 흐름
- 읽고 쓰는 JSON 경로와 DB 테이블·컬럼·키 매핑
- 비식별 합성 fixture와 예시 데이터
- 정상·경계·실패·중복 실행·재시작 시나리오
- legacy parity, transaction, 멱등성, Shadow와 운영 준비 근거

명령 하나가 너무 크면 사용자 결과 기준으로 나누고, 여러 명령이 하나의 transaction을 공유하면 한 슬라이스로 묶는다. 모든 활성 명령과 최종 데이터는 결국 슬라이스에 매핑되어 이관되어야 한다.

## 명령 사용 상태와 이관 범위

- `사용`: 활성 이관 대상이다. 현재 코드로 재검증한 뒤 슬라이스에 연결하고 Gate를 진행한다.
- `미사용 검토`: 총괄 운영자 판단 대기 상태다. 신규 이관 작업은 보류하지만 확정 전까지 이관 대상과 진행률 분모에는 포함한다.
- `미사용`: 기존 Rhino 코드는 유지하고 이관하지 않는다. 슬라이스 분류율·명령 이관률·도메인 진행률의 분자와 분모에서 제외한다.
- 이미 이관된 명령이 `미사용`으로 확정되면 새 시스템의 명령 구현, 명령 전용 DB 매핑·schema, 합성 fixture와 검증 연결을 의존성 확인 후 제거한다. 다른 활성 슬라이스가 쓰는 공용 코드·테이블·컬럼은 삭제하지 않는다.
- 제거 전후에 관련 슬라이스, DB 객체, fixture, 테스트와 dispatch 참조를 검색하고 회귀 검증한다. WBS 행과 기존 evidence는 삭제하지 말고 `미사용` 제외 이력으로 남긴다.
- `미사용`을 다시 `사용`으로 바꾸면 현재 소스 존재·동작·저장 흐름을 재확인하고 새로 슬라이스 매핑한 뒤 작업한다.

## 완료 성과 승계

- 이미 개발되고 Git·DB·테스트 evidence가 확인된 결과는 RESET하거나 재개발하지 않는다.
- 확인된 단계만 해당 Gate 완료로 승계한다.
- 구현이 끝났어도 통합, Shadow 또는 운영 준비 증거가 없으면 그 Gate만 미완료로 둔다.
- 구현 흔적이나 검증 근거가 없거나 소유권을 판정할 수 없는 항목만 `복구 필요` 또는 `소유권 미확인`으로 둔다.
- 기존 WBS 행과 명령 이력은 삭제하지 않는다.

## 8개 Gate

슬라이스 진행률은 다음 8개 Gate의 완료 수로 계산한다.

1. 현행 조사
2. DB 매핑
3. 합성데이터
4. 구현
5. 통합
6. parity
7. Shadow
8. 운영 준비

상태 문자열 하나로 전체 완료를 표현하지 않는다. 작업 상태와 Gate 증거를 함께 갱신한다. `개발 검증 완료`는 보통 1~6 Gate의 증거가 확인된 상태이며 `최종 검증 완료`는 1~8 Gate가 모두 확인된 상태다.

Gate 시작, 완료, 인계, 차단 또는 재개 시점마다 작업 종료를 기다리지 말고 관련 `슬라이스_WBS`, `슬라이스_명령매핑`, `슬라이스_DB매핑`, `슬라이스_검증`, `슬라이스_선점`을 즉시 동기화한다. 각 쓰기는 대상 행 재읽기, 지정 행 쓰기, 사후 재읽기 순서로 검증한다. `명령어_이관`에는 Gate나 작업 진행 정보를 쓰지 않는다.

## 보고 수신 원장

`슬라이스_보고수신`은 다음 두 종류의 행을 append-only로 기록한다.

```text
제어 행: A 종류=CONTROL | B 현재 작업반장 task ID | C 상태(ACTIVE/HANDOFF_READY) | D 활성 시각(KST) | E 이전 task ID | F 인계 checkpoint | G 비고
보고 행: A 종류=REPORT | B 보고 ID | C 보고 시각(KST) | D 작업자명 | E 실행 ID | F 슬라이스 ID | G claim 행 | H 사건(Gate전환/완료/차단/인계) | I Gate 요약 | J WBS·매핑·DB·검증 행 | K commit/push | L 위험·다음 행동 | M 대상 task ID | N 수신 상태(PENDING/ACKED/REJECTED) | O 수신 시각(KST) | P 검수 결과
```

- 작업자는 제어 행 전체를 먼저 재읽어 가장 최근의 단일 `ACTIVE` task ID를 얻고, Gate·Lease 원장 갱신 후 보고 행을 append한다. 작업 캡슐·이전 chat에 들어 있는 task ID는 보고 대상 권위가 아니며 과거 또는 보관 task ID를 복사해 쓰지 않는다.
- 실행 중에는 Lease Heartbeat 전, Gate 전환 전, 완료·차단·인계 보고 직전에 제어 행을 다시 읽는다. 대상 task가 바뀌면 새 task ID로만 보고 행을 append하고, 이전 대상에는 보고를 보내지 않는다.
- 단일 `ACTIVE` 제어 행을 찾지 못하거나 `ACTIVE`가 둘 이상이면 실행을 중지하고 `PENDING` 차단 보고를 append한다. 작업반장 task chat의 active/archived 표시는 제어 행을 대체하지 않는다.
- 보고 ID는 `실행ID-사건-UTC시각`으로 만들며, 재전달은 같은 보고 ID의 새 append 행으로 남긴다.
- `PENDING` 보고는 작업반장이 evidence를 재검수한 뒤에만 `ACKED`로 갱신한다. `REJECTED`면 Gate를 추정해 되돌리지 말고 새 실행·Lease로 정정한다.
- 완료·차단·인계 보고는 `ACKED` 확인 전 종료가 아니다. 현재 작업반장 task가 보관되었거나 수신 불가이면 제어 행을 재읽어 새 대상에 재전달한다.
- 작업반장 인계 시 이전 제어 행을 `HANDOFF_READY`로, 새 작업반장은 자기 `ACTIVE` 제어 행을 append한다. 새 작업반장은 PENDING 보고와 ACTIVE Lease를 대사한 뒤에만 신규 슬라이스를 배정한다.

## 요청 해석

- `고도화진행`, `고도화 이어서 진행`: 선점 가능한 슬라이스 하나를 진행한다.
- `너는 하린이야 고도화진행`: 작업자명을 `하린`으로 사용한다.
- `고도화 길드 이어서 진행`: 해당 도메인의 슬라이스로 범위를 제한한다.
- `고도화 통합 진행`: 통합 레인에서 `통합 준비` 슬라이스를 진행한다.
- `고도화 인계 실행ID`: 지정 실행의 인계 대상과 체크포인트를 확인한 뒤 인수한다.
- `고도화 복구 SLICEID`: 활성 Lease가 없는 `복구 필요` 슬라이스를 증거 기반으로 복구한다.
- `고도화 현황 갱신`: 런타임을 바꾸지 않고 Sheets 퍼센티지와 Notion만 동기화한다.
- `스킬도 최신화 및 고도화관련도 최신화`: 현황 동기화와 저장소 스킬 변경을 분리하고 스킬 변경은 `feature/workflow`에서 처리한다.

작업자명은 요청에서 지정한 가상 인물 이름을 우선한다. 없으면 활성 Lease와 겹치지 않는 2~4음절 한국어 가상 인물 이름을 만든다. 같은 대화 세션에서는 Lease나 실행 ID가 바뀌어도 작업자명을 유지한다.

## 현황 갱신 전용 흐름

`고도화 현황 갱신`은 이관 실행이 아니다. 작업자명, 실행 ID, 선점 행, branch, worktree와 체크포인트를 만들지 않는다.

1. 저장소 branch, dirty 파일, worktree와 기존 체크포인트를 읽기 전용으로 확인한다.
2. Sheets 메타데이터와 새 기준 탭의 실제 이름·sheetId를 확인한다.
3. `슬라이스_대시보드` 퍼센티지를 읽고 연결된 수식을 제한된 범위로 검산한다.
4. Notion을 fetch해 WBS 링크와 퍼센티지만 비교한다.
5. 차이가 있을 때만 Notion의 퍼센티지 구간을 갱신한다. 같으면 재작성하지 않는다.
6. 쓰기가 있었다면 Sheets와 Notion을 다시 읽어 일치 여부를 확인한다.

스킬 파일 변경은 `hoibot-git-workflow`에 따라 `feature/workflow`에서 검증·푸시·`feature/prod` 반영 후 로컬 Codex 스킬과 동기화한다.

## 실행 신원과 선점

실행 ID는 매 실행마다 `작업자명-SLICEID-UTC시각-무작위6자` 형식으로 새로 만든다. 편집 전에 작업자명과 실행 ID를 알리고 체크포인트에 기록한다.

`슬라이스_선점` 열은 다음과 같다.

```text
A 슬라이스 ID | B 도메인 | C 작업 레인 | D 작업자명 | E 실행 ID
F Worktree | G Branch | H 선점 시각(KST) | I Heartbeat(KST)
J Lease 만료(KST) | K 상태 | L 인계 대상 실행 ID | M 체크포인트 | N 비고
```

- 작업 레인은 `도메인` 또는 `통합`을 사용한다.
- 새 선점은 기존 행을 덮어쓰지 말고 append한다.
- Lease 기본 시간은 60분이며 시각은 `YYYY-MM-DD HH:mm:ss KST`로 기록한다.
- 같은 슬라이스에서 `ACTIVE`이고 Lease가 남은 행 중 시트 행 번호가 가장 작은 실행만 소유자다.
- append 직후 같은 슬라이스의 선점 행을 다시 읽어 소유권을 확인한다.
- 소유자가 아니면 자신의 상태를 `ABORTED`로 바꾸고 프로젝트와 시험 DB를 변경하지 않는다.
- 자신의 유효한 실행 ID가 없으면 프로젝트 파일과 시험 DB를 변경하지 않는다.
- dirty worktree의 실행 ID를 체크포인트로 증명할 수 없으면 정리하거나 추정 소유하지 않는다.

## 시작과 작업 선택

1. 체크포인트, branch, worktree, dirty 파일과 push 증거를 조사한다.
2. `AGENTS.md`, Sheets 메타데이터와 새 기준 탭을 읽는다.
3. 사용자 범위에 맞는 `대기`, `구현 중`, `통합 준비` 또는 명시된 `복구 필요` 슬라이스를 선택하되 `미사용` 명령만 포함된 슬라이스는 제외한다.
4. 기존 완료 성과의 evidence를 확인해 Gate를 먼저 승계한다.
5. `feature/prod` 최신 기준으로 실행 ID 전용 branch와 worktree를 준비한다.
6. `슬라이스_선점`에 append하고 소유권을 재검증한다.
7. `슬라이스_WBS`의 활성 실행 ID, branch, 상태와 evidence를 갱신한다.
8. 두 탭의 실행 ID가 일치할 때만 편집을 시작한다.

분류되지 않은 명령을 착수할 때는 기존 `명령어_이관`에서 사용 상태와 현재 코드를 재검증한 뒤 `사용` 명령만 적절한 기존 슬라이스에 연결하거나 새 슬라이스를 정의한다. `미사용 검토`는 판단 전까지 착수하지 않고, `미사용`은 매핑하지 않는다. 임의로 대량 분류하지 않는다.

## 슬라이스 실행 순서

```text
현행 명령·자동 흐름 조사
→ 기존 DB 재사용 여부와 테이블·컬럼·키 매핑
→ 비식별 합성 fixture와 예시 데이터 준비
→ 최소 범위 구현
→ 통합 레인 반영
→ legacy parity·transaction·멱등성·재시작 검증
→ Shadow 검증
→ 운영 준비·최종 데이터 대사
→ evidence·체크포인트·Sheets 갱신
→ 커밋·푸시
```

- 명령 조사에는 `hoibot-command-navigator`를 사용하고 슬라이스 ID, 공유 helper, save flow와 관련 명령을 함께 기록한다.
- 데이터 변경에는 `hoibot-save-flow-guard`를 사용하고 JSON→DB 필드 매핑, transaction 경계, 합성 fixture와 재시작 결과를 확인한다.
- Rhino 코드에는 `hoibot-rhino-js-review`를 사용한다.
- 검색 실패는 부재가 아니라 미확인이다.
- 새 테이블을 만들기 전에 기존 테이블·컬럼·키·원장으로 표현 가능한지 확인한다.
- 개발 중에는 비식별 합성 fixture와 시험 DB만 사용한다. 운영 `data/*`를 시험 DB에 적재하거나 수정하지 않는다.

## Lease·인계·복구

- 중요 단계 전후, 20분 이상 작업 전, DB 검증 전후, 커밋·푸시 전과 종료 전에 Heartbeat와 Lease를 갱신한다.
- 만료된 Lease를 연장하지 말고 새 실행으로 다시 선점한다.
- 인계자는 `HANDOFF_READY`, 인계 대상 실행 ID, checkpoint와 정확한 다음 행동을 기록한다.
- 인수자는 자신이 인계 대상인지 확인하고 별도 선점 행을 append한다.
- 완료 또는 통합 시 `RELEASED` 또는 `INTEGRATED`로 종료한다.
- `고도화 복구 SLICEID`는 활성 Lease가 없고 checkpoint·branch·worktree·commit 증거가 구분될 때만 허용한다.
- 채팅 중단이나 Lease 만료만으로 자동 복구하지 않는다.

## 체크포인트 필수 항목

- 슬라이스 ID·도메인·작업 레인·작업자명·실행 ID
- 선점 행·Heartbeat·Lease·인계 상태
- worktree·branch·checkpoint version·commit·push 상태
- Gate별 evidence, 명령, JSON·DB 객체, fixture, 검증 결과, 남은 위험과 다음 행동

체크포인트 실행 ID가 선점 원장과 다르면 재개하지 않는다.

## 통합과 운영 데이터

- 통합 레인만 공용 migration 순서, dispatch, 공유 fixture loader, 큐와 WBS 구조를 통합한다.
- 도메인 실행은 해당 슬라이스의 Service, Policy, Repository, 테스트와 evidence를 우선한다.
- 최종 운영 데이터 이관은 모든 대상 슬라이스의 parity·Shadow·운영 준비 확인 후 별도로 수행한다.
- 시험 DB 재생성, 전체 백업, 이관 전후 건수·금액·원장 대사와 복원·롤백을 확인한 뒤 총괄 운영자와 개발자가 승인한다.

## 완료 보고

작업자명, 실행 ID, 슬라이스 ID, 선점 행, Lease, 8개 Gate 결과, 명령·DB·Git evidence, Sheets·Notion 갱신 여부와 다음 행동을 보고한다. 실제 확인하지 못한 Gate는 완료로 표현하지 않는다.
