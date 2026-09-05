# WBS743 PET-TITLE Gate 3~7 증분 증거

- 기준 카탈로그: `SC-20260902-1`
- 상태: `PET_TITLE_ADMIN_SYNC_CONSUMER_FINAL_REVIEW_READY_NOT_CUTOVER`
- 운영 경로 활성화: 아니요
- 운영 DB/JSON 변경: 없음
- 전체 소비자 매니페스트: 1,111개
- 매니페스트 SHA-256: `aa543be346efc6916c66c2867a3904dfd39c09409eb9cfa71f3219fee1dab6e0`

## Gate 5 통합 기준

- 기준 카탈로그와 계약 형식은 `SC-20260902-1`, `hoibot-object-db-consumer-transition-v1`, `hoibot-object-db-transition-runtime-boundary-v1`입니다.
- WBS743 선행 checkpoint `15abb95203e7eb375c9f0bd4294a0ec7100aa1a6`에 WBS746 권위 checkpoint `6fa79f613876ffb494e056175f098e528f2c24a3`를 fast-forward로 통합했습니다.
- 공용 app-wiring migration `461~466`과 PET_TITLE migration `471~472`, 계정 권위 mutex migration `473`, 표시명 snapshot migration `474`를 하나의 검증 묶음으로 고정했습니다.
- migration SHA-256은 `461=26dfe93d7fc020f48ae9a6d8555e694786bdb75b5cf7fefcb922757b23120736`, `462=739bcf98faf68eb8b300c8760a28950e1d832557f159f9e02bfe8538e8faab57`, `463=09149b60389f779e210ec4d572897641d24f0f4bd16363d8564c5e5930adf3f8`, `464=e824fb900f93323b4a457a117f2f5c432c049cb921f3df670223a764cd426001`, `465=f045d174b769d64acd88522a90244e822d3698645f1596461b0618d967c98430`, `466=73cf9ab51392ed0ed25c8cae32ae0a2d823bd7cd4a89a3355c35ae7823bb2609`, `471=e00e128170babae9daa02fcf8dd35161a261387da1bc584ce274933ae7ff692b`, `472=28d303c8abe1b152b6afaa9ed44f3b5a75c262cbdf898398a284d4a3ed7eb3af`, `473=8109127520b5d890585fd05b0a8d2a0d8398042206b895e568fdaa2f1b7349bf`, `474=ef8ee367fa603d4a5b8ec909d17892d974f605a03df9fec318c758c2cd45322c`이며 `474 rollback=ce5b2f5dfad57eae654260a45dc9050197f108c7d6ae3e3d6ed3b088257a21e2`입니다.
- 공용 provider `180e20c41b03246059d198301016794869d5266c`와 모호성·manifest 보정 provider `59181fbb0a4c6ebf8bf58758a5df5368b39381d8`를 소비자 branch에 fast-forward 통합했습니다.
- `ADMIN_PET_TITLE_SYNC` 잠금 순서는 `ACCOUNT_AUTHORITY` mutex → `PET_TITLE` mutex → 호출자 room context/super_admin → 전역 회원 권위 행 → canonical player/owned title 행입니다.

## 사용자 PET-TITLE 경계

- 정의 이름과 기준 판매가는 `canonical_pet_title_definitions`, 개별 획득가격은 `canonical_owned_pet_title_instances.acquisition_price`에서만 읽습니다.
- 목록 순서는 `acquisition_sequence`, `owned_pet_title_id`로 고정합니다.
- `/펫타이틀이름`은 활성 계정을 잠근 뒤 exact canonical ITEM 티켓 차감, 사용자 정의 PET_TITLE 생성, 소유 occurrence 생성, typed receipt/link, OWNER participant, command execution, Iris outbox, canonical claim 완료를 공용 mutation-reply transaction 하나에서 확정합니다.
- `/펫타이틀판매`는 `PET_TITLE` 전역 scope, 방/서버 활성 계정 selection, 참조 영지전, canonical player, stable owned title, exact CURRENCY 순서로 잠급니다. READY/PENDING_START는 판매 대금과 소유 상태를 원자 반영하고 ACTIVE_OPENING/ACTIVE_READY는 typed `NO_REPLY` receipt만 저장합니다.
- scope/war 누락, 권위 모순, mapping drift는 첫 player/title/currency 변경 전에 fail-closed rollback합니다.
- 재실행은 저장된 receipt/link, operation, execution, outbox, payload fingerprint를 대사하고 동일 결과만 반환합니다.
- PET-TITLE은 회원 컨텍스트를 소유하지 않으며 WBS746의 방/서버별 활성 계정 `PlayerContextPort`를 주입받습니다. 포털 연결이 있는 계정은 인증되지 않은 컨텍스트에서 legacy crosswalk로 후퇴하지 않습니다.

