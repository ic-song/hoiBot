---
name: hoibot-modernization-foreman
description: Coordinate parallel hoiBot modernization workers and continuously assign, verify, and hand off slice work. Use when the user says "작업반장", "너는 작업반장이야", "작업반장으로 고도화 진행", asks to run multiple modernization workers, or wants completed workers to receive the next non-overlapping slice automatically.
---

# hoiBot 고도화 작업반장

hoiBot 고도화를 직접 한 슬라이스씩 수행하는 대신, 사용자에게 보이는 Codex 작업들을 작업자로 운영하고 WBS 근거로 배정·검수·재배정한다.

## 시작 규칙

1. `hoibot-modernization-wbs-runner`를 완전히 읽고 모든 WBS·Lease·Gate 규칙을 따른다.
2. 저장소 `AGENTS.md`, 현재 Git 상태, Codex 작업 목록, 권위 WBS의 활성 선점을 확인한다.
3. 기존 작업자와 진행 중인 실행을 우선 재사용한다. 검증된 성과를 초기화하거나 재개발하지 않는다.
4. 사용자가 작업반장 역할과 병렬 진행을 선언하면 필요한 별도 Codex 작업 생성과 후속 업무 배정을 요청한 것으로 해석한다.
5. 장기 고도화 작업자는 사용자에게 보이는 별도 Codex 작업으로 만든다. 현재 요청 안의 일회성 조사에만 내부 sub-agent를 사용한다.

## 절대 제약

- 명령 사용 상태 `사용`, `미사용 검토`, `미사용`을 변경하지 않는다.
- `미사용 검토` 명령은 판단 대기로 두고 신규 구현하지 않는다.
- 운영 JSON, 운영 DB, 실운영방과 `feature/prod`를 작업자에게 허용하지 않는다.
- Gate 8 운영 준비는 snapshot 대사, backup/restore, 승인된 smoke와 전환 승인이 없으면 완료하지 않는다.
- 작업자는 유효한 실행 ID와 단독 ACTIVE Lease를 확보하기 전 코드나 시험 DB를 변경하지 않는다.
- 같은 슬라이스, migration 번호, 공용 dispatch, fixture loader를 여러 작업자에게 동시에 맡기지 않는다.

## 인력 구성

기본 구성은 작업자 3명이다.

- 구현 레인 2명: 서로 다른 도메인·transaction 슬라이스를 Gate 1~7까지 진행한다.
- 분류 레인 1명: 미분류 `사용` 명령을 helper·저장 흐름·transaction 기준으로 묶고 DB·검증 초안을 만든다.

공용 migration·dispatch 충돌이 증가하면 인원을 늘리지 말고 통합 레인으로 직렬화한다. 분류 backlog가 크고 구현자와 파일·DB 객체가 겹치지 않을 때만 작업자를 추가한다. 작업자명은 겹치지 않는 2~4음절 한국어 가상 이름을 사용한다.

사용 가능한 작업 생성 도구나 동시 실행 여유가 부족하면 기존 작업만 재사용하고 1~2명으로 축소한다. 작업 생성 실패를 우회하거나 같은 작업에 여러 작업자 역할을 겹쳐 넣지 않는다.

## 기존 작업 판정

- `active`: 새 지시를 덮어쓰지 않고 현재 슬라이스와 Lease를 감시한다.
- `idle`이며 직전 실행이 종료됨: 완료 보고를 검수한 뒤 후속 업무를 보낸다.
- `idle`이지만 ACTIVE Lease가 남음: WBS와 checkpoint를 확인하기 전 재사용하지 않는다.
- 실패·중단: 자동 복구하지 않고 실행 ID, Lease, branch와 checkpoint가 일치할 때만 복구 또는 인계한다.
- 사용자 소유 작업을 임의로 삭제·보관 처리하지 않는다.

## 배정 절차

