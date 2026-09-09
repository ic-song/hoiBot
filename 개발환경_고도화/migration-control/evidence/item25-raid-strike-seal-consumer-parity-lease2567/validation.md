# WBS754 레이드타격대인장 소비자 parity 검증

기준은 `a397e2dc6cb810404efc812ab0c4ee33c43b369b`입니다. 원본 audit의 dept2 exact 1개를 유지하고, 이름이나 CODE를 저장 identity로 쓰지 않는 exact CUID bridge 하나로 craft/package/tower/modern charm을 연결했습니다.

## T1 집중 검증

- 최종 focused 묶음: 54/54 PASS
- shared item25 canonical definition provider focused 회귀: 6/6 PASS
- 실제 consumer routing: package exact balance/add, tower exact reward, charm canonical 수량 × 600 snapshot PASS
- craft: 응답·비용·수량·순서, restart replay DML0, quantity/channel payload conflict, sealed options drift, canonical ledger root rollback PASS
- 기존 provider: package fixture/edge, tower policy, charm read, canonical home recipe repository PASS
- exact source audit: owners 308, quantity 7,342, home occurrences 140, tower/package/legacy readers PASS
- 격리 MariaDB 11.8.8, migration 465개: exact resolve/player, package 2 지급, restart replay DML0, tower 10 지급, tower replay DML0, legacy target ledger 0, charm 12×600=7,200 1회 합산, ledger 실패 root rollback PASS

## T2 정적 검증

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run object-data:validate`: PASS, 등록 대상 98개
- `git diff --check`: PASS (line-ending notice only)
- evidence JSON parse: PASS
- `main.js`, `Info.js`, `data/`, 적용 migration 변경: 0

## 판정

- exact identity는 `/raidSpecialItem/dept2/item_0`, locator, payload와 CUID crosswalk로 결정합니다.
- definition options 전체를 기존 item25 provider의 정규화 hash로 확인하므로 `exp=600`의 값·타입 또는 추가 필드 drift를 거절합니다.
- exact target 보유의 유일한 write authority는 generic `CanonicalItemInventoryRepository`입니다. package/tower의 `ITEM-RWD-043`은 호환 입력 경계에서만 사용합니다.
- modern charm SQL은 dept2/item_0 legacy 합계를 제외한 뒤 canonical 수량 × sealed 600을 한 번만 합산합니다.
- home은 140개 typed requirement와 기존 canonical CUID repository를 검증했습니다. 현재 활성 modern home command consumer가 없어 새 consumer는 만들지 않았습니다.
- 감사된 기존 308명/7,342개를 canonical stack으로 옮기는 운영 데이터 이관은 별도 WBS입니다. 해당 이관과 대조 검증 전에는 이 modern consumer 전환을 운영 활성화하면 안 됩니다.
- 신규 schema/migration/catalog/acquisition/effect/probability 규칙은 없습니다.
- Lease2567 foreman은 기존 item25 provider의 sealed map/normalize/hash assertion 9줄 export를 최대 재사용 범위로 명시 승인했습니다. apply/schema/manifest 동작은 불변이고 새 hash 권위는 만들지 않았으며 기존 provider focused 회귀도 통과했습니다.
- 격리 MariaDB에서 신규 실제 SQL·transaction 경로를 검증했습니다. 전용 DB와 계정은 검증 직후 삭제했으며 운영 소유 데이터 이관 검증을 대체하지 않습니다.
- full suite는 실행하지 않았습니다. 초기 명령 실수로 시작된 full test는 의존성 누락에서 즉시 중단했으며 판정에서 제외했습니다.
- 최종 독립 재리뷰: P0=0, P1=0, P2=0, `APPROVED`.
