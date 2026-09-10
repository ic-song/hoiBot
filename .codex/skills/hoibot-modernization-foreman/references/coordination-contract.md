# 고도화 조정 계약

작업반장과 실행자가 공유하는 CONTROL, Lease, resource, 상태와 evidence 계약이다. 규칙 배포 자체는 실행 중인 CONTROL이나 Lease를 변경하지 않는다. 기존 행을 읽고 아래 호환 규칙으로 대사한 뒤, 필요한 변경만 새 CONTROL로 명시한다.

## canonical 쓰기와 FOREMAN_LEASE

- CONTROL 교체, Lease 발급·회수, canonical REPORT append·ACK와 용량 확장은 동일 WBS의 단일 작업반장 writer가 수행한다. 구현 자원 Lease와 이 짧은 조정 잠금은 별개다. 독립 자원 구현을 전역 직렬화하지 않는다.
- `FOREMAN_LEASE`에는 `scope`(spreadsheet ID), `owner_task_id`, `lease_id`, `fencing_token`, `expires_at`, `control_revision`을 둔다. 취득·갱신·해제는 검증된 공유 저장소의 원자적 compare-and-set 또는 동등한 배타 연산을 사용한다. writer는 매 변경 시 소유권·만료·revision을 확인하고 저장 계층은 오래된 fencing token의 쓰기를 거부해야 한다.
- Sheets의 읽기→셀 쓰기→재읽기만으로 원자적 잠금이나 낙관적 잠금이 구현됐다고 주장하지 않는다. 서버가 기대 revision을 조건으로 검사하지 않는 쓰기는 CAS가 아니다. 로컬 파일 잠금만으로 다른 PC의 writer를 배제했다고 보지 않는다.
- 위 기능이 없으면 최신 단일 CONTROL에서 지정한 한 task만 writer로 유지한다. 다른 작업반장은 읽기·수정안 staging만 수행한다. 지정이 없거나 중복이면 canonical 쓰기를 멈추고 소유권을 먼저 해결한다. 이 fallback에는 자동 만료 탈취를 적용하지 않는다. 이전 task의 종료 또는 명시적 쓰기 중단 ACK를 확인해야 인계할 수 있다.
- 재시도 가능한 변경마다 `operation_id`, 예상 CONTROL revision, 변경 전 digest와 변경 후 digest를 기록한다. timeout이면 operation ID와 실제 행을 조회해 성공 여부부터 확인한다. 결과가 불명확하면 append나 덮어쓰기를 반복하지 않는다.
- append API가 반환한 실제 행과 operation ID를 재읽는다. 고정 행 예약·다음 빈 행 추정은 금지한다. 기존 REPORT가 덮어써졌다면 확인된 원본으로 새 복구 REPORT를 append하고 원래 operation ID와 복구 관계를 남긴다. 증거 없이 행 내용을 재구성하지 않는다.
- CONTROL 교체는 현재 head/revision을 재확인하고 직렬 append한다. `supersedes`, 새 revision, writer identity와 operation ID를 남긴다. 분기된 head는 최신 행 번호만으로 선택하지 않고 공통 선행 CONTROL과 각 변경을 대사한다.

## CONTROL schema와 lane

- CONTROL은 `evidence_schema_versions`에 지원 schema ID 목록을 기록한다. 개별 evidence·delta manifest의 `evidence_schema_version`은 해당 파일의 단일 형식이다. 실제 파일의 기존 camelCase 필드는 validator 계약에 따라 유지한다.
- 단수 필드만 있는 legacy CONTROL은 읽을 때 1원소 목록으로 해석한다. 복수 필드와 단수가 함께 있으면 단수가 복수 목록에 포함되어야 한다. 불일치·누락·지원하지 않는 schema는 관련 Gate 승계와 신규 쓰기를 차단하고 원본을 보존한다. 복수 목록의 첫 항목을 모든 evidence에 강제하지 않는다.
- `active_lanes`의 ID는 `lane_workstreams` 매핑으로 `BOT_MIGRATION`, `WEB_PORTAL`, `SHARED_INTEGRATION`에 연결한다. 기존 `OBJECT_*`도 유효한 legacy lane ID로 보존한다. 이름만 보고 `BOT_*`로 바꾸거나 workstream을 추정하지 않는다.
- legacy CONTROL에 매핑이 없으면 실제 claim·catalog·provider 범위를 대사해 다음 CONTROL에 명시한다. 미확인 lane만 신규 배정을 보류하고 확인된 다른 lane은 계속한다.

