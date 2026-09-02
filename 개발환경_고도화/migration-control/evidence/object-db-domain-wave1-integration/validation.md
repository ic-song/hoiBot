# 오브젝트 DB화 Wave 1 중앙 통합 검증

- 검증일: 2026-09-03 KST
- 기준선: `47d84abde86c9aeca06fa8698c4cdc0f5ce70823`
- 통합 브랜치: `codex/object-db-domain-wave1-integration-v1-20260903`
- 대상: WBS733 아이템·가방, WBS734 가구·홈, WBS735 펫·장비, WBS736 미니펫, WBS737 타이틀 3종, WBS738 펫스킬, WBS739 패키지·보상, WBS740 재화·원장, WBS741 건물·조합의 Gate 1~4 산출물
- 운영 영향: 없음. 운영 DB와 운영 배포는 사용하지 않았다.

## 통합 범위

- migration `443`부터 `453`까지 중앙 manifest에 직렬 등록했다. 패키지 `451`, 재화 `452`, 건물·조합 `453`의 의존 순서를 유지한다.
- 공용 사용자 PK는 `canonical_players.player_id` 하나만 사용한다.
- 계약 등록 대상은 65개 테이블이며 각 테이블에 `INSERT_USER`, `INSERT_TIME`, `UPDATE_USER`, `UPDATE_TIME`을 둔다.
- 정의값과 사용자 보유값을 분리하고, 가구 매력은 정의의 기본값·강화 증가값과 보유 인스턴스의 강화 단계로 계산한다.
- 펫스킬은 정의·수량 보유 stack·펫별 장착·operation replay를 분리하고 DB에는 실행 코드 대신 검증된 `handler_key`와 `options_json`만 저장한다.
- 패키지는 정의·보상 그룹·보상 entry·typed item/nested-package 대상·격리·replay를 분리하고, 재화는 정의·사용자별 minor-unit 잔액·operation·append ledger를 분리한다.
- 건물·조합은 건물 정의와 recipe 정의, typed item/currency 입력·출력, 건물 연결, 실행 operation, item/currency ledger를 분리한다.

## 실제 MariaDB 검증

격리된 일회용 `mariadb:11.4` 컨테이너와 빈 DB에서 수행했다.

- 전체 migration 적용: 성공, migration count `441`
- 같은 DB에 migration 재실행: 성공, migration count `441`
- 등록 대상 테이블: `65/65`; 누락 `0`
- 필수 감사 컬럼: `260/260`; 테이블별 4개 불일치 `0`
- 등록 대상 FK: `35`; FK 원본·참조 컬럼 타입/문자셋/collation 불일치 `0`
- 다른 사용자의 장비를 펫에 장착하는 교차 소유 INSERT: FK `fk_canonical_owned_pet_equipment_equipment`로 거부
- `2026-09-03 25:00:00` 감사시간 INSERT: CHECK `chk_object_furniture_market_insert_time`으로 거부
- 취소된 가구 매물 이력을 보존한 뒤 같은 가구를 재등록: 성공, 과거 `cancelled` 1건과 현재 `active` 1건 확인
- 같은 가구의 두 번째 활성 매물 transaction: UNIQUE `uq_object_furniture_active_market_owned`로 거부되고 신규 이력도 rollback
- 445 활성 매물 seed 후 450 적용: 기존 활성 관계가 1:1 backfill되고 재실행 후 동일 상태 유지
- 다른 가구의 매물 ID와 보유 가구 ID를 섞은 활성 관계: 복합 FK `fk_object_furniture_active_market_pair`로 거부; 정확한 쌍은 허용
- 다른 사용자가 보유한 일반 타이틀 인스턴스를 선택: 복합 FK `fk_canonical_member_title_selection_owned`로 거부
- 다른 사용자의 보유 펫에 펫스킬을 장착: 복합 FK `fk_canonical_pet_skill_equipment_pet`로 거부; 정확한 소유자 조합은 허용
- 잘못된 JSON을 가진 펫스킬 정의 INSERT: MariaDB JSON CHECK로 거부
- 재화 operation에 다른 사용자·다른 재화의 balance를 연결한 INSERT: 복합 FK로 거부
- 건물 조합 item ledger에 다른 사용자의 item stack을 연결한 INSERT: 복합 FK `fk_canonical_craft_item_ledger_stack_owner_target`로 거부
- migration `453` 재실행: 추가 적용 없이 migration count `441` 유지

## 코드 검증

- `npm run object-data:validate`: 성공, 등록 대상 65개
- `npm run typecheck`: 성공
- `npm run build`: 성공
- Wave 1 집중 테스트: `41/41` 성공
- 가구 최종 동시성·생명주기 집중 테스트: `26/26` 성공
- 펫스킬 독립 검토 집중 테스트: `29/29` 성공; 기존 펫스킬 전체 테스트 `83/83` 성공
- 패키지·재화·건물/조합 중앙 집중 테스트: `52/52` 성공
- 레거시 동결 경계 보정 집중 테스트: `14/14` 성공
- 확정 HEAD 중앙 통합 전체 회귀 테스트: `1717`개 중 `1709` 성공, 실패 `0`, 환경 의존 `8`개 skip
- `main.js`, `Info.js` Node 구문 검사: 성공
- `git diff --check`: 성공

가구 replay INSERT는 PK 충돌만 새 CUID2 후보로 재시도하고, 업무 UNIQUE 충돌은 transaction rollback 후 완료 replay 재조회로 수렴한다. grant/place/transition의 실제 execute 단계 충돌 fixture, listing 가격 멱등성 충돌, 마켓 관계 불일치 rollback을 검증했다. 패키지와 재화의 과거 동결 검증은 신규 canonical repository를 기존 provider/table로 오인하지 않도록 검색 경계를 명시했으며 기존 fixture와 hash는 변경하지 않았다.

## Gate 판정 범위

이 문서는 WBS733~741의 Gate 1~4와 중앙 schema 통합 검증 근거다. 레거시 데이터 import, 전체 consumer 전환, parity, Shadow와 운영 배포는 WBS742~745에서 수행하므로 Gate 5~8 완료 근거로 사용하지 않는다.
