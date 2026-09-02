# WBS739 패키지·보상 Gate 1~4 검증

- catalog: `SC-20260902-1`
- slice: `SL-OBJECT-DB-PACKAGE-REWARD-01`
- execution: `패키지보상DB-SL-OBJECT-DB-PACKAGE-REWARD-01-202609030246`
- baseline: `1e25f0d1a0bedd0d0f2a73f74f947dd4f58cb273`

## Gate 1 현행 조사

- 검색어: `package`, `패키지`, `reward`, `보상`, `package_catalog`, `package_item_definitions`, `package_rewards`, `package_reward_rules`, `asset_package_reward_target_occurrences`, `object_registry`, `quarantine`
- 확인 파일: `main.js`, `COMMAND_INDEX.md`, `COMMAND_REGISTRY.md`, runtime `src/package/*`, migrations `035`~`440`, package 관련 tests
- 확인 결과: 레거시 Rhino 가방은 정확한 표시명을 key로 보유하며, runtime에는 `package_catalog`, `package_item_definitions`, `package_rewards`, `package_reward_rules`와 typed-target freeze가 공존한다.
- 중복 위험: 동일 패키지 정의가 레거시 가방 문자열, runtime package catalog, package item compatibility, object registry에 중복 표현된다. 신규 canonical 모델은 이를 수정하지 않고 source 호환 입력으로만 취급한다.
- 미확인: 모든 운영 패키지 명령의 Gate 6 소비자 parity와 실제 운영 데이터 import는 이 Gate 범위가 아니다.

## Gate 2 DB 매핑

- migration `451_canonical_package_reward.sql`에 정의/import/group/entry/item target/nested package target/quarantine/replay 8개 테이블을 추가했다.
- 모든 신규 PK/FK는 의미형 `CHAR(8) ascii_bin`이며 단독 `id`와 오브젝트 `CODE`가 없다.
- reward group이 source package를 한 번 참조하고 entry가 전체 reward order를 유일하게 만든다. typed detail은 `item_id` 또는 nested `package_id` FK로 분리했다.
- unresolved target은 가짜 FK로 합치지 않고 exact source identifier/display name/reason과 함께 quarantine한다.
- gap이 하나라도 남은 패키지는 repository가 정의와 reward group을 비활성으로 저장해 소비를 fail-closed한다.
- 모든 테이블에 감사 4컬럼과 KST 19자리 24시간 CHECK가 있다.

## Gate 3 합성 데이터

- `canonical-package-reward-v1.json`은 `다이아상자💎(/다이아상자오픈)` 원문 이름, item target 1건, nested package target 1건, gap target 1건을 포함한다.
- 운영 JSON과 운영 DB는 읽거나 수정하지 않았다.

## Gate 4 구현·검증

- repository는 source import 및 request replay fingerprint를 분리한다. replay fingerprint에는 `source_system`, `source_namespace`, `source_identifier`가 모두 포함되므로 동일 request key에서 source identifier만 바뀌어도 쓰기 전에 `REQUEST_PAYLOAD_CONFLICT`로 fail-closed한다.
- reward entry마다 item/package/quarantine detail이 정확히 1건인지 commit 전에 transaction 내부에서 대사한다.
- weighted probability는 DECIMAL(12,10)을 고정 10자리 `BigInt`로 계산해 합계 `10^10`을 정확 비교하며 지수표기·초과 소수·비정규 표기를 거부한다.
- nested package는 self-reference, recursive cycle, 총 깊이 8 초과를 fail-closed 처리한다. 총 깊이 8은 허용하고 9부터 거부한다.
- request key는 repository·migration·contract manifest 모두 공통 182자 경계를 사용하며 182자는 허용하고 183자는 쓰기 전에 거부한다. deadlock/lock-timeout은 최대 3회 transaction retry한다.
- `object-data:validate`: 48 tables PASS
- `typecheck`, `build`: PASS
- focused tests: 신규·계약·기존 typed-target parity 25/25 PASS (독립 리뷰 보완 후 재실행)
- MariaDB 11.4 fresh migration: 439 migrations, migration451/replay PASS
- MariaDB repository: typed entries 3, item 1, nested 1, quarantine 1, replay 1; 동일 요청 재실행은 동일 operation/package 반환
- MariaDB recursive CTE + `FOR UPDATE`: nested import 실행 PASS
- MariaDB 11.4 recursive CTE + `FOR UPDATE` 깊이 경계: 총 depth 8 허용, 9 거부 PASS
- MariaDB gap import: 요청이 active여도 canonical `active_flag=0` 확인
- MariaDB constraint negatives: duplicate reward order `ER_DUP_ENTRY`, package ID를 item FK에 삽입 `ER_NO_REFERENCED_ROW_2`, `25:00:00` 감사시각 `ER_CONSTRAINT_FAILED`

## 잔여 Gate 5~7

- Gate 5: 중앙 integration cherry-pick·전체 migration replay·전체 regression이 필요하다. repository 경로는 XOR을 원자 대사하지만, DB 외부 직접 쓰기만으로는 entry의 exactly-one detail을 완전 강제하지 못하므로 통합 단계에서 권한/trigger 또는 다른 제약 설계를 검토한다.
- Gate 6: 레거시 `package_catalog/package_item/object_registry` 소비자와 canonical 조회·개봉 결과 parity가 필요하다.
- Gate 7: Shadow read/compare, restart replay, quarantine 수렴 검증이 필요하다.
- Gate 8 및 운영 DB, `feature/prod`, push는 수행하지 않았다.
