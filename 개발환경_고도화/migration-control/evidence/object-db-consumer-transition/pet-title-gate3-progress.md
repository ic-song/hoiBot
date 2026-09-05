# WBS743 PET-TITLE Gate 3 진행 증거

- 기준 카탈로그: `SC-20260902-1`
- 상태: `PARTIAL_IMPLEMENTATION_NOT_CUTOVER`
- 운영 경로 활성화: 아니요
- 운영 DB/JSON 변경: 없음

## 소비자 재검증

- 기존 소비자: 19개
  - 관리자 명령 3
  - Rhino 명령 9
  - runtime dispatch 1
  - canonical repository SQL 메서드 6
- 신규 canonical 포트 소비자: 4개
  - `PetTitleCanonicalMutationProvider.create`
  - `PetTitleCanonicalReadProvider.listOwned`
  - `PetTitleCanonicalMutationProvider.select`
  - `PetTitleCanonicalMutationProvider.release`
- 현재 PET-TITLE primary 소비자: 24개
- 공용 CONTEXT-BRIDGE 소비자: 13개
- 전체 소비자 매니페스트: 1,104개
- 매니페스트 SHA-256: `d457fb7b4af2a3b39886b61c5e0bf8fa5b2bcdf54fdbdb5fe624074d64a1d63e`

## 구현된 경계

- 정의 이름과 기준 판매가는 `canonical_pet_title_definitions`에서 읽을 때 조인합니다.
- 개별 획득가격은 `canonical_owned_pet_title_instances.acquisition_price`에만 보존합니다.
- 목록 순서는 `acquisition_sequence`, `owned_pet_title_id`로 고정합니다.
- 선택·제거는 app-wiring mutation participant 안에서만 실행할 수 있습니다.
- 선택·제거는 `canonical_pet_title_operations` 영수증과 `canonical_pet_title_operation_participants` OWNER 행을 남깁니다.
- `/펫타이틀이름 [인자]` MODERN handler는 활성 계정 selection을 잠근 뒤 exact canonical ITEM 티켓을 1개 차감하고, 요청별 PET_TITLE 정의와 소유 occurrence를 생성합니다.
- 사용자 지정 타이틀은 표시명이 같아도 `appWiringOperationId`별 별도 정의 ID와 소유 ID를 생성합니다.
- 생성 결과의 typed PET_TITLE receipt/link, OWNER participant, legacy operation, command execution, Iris outbox, canonical claim 완료는 공용 mutation-reply transaction 하나에서 확정합니다.
- `/펫타이틀판매 [번호]` MODERN handler는 활성 계정 selection을 먼저 잠근 뒤 `world` scope와 참조 영지전을 순서대로 잠그고 공용 `resolveGuildTerritoryWarAuthority`로 단일 활성 권위를 판정합니다.
- READY/PENDING_START 판매는 stable occurrence의 소유 상태·선택, exact point 통화 잔액·operation·ledger, PET_TITLE SELL receipt/OWNER participant, command execution, Iris outbox, claim 완료를 한 transaction에서 확정합니다.
- ACTIVE_OPENING/ACTIVE_READY 판매는 타이틀·통화를 변경하지 않고 PET_TITLE no-op receipt/OWNER participant와 typed `NO_REPLY` execution만 저장하며 outbox 0건을 유지합니다.
- scope/war 누락과 active/lifecycle 모순은 player/title/currency 변경 전 fail-closed rollback합니다.
- 티켓 부족도 PET_TITLE no-op receipt와 동일 응답 outbox를 저장해 replay에서 재차감·재생성하지 않습니다.
- 기존 BIGINT 인스턴스와 전환 중 CHAR(8) 인스턴스는 사용자 응답에 노출하지 않습니다.
- `PetTitleAppWiringIngress`는 목록 self/target의 MODERN·SHADOW·REJECT 경계를 구현했고 `app.ts`의 실제 Iris 콜백에 연결했습니다.
- self MODERN은 canonical 조회와 Iris outbox를 원자 저장한 뒤 저장된 응답만 전송하며, target MODERN은 정확한 room/principal 권한 parity가 완성될 때까지 `LEGACY_FALLBACK`으로 고정합니다.
- `/펫타이틀 [번호]`는 활성 계정의 stable owned occurrence, 번호 오류, 미존재, 공성전 무응답 조건을 query-only SHADOW로 평가합니다. 실제 MODERN 선택은 mutation reply 원자성이 완성될 때까지 `LEGACY_FALLBACK`으로 고정합니다.
- PET-TITLE은 회원 컨텍스트 구현을 소유하지 않고, WBS746이 제공한 방/서버별 활성 계정 `PlayerContextPort`를 주입받습니다.
- 활성 계정 행이 존재하지만 호출자 포털 연결이 누락·불일치하면 레거시 계정으로 후퇴하지 않고 `PLAYER_CONTEXT_MAPPING_DRIFT`로 차단합니다.
- 포털에 연결된 게임계정은 인증되지 않은 방/서버에서 legacy crosswalk fallback 대상에서 제외하며, 해당 컨텍스트의 활성 계정 선택을 요구합니다.
- 대상 이름의 레거시 첫 4 UTF-16 code-unit 처리는 JavaScript `slice(0, 4)`에서 보존하고 SQL 문자열 절단으로 대체하지 않습니다.
- 공용 `runReadOnlyReply`는 canonical 조회, legacy operation, command execution, Iris outbox, canonical claim 완료를 하나의 controlled transaction으로 저장합니다.
- 응답 handler에는 query-only participant만 노출하며, 재실행은 저장된 outbox·operation·execution·fingerprint를 대사한 뒤 동일 outbox를 반환합니다.
- 공용 `runMutationReply`는 typed domain receipt/link, legacy operation, command execution, Iris outbox, canonical claim 완료를 하나의 controlled transaction으로 저장합니다.
- mutation 재실행은 typed receipt ID를 claim reference로 유지하고 app-wiring operation ID의 고유 reply graph를 대사해 동일 outbox만 반환합니다.
- mutation handler는 coordinator 소유 `operations`, `command_executions`, `outbox_messages`를 직접 변경할 수 없으며 중복 응답 outbox 생성을 transaction 안에서 차단합니다.
- mutation reply 재실행은 저장된 경로가 `MODERN/MUTATION`인지 콜백 전에 다시 검증합니다.
- 재시작 후 미전송 outbox는 기존 `OutboxWorker`의 pending/failed 재전송 경로를 사용합니다.

