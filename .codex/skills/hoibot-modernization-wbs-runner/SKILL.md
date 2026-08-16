---
name: hoibot-modernization-wbs-runner
description: Use as the dedicated hoiBot modernization migration skill for 고도화진행, named-worker runs, domain-scoped continuation, integration, handoff, recovery, or status refresh. Prevents duplicate work across chats and PCs with a Google Sheets claim ledger, unique execution IDs, leases, heartbeats, explicit handoff, separate worktrees, and checkpoint ownership; then runs DB design and synthetic-data migration through logic parity validation and dashboard synchronization.
---

# hoiBot 고도화 이관 전용 실행

Google Sheets WBS를 진행 기준으로 삼아 작업 식별·선점·복구·이관·검증·인계를 수행한다. 같은 레인, 브랜치 또는 미완료 상태만으로 기존 작업을 재개하지 않는다.

## 고정 리소스

- Google Drive `hoi` 폴더: `https://drive.google.com/drive/folders/1wcM4C3GZ0G8NSwXFJ1U0sq_s0FxWlB08`
- Google Sheets WBS: `https://docs.google.com/spreadsheets/d/15TP6sa36r_cwh49ny-pOiM3nkhgQ5i_KBYzsqdM0NZw/edit`
- Notion 대시보드: `https://app.notion.com/p/3bb393bdd7aa81e38bb9ea8d773a8caf?pvs=204`

Google Sheets의 상세 WBS와 `작업_선점` 탭을 진행·소유권 기준으로 사용한다. Notion은 사람용 집계 대시보드다. 구현 정확성은 현재 코드, Git 및 DB 증거로 판정한다.

## 절대 중복 방지 규칙

- `담당 Agent`의 A~J는 작업자명이 아니라 업무 레인이다.
- 작업자명, 실행 ID, 전용 worktree, 전용 branch와 체크포인트 작업 키를 별도로 사용한다.
- 같은 담당 레인·branch·미완료 상태만으로 재개하지 않는다.
- `작업_선점`에 유효한 자신의 실행 ID가 없으면 프로젝트 파일과 시험 DB를 변경하지 않는다.
- 다른 실행 ID의 활성 Lease가 있으면 해당 WBS ID를 읽기 전용으로만 취급한다.
- dirty worktree의 실행 ID를 체크포인트로 증명할 수 없으면 중단한다. 정리하거나 추정 소유하지 않는다.
- 한 worktree·branch·체크포인트를 여러 채팅이 공유하지 않는다.
- WBS 또는 `작업_선점` 연결이 불가능하면 선점·재개·변경했다고 보고하지 않는다.

## 요청과 실행 신원

- `고도화진행`, `고도화 이어서 진행`: 새 실행 신원을 만들고 선점 가능한 작업 하나를 진행한다.
- `너는 물병이야 고도화진행`: 작업자명을 `물병`으로 사용한다.
- `고도화 길드 이어서 진행`: 해당 도메인으로 선택 범위를 제한한다.
- `고도화 통합 진행`: coordinator 레인으로 공유 파일 통합 작업을 선점한다.
- `고도화 인계 실행ID`: 지정된 실행의 인계 상태와 대상 실행 ID를 확인한 후에만 인수한다.
- `고도화 복구 WBSID`: 선점 원장 도입 전에 시작됐거나 Lease가 사라진 특정 작업을 명시적으로 복구한다.
- `고도화 현황 갱신`: 런타임을 바꾸지 않고 WBS 집계와 Notion만 동기화한다.
- `스킬도 최신화 및 고도화관련도 최신화`: 현황 갱신과 스킬 문서 갱신을 분리한다. 현황은 아래 전용 흐름으로 동기화하고, 스킬 파일은 `feature/workflow`에서 검증·반영한다.

작업자명은 요청에서 지정한 이름을 우선한다. 없으면 `물병`, `나침반`, `등대` 같은 2~4음절 한국어 사물 이름 중 활성 Lease의 작업자명과 겹치지 않는 값을 만든다. 작업자명은 레인 칸이 아니라 `작업_선점`의 `작업자명`에 기록한다.

## 현황 갱신 전용 흐름

`고도화 현황 갱신`은 이관 실행이 아니다. 프로젝트 파일·시험 DB·상세 WBS 상태를 바꾸지 않으므로 작업자명, 실행 ID, 선점 행, branch, worktree, 체크포인트를 새로 만들지 않는다.