## 관리자 add/reset 배치 경계

- `ADMIN_PET_TITLE_ADD`와 `ADMIN_PET_TITLE_STORE_RESET`은 실제 Iris 관리자 진입점에서 app-wiring으로 연결했습니다.
- 관리자 add는 정확한 canonical player와 정의를 잠그고 소유 occurrence를 추가합니다.
- 관리자 reset은 `PET_TITLE` 전역 잠금 뒤 대상 player·owned occurrence를 정렬 잠금하고 선택 상태를 포함한 owner graph를 일괄 초기화합니다.
- 관리자 sync는 제거 대상별 `member_key_before`와 `MEMBER_KEY_V1` 계약을 batch target/header에 저장하고, 응답·target-set·result fingerprint를 같은 transaction에서 고정합니다. reset은 `RESET_V1`과 nullable snapshot을 사용해 기존 고정 응답을 유지합니다.
- batch header, `player_id → acquisition_sequence → owned_pet_title_id` 순서의 exact target 집합, target-set fingerprint, player별 participant, result fingerprint를 동일 transaction에 저장합니다.
- 재시작 replay는 저장된 child target의 획득 순번·선택 상태·reason과 participant의 role·수량을 다시 잠가 cardinality와 fingerprint를 재구성합니다. child evidence 변조나 결과 drift는 `TARGET/PARTICIPANT/RESULT_DRIFT`로 차단하고 handler를 재호출하지 않습니다.
- migration 472는 global lock, batch operation, target, participant 네 테이블과 typed receipt link를 additive 생성합니다. `lock_version`은 seed에서 명시하고 스키마 default를 두지 않습니다.
- 잠금 순서는 `PET_TITLE` 전역 scope → 방/서버 활성 계정 selection → canonical player → owned PET_TITLE입니다.

## legacy fallback과 단일 writer 경계

