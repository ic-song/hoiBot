# WBS743 PET-TITLE Gate 3·4 진행 증거

- 기준 카탈로그: `SC-20260902-1`
- 상태: `IMPLEMENTED_AWAITING_INDEPENDENT_REREVIEW_NOT_CUTOVER`
- 운영 경로 활성화: 아니요
- 운영 DB/JSON 변경: 없음
- 전체 소비자 매니페스트: 1,108개
- 매니페스트 SHA-256: `a3ba6e7a7a49b6107b5fb3d609aff71567e0fa0e78b574a9cb108e519255612e`

## 사용자 PET-TITLE 경계

- 정의 이름과 기준 판매가는 `canonical_pet_title_definitions`, 개별 획득가격은 `canonical_owned_pet_title_instances.acquisition_price`에서만 읽습니다.
- 목록 순서는 `acquisition_sequence`, `owned_pet_title_id`로 고정합니다.
- `/펫타이틀이름`은 활성 계정을 잠근 뒤 exact canonical ITEM 티켓 차감, 사용자 정의 PET_TITLE 생성, 소유 occurrence 생성, typed receipt/link, OWNER participant, command execution, Iris outbox, canonical claim 완료를 공용 mutation-reply transaction 하나에서 확정합니다.
- `/펫타이틀판매`는 `PET_TITLE` 전역 scope, 방/서버 활성 계정 selection, 참조 영지전, canonical player, stable owned title, exact CURRENCY 순서로 잠급니다. READY/PENDING_START는 판매 대금과 소유 상태를 원자 반영하고 ACTIVE_OPENING/ACTIVE_READY는 typed `NO_REPLY` receipt만 저장합니다.
- scope/war 누락, 권위 모순, mapping drift는 첫 player/title/currency 변경 전에 fail-closed rollback합니다.
- 재실행은 저장된 receipt/link, operation, execution, outbox, payload fingerprint를 대사하고 동일 결과만 반환합니다.
- PET-TITLE은 회원 컨텍스트를 소유하지 않으며 WBS746의 방/서버별 활성 계정 `PlayerContextPort`를 주입받습니다. 포털 연결이 있는 계정은 인증되지 않은 컨텍스트에서 legacy crosswalk로 후퇴하지 않습니다.

## 관리자 add/reset 배치 경계

- `ADMIN_PET_TITLE_ADD`와 `ADMIN_PET_TITLE_RESET`은 실제 Iris 관리자 진입점에서 app-wiring으로 연결했습니다.
- 관리자 add는 정확한 canonical player와 정의를 잠그고 소유 occurrence를 추가합니다.
- 관리자 reset은 `PET_TITLE` 전역 잠금 뒤 대상 player·owned occurrence를 정렬 잠금하고 선택 상태를 포함한 owner graph를 일괄 초기화합니다.
- batch header, `player_id → acquisition_sequence → owned_pet_title_id` 순서의 exact target 집합, target-set fingerprint, player별 participant, result fingerprint를 동일 transaction에 저장합니다.
- 재시작 replay는 저장된 child target의 획득 순번·선택 상태·reason과 participant의 role·수량을 다시 잠가 cardinality와 fingerprint를 재구성합니다. child evidence 변조나 결과 drift는 `TARGET/PARTICIPANT/RESULT_DRIFT`로 차단하고 handler를 재호출하지 않습니다.
- migration 472는 global lock, batch operation, target, participant 네 테이블과 typed receipt link를 additive 생성합니다. `lock_version`은 seed에서 명시하고 스키마 default를 두지 않습니다.
- 잠금 순서는 `PET_TITLE` 전역 scope → 방/서버 활성 계정 selection → canonical player → owned PET_TITLE입니다.

## legacy fallback과 단일 writer 경계

- 이 TypeScript/Fastify runtime은 Iris·MariaDB 전환 검증 서버이며 기존 MessengerBot R `main.js`/`Info.js` 실행 경로를 대체하지 않습니다.
- `LEGACY`와 `SHADOW`에서 관리자 add/reset은 Node claim·mutation runner에 진입하지 않고 `LEGACY_FALLBACK`을 반환합니다. Node business table, typed receipt, command execution, outbox DML은 0건이며 Node 응답도 생성하지 않습니다. 따라서 외부 Rhino 경로만 legacy writer입니다.
- `ADMIN_PET_TITLE_SYNC`는 WBS746의 선택 context·super_admin 호출 권위와 전역 active-member authority snapshot을 같은 transaction에서 확인한 뒤에만 `MODERN` mutation을 실행합니다. SHADOW/LEGACY 경로는 business/receipt/outbox DML을 수행하지 않습니다.
- SYNC용 schema/replay validator는 향후 승격을 위해 `ADMIN_SYNC` evidence를 해석할 수 있지만 현재 runtime은 이를 실행하지 않습니다.
- MODERN 승격은 WBS746 authority 주입, 독립 재검토, Gate 6/7 검증 뒤에만 가능합니다.

## 최신 검증 증거

- additive migration 계약: 11/11 통과
- 오브젝트 데이터 모델 계약: 23/23 통과, 등록 테이블 98개
- 관리자/PET-TITLE app-wiring 집중 테스트: 25/25 통과
- 격리 MariaDB `hoibot_wbs743_it3`: migration 001~472 forward 460건, 재적용 460건, migration 472 단일 적용, 관리자 통합 2/2 통과
- 격리 MariaDB `hoibot_wbs743_it5`: current migration 001~472 clean forward 460건, 다중 target 관리자 통합 2/2 통과
- MariaDB 테스트는 실행별 고유 fixture ID, 전용 DB 이름 guard, 비-fixture 활성 소유권 보호, rollout 원상복구를 적용했습니다.
- 다중 target의 선택 상태·reason 변조 및 participant 수량 변조 후 restart replay 차단, 잘못된 participant role의 DB CHECK 차단, 복원 후 동일 replay 성공, global-lock 경쟁 직렬화를 실제 MariaDB에서 확인했습니다.
- durable batch receipt가 있는 current-schema `hoibot_wbs743_it5`에서는 rollback 472가 DDL 전에 오류로 차단되고 네 테이블과 링크 컬럼이 그대로 유지됨을 확인했습니다.
- 빈 전용 `hoibot_wbs743_rollback472b`에서는 current rollback 472가 성공해 네 테이블과 typed link 컬럼을 제거했고, migration 기록을 전용 DB에서만 정리한 뒤 migration 472 clean re-forward가 460건 및 `acquisition_sequence` 포함 상태로 복구됨을 확인했습니다.
- TypeScript typecheck: 통과
- TypeScript build: 통과
- `object-data:validate`: 통과
- 소비자 매니페스트 재생성: 1,108개, 현재 해시와 일치
- 전체 runtime 회귀: 2,155개 중 2,147 통과, 실패 0, 환경 의존 8개 건너뜀

## 남은 범위

- 총괄 운영자의 독립 재검토 및 P1 해소 판정
- WBS746 active-member authority 연결과 `ADMIN_PET_TITLE_SYNC` MODERN 구현은 Gate 5~7 증거에서 검증
- Gate 5~7 및 운영 cutover

현재 변경은 격리 개발 worktree와 테스트 DB에서 검증한 뒤 `15abb95203e7eb375c9f0bd4294a0ec7100aa1a6`로 커밋·push되어 origin exact·clean을 확인했습니다. `feature/prod`에는 반영하지 않았습니다.