1. 저장소의 현재 branch, dirty 파일, worktree와 기존 체크포인트를 읽기 전용으로 확인한다. 다른 실행의 파일을 정리하거나 소유권을 추정하지 않는다.
2. Google Sheets 메타데이터를 먼저 읽고 실제 탭 이름과 `sheetId`를 확정한다.
3. `WBS_대단계`, `도메인_요약`, `작업_선점`과 대시보드 수치에 연결된 상세 탭을 제한된 범위로 읽는다.
4. 대단계·도메인 집계는 Sheets의 현재 수식 결과와 표시값을 원본으로 사용한다. 상세 행 재계산은 집계 검산에만 사용하며, 불일치 시 기존 산식을 확인하지 않고 값을 추정해 덮어쓰지 않는다.
5. 활성 Lease는 `상태=활성`이고 KST 기준 `Lease 만료`가 지나지 않은 행만 센다. 완료·해제·충돌·인계 상태와 만료된 행은 활성 작업에서 제외하고, 만료 또는 비표준 역사 상태는 별도 주의사항으로만 보고한다.
6. Notion 대시보드를 먼저 fetch하고 전체 진행률, 단계별 진행률, 도메인별 완료·진행·전체 수, 현재 규모를 항목별로 비교한다.
7. 차이가 있을 때만 가장 작은 대상 구간을 갱신한다. 값이 모두 같으면 페이지를 재작성하거나 동기화 이력을 덧붙이지 말고 `이미 최신`으로 검증 종료한다.
8. 쓰기가 있었다면 Sheets 대상 셀과 Notion 페이지를 다시 읽어 두 값이 일치하는지 확인한다. 쓰기가 없었다면 비교한 원본 범위와 확인 시각을 보고한다.

사용자가 스킬 파일 최신화도 함께 요청한 경우에만 저장소 관리 스킬을 수정한다. 이 변경은 고도화 실행 선점과 무관하며 `hoibot-git-workflow`에 따라 `feature/workflow`에서 커밋·푸시·`feature/prod` 반영 후 로컬 Codex 스킬을 동기화한다.

실행 ID는 매 실행마다 다음 형식으로 새로 만든다.

```text
작업자명-WBSID-UTC시각-무작위6자
```

실행 ID를 확정하면 편집 전에 `이름을 작업자명으로 하여 고도화 진행하겠습니다. 실행 ID는 실행ID입니다.`라고 알리고 체크포인트에 영구 기록한다. 다른 채팅에서 같은 작업자명을 사용해도 실행 ID는 달라야 한다.

## `작업_선점` 원장

열 구조는 다음과 같다.

```text
A WBS ID | B 도메인 | C 작업 레인 | D 작업자명 | E 실행 ID
F Worktree | G Branch | H 선점 시각(KST) | I Heartbeat(KST)
J Lease 만료(KST) | K 상태 | L 인계 대상 실행 ID | M 체크포인트 | N 비고
```

- 새 선점은 기존 행을 덮어쓰지 말고 `appendCells`로 한 행을 추가한다.
- Lease 기본 시간은 60분이다. 시각은 `YYYY-MM-DD HH:mm:ss KST` 리터럴로 기록한다.
- 같은 WBS ID에서 `상태=활성`이고 Lease가 만료되지 않은 행 중 시트 행 번호가 가장 작은 실행만 소유자다.
- 행 추가 직후 해당 WBS ID의 모든 선점 행을 다시 읽어 자신의 실행 ID가 소유자인지 확인한다.
- 소유자가 아니면 자신의 상태를 `충돌`로 바꾸고 프로젝트 변경 없이 다른 대기 작업을 선택하거나 종료한다.
- 소유권 확인 후 상세 WBS 행을 `선점`으로 바꾸고 담당 레인, 실행 ID, branch 근거를 기록한다. 다시 읽어 두 표의 실행 ID가 일치해야 작업을 시작한다.
- 상세 WBS가 `선점` 이상이어도 대응하는 활성 실행 ID가 없으면 `소유권 미확인`이다. 일반 `고도화진행`으로 자동 재개하지 않는다.

## 기존·고립 작업 복구

`고도화 복구 WBSID`에서만 다음 절차를 허용한다.

1. 해당 WBS ID에 만료되지 않은 활성 Lease가 전혀 없는지 다시 확인한다. 하나라도 있으면 복구하지 않는다.
2. 관련 checkpoint, branch, worktree, dirty 파일, 마지막 commit과 push 증거를 읽기 전용으로 조사한다.
3. 다른 작업 범위가 섞였거나 파일 소유권을 구분할 수 없으면 복구하지 않고 충돌 목록을 보고한다.
4. 사용자가 지정한 작업자명 또는 새 자동 이름으로 `recovery` 표시가 포함된 새 실행 ID를 만든다.
5. `작업_선점`에 새 활성 행을 append하고 일반 선점과 동일하게 행 번호 우선 소유권을 재검증한다.
6. 소유권을 얻은 후 체크포인트 실행 ID·버전을 갱신하고 별도 worktree로 안전하게 분리할 수 있을 때만 변경을 재개한다.

만료 또는 채팅 중단만으로 자동 복구하지 않는다. 복구 명령은 사용자의 명시적 작업 대상 지정이며, dirty 파일 삭제·되돌리기·덮어쓰기 승인은 아니다.

## 시작과 작업 선택