- 이 TypeScript/Fastify runtime은 Iris·MariaDB 전환 검증 서버이며 기존 MessengerBot R `main.js`/`Info.js` 실행 경로를 대체하지 않습니다.
- `LEGACY`와 `SHADOW`에서 관리자 add/reset은 Node claim·mutation runner에 진입하지 않고 `LEGACY_FALLBACK`을 반환합니다. Node business table, typed receipt, command execution, outbox DML은 0건이며 Node 응답도 생성하지 않습니다. 따라서 외부 Rhino 경로만 legacy writer입니다.
- `ADMIN_PET_TITLE_SYNC`는 WBS746의 선택 context·super_admin 호출 권위와 전역 active-member authority snapshot을 같은 transaction에서 확인한 뒤에만 `MODERN` mutation을 실행합니다. SHADOW/LEGACY 경로는 business/receipt/outbox DML을 수행하지 않습니다.
- `MODERN`에서는 actual Iris ingress가 `ADMIN_SYNC` batch mutation, typed receipt, command execution과 outbox 예약을 하나의 controlled transaction에서 실행합니다. 같은 event replay는 저장된 target·participant·result fingerprint를 대사하고 handler를 다시 호출하지 않습니다.
- 이 증거는 개발·Shadow 검증이며 운영 rollout 승격이나 기존 MessengerBot R writer 중단을 뜻하지 않습니다.

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
- 소비자 매니페스트 재생성: 1,111개, SHA-256 `669c0f3926735f2cbc26d9643c3465574722973b250cb78a9fe077f875d61826`
- WBS746 통합 집중 검증: active-member authority, account mutex schema, account switch/context, admin ingress, canonical mutation 통과
- 격리 MariaDB `hoibot_wbs743_it746g5`: migration 001~473 총 461개 적용, `pet-title-admin-batch-app-wiring-mariadb.integration.test.ts` 3/3 통과, 실패 0, 8.797초
- MariaDB에서 SHADOW business/receipt/outbox DML 0, authority·child evidence drift fail-closed rollback, restart replay, PET_TITLE/ACCOUNT_AUTHORITY mutex 대기, 실제 `/계정변경` writer와 sync 병렬 완료, 활성 REPRESENTATIVE/SUB 보존과 비활성 owner만 제거를 확인했습니다.
- 전체 runtime 회귀 1회: 2,165개 중 2,156 통과, 환경 의존 8개 건너뜀, 실패 1건은 이전 consumer 고정 수치 `1,108/4`와 현재 `1,111/7`의 차이뿐이었습니다. 숫자 계약만 현행화한 뒤 실패 파일을 독립 재실행해 5/5 통과했습니다.
- 최종 checkpoint `6fa79f613876ffb494e056175f098e528f2c24a3`에서 합성·계약 근거를 고정했고 WBS746 독립 정적 리뷰는 P0/P1 0건입니다. 이 문서 현행화 때문에 전체 suite를 중복 실행하지 않습니다.
- WBS743 재개 독립 검증: 계정 권위·schema·계정변경·ADMIN ingress·canonical mutation·consumer 계약·stable ID 표적 테스트 50/50 통과, typecheck·build·오브젝트 데이터 모델 98개 검증 통과, 정적 재검토 P0/P1 0건입니다.
- provider 통합 후 소비자 집중 검증: legacy sync/reset, account authority/context, ADMIN ingress, batch receipt/replay, additive schema와 오브젝트 모델을 합쳐 118/118 통과했습니다.
- 전용 MariaDB `hoibot_wbs743_it6_consumer`에서 migration `001~474` 총 462개 적용 후 ADMIN batch 통합 3/3을 통과했습니다. SHADOW DML 0, target/participant/result drift fail-closed, rename 뒤 새 composition root replay 원응답·outbox 불변, account-authority mutex, RESET `RESET_V1`, rollback guard를 확인했고 종료 후 전용 schema 잔존은 0입니다.
- 보정 provider 통합 후 표적 계약은 55/55, TypeScript typecheck·build, 오브젝트 데이터 모델 등록 테이블 98개 검증을 통과했습니다.
- 전용 MariaDB `hoibot_wbs743_it7_consumer_1800`에서 migration `001~474` 총 462개를 적용하고 ADMIN batch 통합 3/3을 통과했습니다. profile 부재 linked identity의 distinct 이름 `0=UNRESOLVED`, `1=snapshot`, `>1=AMBIGUOUS`를 migration/runtime에서 같은 계약으로 확인했고 SHADOW DML 0, child fingerprint drift 차단, restart replay, RESET 직렬화, 활성 REPRESENTATIVE/SUB 보존을 재검증했습니다. 종료 후 전용 schema 잔존은 0입니다.
- 소비자 매니페스트는 1,111개 stable ID 추가·삭제 0이며 `adminSync`와 `adminReset`의 `operationReceiptTables`는 모두 `canonical_pet_title_batch_operations`입니다. 새 SHA-256은 `aa543be346efc6916c66c2867a3904dfd39c09409eb9cfa71f3219fee1dab6e0`입니다.
- 전체 runtime suite는 이 checkpoint에서 정확히 1회 실행했습니다. 2,169개 중 2,160개 통과, 환경 의존 8개 건너뜀, 실패 1개는 `object-db-transition-runtime-boundary.v1.json`의 provider source SHA 두 값이 이전 checkpoint에 머문 증적 drift였습니다. canonical-LF SHA `d55f0a2a…`와 `ef6a1c91…`로 최소 현행화한 뒤 실패 파일만 재실행해 7/7 통과했으며 전체 suite는 반복하지 않았습니다.

