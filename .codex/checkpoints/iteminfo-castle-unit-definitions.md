# 작업 체크포인트

- 작업 키: iteminfo-castle-unit-definitions
- 작업 이름: itemInfo 캐슬 유닛 10개 typed 정의
- 작업 상태: Gate1~7 검증 완료, WBS 마감 대기
- 마지막 갱신: 2026-08-30 16:34 KST
- 슬라이스: `SL-ASSET-ITEMINFO-CASTLE-UNIT-DEFINITIONS-01`
- 실행 ID: `작업반장-SL-ASSET-ITEMINFO-CASTLE-UNIT-DEFINITIONS-01-20260830162101`
- Lease: 2345 ACTIVE
- baseline: `02aef12e`
- branch: `codex/modernization-iteminfo-castle-units-v2400-20260830`
- worktree: `C:\Users\user\Desktop\hoiBot-worktrees\iteminfo-castle-units-v2400-20260830`

## 범위

- `castleItem.item_0`부터 `item_9`까지 source key identity로 정의한다.
- 원천 `exp`를 `castle_battle_item_bonus_definitions.charm_per_unit`로 보존한다.
- exact canonical 7개를 재사용하고 초급·중급·불사조 3개만 신규 stable code를 사용한다.
- 기존 inventory ownership/ledger와 공용 object catalog를 재사용한다.

## 금지 범위

- `main.js`, `Info.js`, 운영 JSON, 운영 DB, `feature/prod`, Gate8 변경 금지.
- 표시명만 같은 항목의 자동 병합과 신규 중복 보유 테이블 생성 금지.

## 검증 결과

- focused test: 5/5 PASS
- typecheck/build: PASS
- full regression: 1,181 total / 1,174 pass / 0 fail / 7 skip
- fresh MariaDB: `127.0.0.1:33457/hoibot_iteminfo_castle_units_388_01`
- migration: 378개 적용, `388_iteminfo_castle_unit_definitions.sql` 포함
- parity: definitions/items/objects/aliases/source bindings 10/10, canonical reuse 7, 신규 3
- rollback: `1 -> 999 -> 1`
- replay: 신규 migration 0, parity 10/10 유지
- reconnect: 2회 모두 10/10
- Shadow: 10/10 PASS

## 다음 행동

1. 구현·증거 9개 파일을 commit/push한다.
2. WBS Gate1~7, DB 매핑, 검증 근거, REPORT를 마감한다.
3. Lease 2345를 RELEASED로 전환하고 Gate8은 FALSE로 유지한다.