## 확인된 레거시 차이

- `/펫타이틀판매`는 레거시 코드에서 포인트를 메모리상 증가시키지만 `member.json` 저장 호출이 없습니다.
- canonical 판매 provider는 획득가격 우선 판매가와 `LEGACY_JSON/member.point/point` exact 통화 정의를 사용하고, 소유 상태 `sold`, 선택 해제, CURRENCY 잔액·operation·ledger, PET_TITLE SELL receipt/OWNER participant를 동일 app-wiring mutation transaction에 결합합니다.
- migration 471은 PET_TITLE SELL receipt와 CURRENCY operation 사이의 nullable exact FK를 추가하고 `PET_TITLE_SELL`을 SHADOW로 등록합니다. 단독 `release(status='sold')`는 계속 DB 접근 전에 거절합니다.
- WBS742 V2는 `canonical_item_definition_imports`의 `LEGACY_JSON/member.bag/펫타이틀권🦊(/펫타이틀이름)`과 `canonical_currency_definition_imports`의 `LEGACY_JSON/member.point/point` exact binding 계약을 제공합니다. 아직 실제 MariaDB 리허설·승인 적용 전이므로 생성·판매 MODERN rollout은 차단 상태입니다. 런타임 표시명 추론이나 임의 backfill은 사용하지 않습니다.
- 실제 `PetTitleAppWiringIngress.handle` → `dispatchPetTitleCommand` → `MariaPlayerContextProvider` → 판매 provider 경계에서 SHADOW legacy fallback·canonical DML 0건, selection→scope→war→player→owned title→currency 잠금 순서와 selection/war 경쟁 차단, replay-safe typed 무응답 claim, 무응답 outbox 0건, 강제 outbox 실패 전체 rollback을 격리 MariaDB에서 검증했습니다. rollout은 WBS742 V2 실제 이관 승인 전까지 SHADOW로 유지합니다.
- migration 471은 새 스키마 forward·재진입과 live SELL receipt rollback preflight, SELL receipt·연결 제거 후 rollback을 통과했습니다. MariaDB 12.2에서는 rollback 직후 동일 스키마에 재적용할 때 중복 복합 인덱스 최적화로 FK 재생성이 실패하므로, 기존 적용 migration은 수정하지 않고 clean schema re-forward로 검증했습니다.
- 현 스키마의 펫타이틀 선택은 `owned_pet_id`별이 아니라 플레이어별 1개 선택입니다.