## Gate 6 parity와 Gate 7 Shadow

- 활성 회원의 canonical PET_TITLE occurrence는 보존하고 명시적 inactive/deleted 회원의 occurrence만 제거하는 레거시 핵심 의미를 유지합니다.
- 레거시와 MODERN 모두 제거 회원의 닉네임 목록을 출력합니다. MODERN은 제거 시점 `member_key_before`를 typed batch receipt·target/result fingerprint와 outbox 응답에 고정하므로 이후 프로필명이 변경되어도 재시작 replay에서 최초 응답을 그대로 반환합니다.
- player/profile 유실, crosswalk 역매핑 중복, portal 연결 모순은 임의 삭제로 보정하지 않고 첫 title mutation 전에 전체 실패합니다.
- 별도 event 두 건은 별도 claim으로 실행하고 같은 event·payload는 terminal receipt를 재생합니다. 같은 키의 payload drift는 실패하며 outbox 재시도는 게임 mutation을 다시 실행하지 않습니다.
- SHADOW/LEGACY는 authority snapshot과 canonical title mutation에 진입하지 않고 business/receipt/command execution/outbox DML 및 외부 응답을 모두 0건으로 유지합니다.
- actual ingress, mutation provider와 authority provider는 도메인 모듈에 있고 `app.ts` 대규모 재구성이나 Rhino `main.js`/`Info.js` 변경은 하지 않았습니다.

## 고도화_보완기준 대사

| 기준 | 판정 | 근거 |
| --- | --- | --- |
| `BC-01` | 충족 | provider `180e20c4`+보정 `59181fbb`, migration `461~474` checksum, 계약 형식, manifest `aa543be3…`, 전용 MariaDB 묶음 |
| `BC-02` | 충족 | Kakao room `ACTIVE_CONTEXT`, 단일 `super_admin`, 고정 active-member authority와 mapping drift 차단 |
| `BC-03` | 충족 | authority/title 잠금, ownership·batch target/participant·typed receipt·execution·outbox 단일 transaction과 실패 rollback |
| `BC-04` | 충족(현행 유지) | 별도 event/동일 event replay/payload drift/outbox retry 분리; 미확정 재전송 정책은 변경하지 않음 |
| `BC-05` | 충족 | SHADOW/LEGACY authority·business·receipt·outbox DML 및 send 0; 전용 MariaDB 전후 count 동일 |
| `BC-07` | 충족 | 표시명 snapshot·batch 계약은 도메인/provider에 두고 ADMIN ingress는 legacy 동일 응답 조립만 담당 |
| `BC-08` | 충족 | 최신 결정·schema 계약·현재 코드·WBS746 checkpoint·보정 provider·manifest와 runtime-boundary를 exact SHA로 연결 |
| `BC-09` | 충족(격리 범위) | authority/schema/drift 실패는 FAILED claim과 무업무 DML로 식별되며 outbox 재실행은 terminal receipt와 분리; 운영 readiness는 Gate 8로 유보 |

## 남은 범위

- 이 소비자 checkpoint의 독립 최종 리뷰와 Gate 7 ACK
- WBS743의 나머지 소비자 inventory·전환 범위
- Gate 8 운영 준비와 cutover

현재 통합 기준은 WBS746 `6fa79f613876ffb494e056175f098e528f2c24a3`, provider `180e20c41b03246059d198301016794869d5266c`, 보정 provider `59181fbb0a4c6ebf8bf58758a5df5368b39381d8`입니다. 이전 독립 검토의 P1 두 건은 보정 provider와 소비자 재검증으로 해소했고 P2 명령 코드는 `ADMIN_PET_TITLE_STORE_RESET`으로 바로잡았습니다. 최종 commit·push는 독립 최종 리뷰 전까지 보류합니다. 운영 DB/JSON, 실운영방과 `feature/prod`에는 접근하거나 반영하지 않았습니다.
