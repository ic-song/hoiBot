# SL-ASSET-HOME-BUILDING-RECIPE-ITEM-GAP-01 체크포인트

- 실행 ID: `개발자-SL-ASSET-HOME-BUILDING-RECIPE-ITEM-GAP-01-20260830T2345`
- Lease: `2367`
- 기준선: `9ee7a4c5ec73bd89f4ae9d7d5ea97dd21dfb09b0`
- 브랜치: `codex/modernization-home-recipe-item-canonical-gap-v2400-20260830`
- 범위: 홈건물 레시피 재료 4종 canonical 정의·object catalog·판매 차단·source crosswalk

## 구현

- `ITEM-RWD-041`을 정확한 `돌멩이🪨` STACK active 정의로 재사용했습니다.
- `ITEM-RING-UPGRADE-STONE`을 `반지 강화석💍` 신규 STACK 정의로 추가했습니다.
- `castle_coin`, `ITEM-RWD-052`의 활성 identity를 재사용했습니다.
- ITEM object 4행, exact legacy alias 4행, RUNTIME_DB/LEGACY_JSON source binding 18행을 추가했습니다.
- 네 정의의 `item_sale_policies.sellable`을 멱등적으로 FALSE로 고정했습니다.
- `ITEM-RWD-042`와 package 참조 6행은 보존했습니다.
- `legendary_stone` 정의는 만들지 않고 `ITEM-RWD-052` consumer 교정 의존성만 기록했습니다.

## 검증

- focused: 5/5 PASS
- typecheck/build: PASS
- fresh MariaDB: migration 394 포함 384개 적용 PASS
- MariaDB parity/rollback: 7/7 PASS
- replay: applied 0, 총계 불변
- reconnect: 7/7 PASS
- Shadow: 4/4 PASS
- full regression: 1,201 total / 1,194 pass / 0 fail / 7 skip

## 보존 경계

- inventory ownership/ledger 변경 없음
- package catalog/item/reward 모델 변경 없음
- player home·building definition/progression 변경 없음
- legacy Rhino, feature/prod, 운영 DB 변경 없음
- Gate 8은 FALSE로 유지