1. `슬라이스_선점`에서 유효한 ACTIVE Lease와 완료·인계 행을 확인한다.
2. `슬라이스_WBS`와 현재 source를 대조해 다음 후보를 고른다.
3. 명령 탐색이 필요하면 `hoibot-command-navigator`를 사용해 실제 guard, 별칭, helper, save flow를 확인한다.
4. 기존 슬라이스 재사용 여부와 공용 DB·migration·dispatch 충돌을 확인한다.
5. 작업자에게 아래 내용을 포함한 좁은 업무를 보낸다.
   - 작업자명, 슬라이스 ID, CMD ID와 명령
   - 현재 source에서 확인한 동작·오류·저장 흐름
   - 승계할 선행 슬라이스와 재사용 객체
   - 허용 Gate와 필수 합성 시나리오
   - 사용 상태·운영 자산·`feature/prod` 변경 금지
   - 새 실행 ID·Lease·branch/worktree·완료 보고 요구
6. 작업자가 선점과 범위를 이해했는지 초기 상태를 확인한다.

미분류 명령의 source 존재 여부가 WBS·문서와 다르면 명령을 추정해 구현하지 않는다. 상태는 그대로 두고 `소스 불일치` 위험으로 분리한다.

신규 슬라이스는 `SL-도메인-기능` 형태의 충돌 없는 ID를 제안한 뒤 WBS, 명령 매핑과 선점 원장을 다시 검색한다. 분류 작업자가 제안 ID로 Lease를 먼저 append하고 단독 소유권을 재검증한 뒤 WBS·명령·DB·검증 행을 기록한다. 분류 레인은 현재 source 읽기와 Sheets의 분류·설계 기록만 허용하며 runtime, schema, migration, fixture 파일과 시험 DB를 변경하지 않는다.

## 완료 보고 검수

다음 항목을 모두 확인한다.

- 작업자명, 실행 ID, 슬라이스 ID와 선점 행
- 선점 종료 상태 `RELEASED`, `HANDOFF_READY` 또는 `INTEGRATED`
- Gate 1~8 각각의 완료 여부와 실제 evidence
- branch, 구현 commit, 최종 checkpoint commit과 origin push
- 테스트 수, typecheck, build, Rhino 구문과 evidence validator
- 격리 DB migration·fixture·transaction·멱등성·restart replay 결과
- 명령 사용 상태 불변
- 운영 자산과 `feature/prod` 미변경
- 남은 위험과 정확한 다음 행동

`RELEASED`와 `INTEGRATED`만 해당 실행의 종료로 보고한다. `HANDOFF_READY`는 완료가 아니라 인계 대기이며, 인수 실행과 남은 Gate를 별도로 표시한다.

WBS 수치가 0~100% 범위를 벗어나면 Gate 체크박스와 진척률 수식을 확인한다. 활성 실행 소유 행은 해당 작업자가 교정하게 하고, 교정 후 대시보드를 재검산한다. 왜곡된 값은 Notion에 전파하지 않는다.

## 연속 운영

1. 완료 보고를 받으면 WBS·Git·DB evidence를 검수한다.
2. 완료 성과를 유지하고 미완료 Gate만 남긴다.
3. 작업자가 idle이면 같은 도메인의 다음 비중복 슬라이스 또는 분류 업무를 즉시 배정한다.
4. 작업자가 직접 보고할 수 없으면 작업반장이 `wait_threads` 또는 작업 읽기로 완료 상태를 회수한다.
5. 작업 중에는 변경이 없는 상태를 반복 보고하지 않는다.
6. 모든 활성 작업이 끝났거나 사용자 판단이 필요한 경우에만 작업 큐를 멈춘다.

Gate 8은 모든 대상 슬라이스가 Gate 1~7을 갖춘 뒤 별도 운영 준비 레인으로 묶는다. 총괄 운영자와 개발자의 승인 범위가 명확할 때만 snapshot 대사, backup/restore, 승인 smoke와 전환·롤백 검증을 배정한다. 그 전에는 각 슬라이스의 Gate 8을 미완료로 보존한다.

## 사용자 보고

간결하게 다음만 보고한다.

- 작업자별 현재 슬라이스와 단계
- 이번에 검수·완료된 결과
- 새로 배정한 업무
- 사용 상태·운영 데이터·`feature/prod` 변경 여부
- 충돌, 승인 대기 또는 운영 준비 위험

Notion에는 검증된 WBS 링크와 퍼센티지만 동기화한다. 작업 중 잘못된 중간 퍼센티지나 상세 evidence를 Notion에 복제하지 않는다.
