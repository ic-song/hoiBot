---
name: hoibot-modernization-wbs-runner
description: Use as the dedicated hoiBot modernization migration skill when the user requests 고도화진행, 고도화 이어서 진행, a named-worker modernization run, a domain-scoped continuation, integration, or status refresh. Recovers interrupted work, assigns or reuses the Google Sheets WBS worker name, claims one eligible row, runs DB design and synthetic-data migration through logic parity validation, and synchronizes progress evidence and the Notion dashboard.
---

# hoiBot 고도화 이관 전용 실행

Google Drive의 WBS를 단일 진행 기준으로 삼아 중단 복구, 작업자 식별, 작업 선점, 단계별 이관, 검증 및 대시보드 갱신까지 수행한다. 사용자는 링크나 절차를 반복할 필요가 없다.

## 고정 리소스

- Google Drive `hoi` 폴더: `https://drive.google.com/drive/folders/1wcM4C3GZ0G8NSwXFJ1U0sq_s0FxWlB08`
- Google Sheets WBS: `https://docs.google.com/spreadsheets/d/15TP6sa36r_cwh49ny-pOiM3nkhgQ5i_KBYzsqdM0NZw/edit`
- Notion 대시보드: `https://app.notion.com/p/3bb393bdd7aa81e38bb9ea8d773a8caf?pvs=204`

Google Sheets를 진행 상태의 단일 기준으로 사용한다. Notion은 사람용 요약 대시보드이며 상세 WBS를 중복 관리하지 않는다. 구현 사실은 현재 코드, Git 및 DB 증거로 판정한다.

## 요청 해석과 작업자명

- `고도화진행`, `고도화 이어서 진행`: 미완료 작업을 복구하거나 조건을 만족하는 작업 하나를 선점해 진행한다.
- `너는 물병이야 고도화진행`: `물병`을 `담당 Agent`에 사용한다. `너는 <이름>이야`, `너는 <이름>야`, `이름은 <이름>`도 같은 방식으로 해석한다.
- `고도화 <도메인> 이어서 진행`: 해당 도메인으로 선택 범위를 제한한다.
- `고도화 통합 진행`: 새 작업보다 `통합 준비` 또는 `검증 중` 작업을 먼저 통합한다.
- `고도화 현황 갱신`: 런타임 코드를 바꾸지 않고 WBS 집계와 Notion 대시보드만 동기화한다.

작업자명은 다음 우선순위로 정한다.

1. 사용자가 이번 요청에서 지정한 이름
2. 현재 체크포인트와 동일 브랜치의 미완료 WBS 행에 기록된 이름
3. 충돌하지 않는 짧은 한국어 사물 이름을 자동 생성한 값

자동 이름은 `물병`, `나침반`, `등대`처럼 읽기 쉬운 2~4음절로 만들고 기존 미완료 작업자명과 겹치지 않는지 확인한다. 이름이 정해지면 편집 전에 `이름을 <이름>으로 하여 고도화 진행하겠습니다.`라고 알린다. 같은 작업을 재개할 때 이름을 바꾸지 않는다.

## 시작 및 복구

1. `recover-interrupted-work` 스킬로 체크포인트, 브랜치, 업스트림, worktree, dirty 파일과 미완료 작업을 복구한다.
2. `AGENTS.md`를 읽고 저장소 및 브랜치 규칙을 적용한다.
3. Google Sheets의 `WBS_대단계`, `도메인_요약` 및 관련 상세 탭을 읽는다.
4. 체크포인트·Git·DB 증거와 WBS의 담당자·상태를 대조한다.
5. 기존 작업자의 미완료 행이 있으면 우선 재개한다. 없으면 선행 조건이 충족되고 상태가 `대기`이며 `담당 Agent`가 빈 행 하나만 선택한다.
6. 코드 편집 전에 WBS 행에 작업자명, 브랜치와 상태 `선점`을 기록한다. 기록 실패 시 편집을 시작하지 않는다.
7. 병렬 채팅은 각각 별도 worktree와 작업 브랜치를 사용한다. 동일 WBS ID를 중복 선점하지 않는다.

Google Drive나 Sheets 연결을 사용할 수 없으면 로컬 증거 조사까지만 수행한다. WBS를 선점했다고 보고하지 말고 연결 복구에 필요한 사항과 다음 행동을 체크포인트에 남긴다.

## 기능 단위 이관 순서

동일 동작과 저장 흐름을 공유하는 대표 명령, 별칭, 인자 형태 및 자동 흐름을 하나의 기능 단위로 묶어 아래 순서를 지킨다.

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

- 현재 코드에서 명령 guard, helper, 데이터 경로, load/save, 출력 형식, 원장 영향, 멱등성 및 DEV/PROD 흐름을 재확인한다.
- 명령 조사에는 `hoibot-command-navigator`를 사용한다.
- 저장·로드 또는 데이터 변경에는 `hoibot-save-flow-guard`를 사용한다.
- Rhino 실행 코드를 건드리면 `hoibot-rhino-js-review`를 사용한다.
- 검색 실패는 부재가 아니라 미확인이다. 미해결 후보는 `재확인_대상` 탭에 기록한다.
- 누락된 운영 파일 구조는 코드와 기존 스냅샷으로 추론하되 시험에는 비식별 합성 데이터만 사용한다.
- 진행률과 상태는 대화의 주장 대신 재현 가능한 증거로 갱신한다.

## 상태와 체크포인트

```text
대기 → 선점 → 조사 중 → 구현 중 → 통합 준비 → 검증 중 → 검증 완료
```

각 중요 단계 직후와 채팅 종료·인계 전에 WBS와 작업 체크포인트에 다음을 기록한다.

- WBS ID와 도메인
- 작업자명, worktree, 브랜치 및 커밋
- 현재 상태와 완료 단계
- 변경 파일 및 DB 객체
- 실행한 검증과 결과
- 남은 위험 및 정확한 다음 행동

필수 테스트와 합성 MariaDB 결과 비교가 통과하기 전에는 `검증 완료`로 바꾸지 않는다. 중단 후에는 `선점`, `조사 중`, `구현 중`, `통합 준비`, `검증 중` 행을 먼저 복구한다.

## 통합과 공유 파일

통합 담당 A는 공용 migration 순서, 공통 dispatch, 공유 fixture loader, 큐 구조 및 WBS/대시보드 구조를 관리한다. 도메인 작업자는 가능한 한 도메인 전용 Service, Policy, Repository, 테스트 및 evidence만 수정한 뒤 커밋 SHA와 검증 결과를 인계한다.

`고도화 통합 진행`에서는 `통합 준비`와 `검증 중` 행을 우선 처리하고 통합 합성 회귀 테스트를 수행한 뒤 WBS와 Notion을 순서대로 갱신한다.

## 데이터 안전과 최종 이관

- 개발 중에는 비식별 합성 fixture와 시험 DB만 사용한다.
- 전체 운영 `data/*` 스냅샷을 시험 흐름에 적재하거나 변경하지 않는다.
- 합성 fixture는 설계와 검증 자료이며 운영 이관 완료 증거가 아니다.
- 전체 운영 데이터 이관은 마지막 별도 단계다. 시험 데이터 초기화, 전체 운영 백업, 복원·롤백 확인, 내부 작업자와 고객사 승인 후 수행한다.

## 완료 보고

작업 종료 시 작업자명, 처리한 WBS ID, 단계별 상태, 변경·검증 증거, Google Sheets 갱신 여부, Notion 갱신 여부 및 다음 재개 명령을 보고한다. 실제 갱신하지 못한 외부 상태를 갱신했다고 표현하지 않는다.