## resource type과 충돌 판정

| type | key 의미와 추가 판정 |
| --- | --- |
| `FILE`, `DIR`, `SCRIPT` | 저장소 상대 파일·디렉터리·스크립트. SCRIPT는 FILE과 같은 물리 경로로 비교하고 DIR은 하위 경로를 포함한다. |
| `TEST`, `FIXTURE`, `EVIDENCE` | 논리 시험·fixture·증거 ID와 manifest의 실제 입력·출력 파일, DB, runner 설정을 함께 claim한다. |
| `DELTA`, `CONTRACT` | catalog delta·공유 계약 ID와 실제 staging/canonical 파일 및 영향을 받는 자원을 함께 claim한다. |
| `DB`, `MIGRATION`, `ROUTE`, `PROVIDER`, `LEDGER`, `RECEIPT`, `WBS` | DB 객체, migration 번호, route, provider, 원장, receipt, spreadsheet/tab/range를 명시한다. |

- 모든 key는 등록된 repository namespace를 사용한다. WBS에는 spreadsheet ID도 포함한다. 경로는 `/`, `./` 제거, Windows 경로 대소문자 무시를 적용하고 절대경로·`..`는 거부한다. 경로 포함은 segment 경계로 비교한다(`a/b`는 `a/b/c`를 포함하지만 `a/b2`는 포함하지 않음).
- type 문자열이 다르더라도 물리 자원이나 포함 범위가 같으면 충돌한다. 논리 ID만으로 물리 파일·DB의 W claim을 생략하지 않는다. WBS는 spreadsheet/tab 전체와 하위 range의 겹침도 확인한다.
- R/R만 병행 가능하다. 한쪽이라도 W이면 직렬화한다. migration 번호·provider 승격은 W이다. 새 type 또는 미해결 logical→physical mapping은 해당 자원 쓰기를 보류하고 작업반장 검수 후 등록한다.

## 상태와 전이

보고 처리, 실행 단계, Lease 유효성을 서로 다른 축으로 읽는다. legacy 열에 혼재한 값은 원본을 유지하고 checkpoint에 `lease_status`, `execution_state`, `report_status`, `requested_action`을 명시해 해석한다. 아래는 신규 전이 계약이며 과거 행이 이미 이 계약을 충족했다고 간주하지 않는다.

| 축 | 허용 전이 | 조건·담당 |
| --- | --- | --- |
| Lease | `reserved_lease → ACTIVE` | 작업반장이 dependency, 충돌, owner와 실제 append 행을 검증한 뒤 활성화. 예약은 실행 권한이 아니며 유효한 예약 자원은 중복 발급하지 않음. |
| Lease | `reserved_lease → REVOKED` | 예약 취소·만료를 작업반장이 확인. |
| Lease | `ACTIVE → RELEASED / INTEGRATED` | 완료 evidence와 작업반장 ACK. 소비자는 RELEASED, 승격된 provider는 INTEGRATED. |
| Lease | `ACTIVE → REVOKED / EXPIRED` | 작업반장이 중단·만료와 task 상태를 재확인. 시간 경과만으로 자동 탈취 금지. |
| 실행 | `EXECUTE → REVIEW / REVIEW_AND_AUDIT` | 구현·evidence checkpoint 제출, 검수 범위 지정. |
| 실행 | `REVIEW / REVIEW_AND_AUDIT → CORRECT` | 검수자가 실패 근거와 수정 범위를 기록. |
| 실행 | `CORRECT → REVIEW / REVIEW_AND_AUDIT` | 현재 Lease·수정 범위 재검증과 새 evidence 제출. |
| 실행 | `REVIEW / REVIEW_AND_AUDIT → COMPLETE` | 필수 검증·독립 Gate 7 ACK. Gate 8 완료를 뜻하지 않음. |
| 실행 | `EXECUTE / CORRECT / REVIEW / REVIEW_AND_AUDIT → HANDOFF_READY` | checkpoint와 미완료 Gate, 다음 행동 기록. 기존 Lease는 아직 유효함. |
| 인계 | `HANDOFF_READY → 새 실행의 EXECUTE 또는 CORRECT` | 미완료 인계는 이전 Lease를 REVOKED로 종료·재읽기 후 새 Lease 발급. 완료 ACK가 있는 경우에만 RELEASED 사용. 기존 실행 ID를 재사용하지 않음. |
| REPORT | `PENDING → ACKED / REJECTED` | 지정 작업반장 writer가 근거와 다음 행동 기록. 수정 제출은 새 operation ID로 이전 REPORT를 참조함. |