1. `recover-interrupted-work`로 체크포인트, branch, worktree, dirty 파일과 push 증거를 조사한다.
2. `AGENTS.md`와 Google Sheets 메타데이터를 읽는다.
3. `작업_선점`, `WBS_대단계`, `도메인_요약`과 관련 상세 탭을 읽는다.
4. 새 실행 ID와 새 작업 체크포인트를 만든다. 기존 체크포인트를 재사용하려면 그 안의 실행 ID가 현재 활성 소유자와 정확히 일치해야 한다.
5. 새 작업은 선행 조건이 충족되고 상세 상태가 `대기`이며 활성 선점이 없는 행만 선택한다.
6. 업데이트된 `feature/prod`를 기준으로 실행 ID 전용 branch와 worktree를 준비한다.
7. `작업_선점`에 append하고 소유권을 재검증한 후에만 상세 WBS를 갱신한다.
8. 편집 직전 worktree·branch·실행 ID·체크포인트가 모두 일치하는지 다시 확인한다.

## Lease와 Heartbeat

- 중요 단계 전후, 20분 이상 작업 전, 장시간 DB 검증 전후, 커밋·푸시 전과 종료 전에 Heartbeat와 Lease 만료를 갱신한다.
- Heartbeat 갱신 직전에 자신의 행 상태와 현재 소유권을 다시 읽는다.
- 이미 만료된 Lease를 단순 연장하지 않는다. 새 실행으로 선점 절차를 다시 수행한다.
- 소유권을 잃었거나 다른 활성 행이 먼저 존재하면 즉시 쓰기를 중단하고 체크포인트에 충돌을 기록한다.
- 네트워크 장애로 Heartbeat를 기록하지 못하면 새 장기 작업을 시작하지 말고 안전한 로컬 검증까지만 수행한 뒤 중단한다.

## 명시적 인계와 완료

- 인계자는 자신의 상태를 `인계 요청`, 인계 대상 실행 ID를 대상 값으로 기록하고 체크포인트·commit·정확한 다음 행동을 남긴다.
- 인수자는 대상 실행 ID가 자신과 일치하는지 확인하고 별도 선점 행을 append한다.
- 인계자는 인수 확인 후 자신의 상태를 `인계 승인` 또는 `해제`로 바꾼다. 그 전에는 인수자가 수정하지 않는다.
- 완료 시 상세 WBS 증거를 먼저 갱신하고 자신의 선점 상태를 `완료`로 바꾼다.
- 채팅 강제 중단은 인계가 아니다. Lease 만료 후 새 실행이 명시적 복구 절차를 수행해야 한다.

## 기능 단위 이관 순서

```text
명령·자동 흐름 조사
→ DB·테이블·컬럼 매핑 확인
→ 비식별 임시 데이터 준비·적재
→ 로직 이관
→ legacy 결과 비교
→ 합성 MariaDB 검증
→ evidence·체크포인트 기록
→ Google Sheets WBS 갱신
→ 커밋·푸시
```

- 동일 동작과 저장 흐름을 공유하는 명령·별칭·인자·자동 흐름을 한 기능 단위로 묶는다.
- 명령 조사에는 `hoibot-command-navigator`, 데이터 변경에는 `hoibot-save-flow-guard`, Rhino 코드에는 `hoibot-rhino-js-review`를 사용한다.
- guard, helper, 경로, load/save, 출력, 원장, 멱등성 및 DEV/PROD 흐름을 현재 코드에서 재확인한다.
- 검색 실패는 부재가 아니라 미확인이다. 미해결 후보는 `재확인_대상`에 기록한다.
- 상태는 `대기 → 선점 → 조사 중 → 구현 중 → 통합 준비 → 검증 중 → 검증 완료` 순서로 증거에 따라 갱신한다.

## 체크포인트 필수 항목

- WBS ID·도메인·작업 레인·작업자명·실행 ID
- 선점 원장 행 번호·Heartbeat·Lease 만료·인계 상태
- worktree·branch·checkpoint version·commit·push 상태
- 변경 파일·DB 객체·검증 결과·남은 위험·정확한 다음 행동

체크포인트의 실행 ID가 원장과 다르면 현재 작업을 재개하지 않는다.

## 통합과 데이터 안전

- coordinator 레인만 공용 migration 순서, 공통 dispatch, 공유 fixture loader, 큐와 WBS 구조를 통합한다.
- 도메인 실행은 도메인 전용 Service, Policy, Repository, 테스트와 evidence를 우선한다.
- 개발 중에는 비식별 합성 fixture와 시험 DB만 사용한다. 운영 `data/*`를 시험 DB에 적재하거나 수정하지 않는다.
- 전체 운영 데이터 이관은 기능 parity와 통합 검증 후 시험 DB 폐기·재생성, 전체 운영 백업, 복원·롤백 확인과 내부 작업자·고객사 승인을 거쳐 별도로 수행한다.

## 완료 보고

작업자명, 실행 ID, WBS ID, 선점 원장 행, Lease 상태, 단계별 결과, Git·DB 증거, Sheets·Notion 갱신 여부와 다음 명령을 보고한다. 실제 갱신하지 못한 상태는 완료로 표현하지 않는다.