## 검증

- 계정/플랫폼 및 PlayerContext 집중 테스트: 38/38 통과
- PET-TITLE 및 READ_ONLY app-wiring 집중 테스트: 35/35 통과
- PET-TITLE 생성·동일명 분리·티켓 부족·활성계정 잠금 집중 테스트: 19/19 통과
- PET-TITLE 판매 가격·minor-unit·원자 CURRENCY 결합·no-op receipt·정확 명령 guard와 WBS742 V1/V2 회귀를 포함한 현재 집중 묶음: 87/87 통과
- 실제 앱 통합 테스트: 41/41 통과
- READ_ONLY reply 원자성 테스트: 5/5 통과(정상 저장·동일 outbox replay·outbox 실패 전체 rollback·query-only 차단·commit 결과 불명 복구·payload drift 차단)
- MUTATION reply 원자성 테스트: 10/10 통과(정상 저장·동일 outbox replay·4개 실패 지점 전체 rollback·commit 결과 불명 복구·payload/typed reference drift 차단·중복 outbox 차단·legacy replay 차단)
- PET-TITLE 판매 앱 진입·공용 권위·잠금 순서·READY/PENDING_START·ACTIVE_OPENING/ACTIVE_READY·typed NO_REPLY 집중 테스트: 27/27 통과
- PET-TITLE 판매 격리 MariaDB: prepare 1/1, 재시작·rollback·clean re-forward 1/1 통과(실제 ingress/dispatcher/PlayerContext, SHADOW legacy fallback·DML 0, selection/war 잠금 경쟁, READY 즉시 replay handler 0, silent 즉시·재시작 replay handler 0·outbox 0·동일 typed receipt link, 중복 적립 0, 강제 outbox 실패 전롤백, 3306 불변, 3324·임시 DB 정리)
- 소비자 안정 ID 계약 테스트: 5/5 통과
- 소비자 재도출·runtime boundary·production adoption audit 계약: 54/54 통과
- 오브젝트 데이터 모델 계약 검사: 등록 대상 94개, 통과
- 전체 runtime 회귀: 2,147개 중 2,139 통과, 실패 0, 환경 의존 8개 건너뜀
- TypeScript typecheck: 통과
- JSON 계약 파싱: 14/14 통과
- `git diff --check`: 통과(줄바꿈 경고만 존재)
- 운영 데이터 변경 확인: 없음

## 남은 범위

- WBS746 공용 PlayerContextPort 구현을 주입한 self/target 통합: 완료
- PET_TITLE ingress의 `app.ts` 연결, 요청-local 전송 및 재시작 outbox worker 경계: 완료
- target 목록의 레거시 room/principal 권한을 안정 식별자로 확정한 authority provider 연결
- 사용자 생성과 ITEM 티켓 차감을 한 트랜잭션으로 연결: 구현·합성 검증 완료, V2 exact ticket import의 실제 MariaDB 리허설 전이라 rollout 차단
- 판매와 CURRENCY 포인트 지급을 한 트랜잭션으로 연결: provider·ingress·스키마·합성 및 격리 MariaDB 검증 완료, 등록 rollout은 SHADOW 유지
- 관리자 add/sync/reset의 canonical owner-graph 전환
- sync/reset용 batch/global operation receipt additive migration
- isolated MariaDB replay·payload drift·rollback·restart 검증
- Gate 6/7 및 운영 cutover