- `CORRECT`, `REVIEW`, `REVIEW_AND_AUDIT`, `HANDOFF_READY`는 잠금 해제를 뜻하지 않는다. 유효한 underlying Lease의 자원 충돌을 계속 계산한다. 종료 Lease는 재활성화하지 않고 새 실행·Lease를 발급한다.
- 검수만 맡은 task는 별도 R sub-claim을 사용한다. 원 저자의 ACTIVE W 자원과 겹치면 R 검수도 시작하지 않는다. 고정 commit과 hash 검증된 evidence를 별도 immutable snapshot/worktree에 준비하고 서로 다른 checkout ID를 포함한 물리 key로 claim하거나, 작업반장이 원 W claim을 종료·축소하고 재읽은 뒤 R 검수를 발급한다. 공유 DB·공유 파일은 checkout이 달라도 동일 자원이므로 분리되지 않는다. 검수 도구가 cache·결과를 쓰면 별도 출력 경로의 W claim을 포함한다. 검수 중 수정이 필요하면 W claim을 먼저 받고 자신의 변경에 대한 독립 검수자는 별도로 지정한다.
- 알 수 없는 상태는 완료·해제로 추정하지 않는다. 해당 자원은 보수적으로 잠긴 것으로 취급하고 대사한다. REPORT의 requested action은 실행 권한이나 새 구현 요청으로 자동 변환하지 않는다.

## evidence 재사용

재사용 manifest는 다음을 포함한다. 비밀값은 저장하지 않는다.

- 저장소별 commit SHA, source tree hash, 미커밋 변경이 있으면 그 diff와 관련 untracked 입력의 digest
- catalog version, delta ID, 개별 evidence schema ID와 schema/validator hash
- fixture·DB schema/migration·공유 contract hash
- test 목록·실행 명령·설정 digest, runtime/도구 버전, OS/architecture, DB engine/version과 격리된 실행 환경 식별자
- execution profile/tier, 실행 시각, exit code, 결과와 로그 artifact의 digest

정렬·직렬화 방법과 hash 알고리즘을 manifest에 명시해 같은 입력으로 같은 key를 계산한다. 입력 key와 결과 artifact digest를 함께 검증한다. 필수 항목이 없거나 결과 파일이 없고, 실패·환경 불일치·영향 불명확이면 캐시 적중으로 처리하지 않고 해당 검증을 다시 수행한다. 검증된 기존 Gate를 일괄 FALSE로 내리지는 않는다.

commit이 다르면 자동 재사용하지 않는다. 관련 tree·의존성·입력이 동일함을 별도 호환성 검토로 입증한 경우에만 원본 evidence를 참조하는 새 연결 기록을 만든다. 기존 evidence의 SHA/schema/catalog는 수정하지 않는다. Gate 7 독립 ACK와 Gate 8 운영 승인은 test cache로 대신할 수 없다.
