# WBS755 영지 프리미엄 6종 보존 검증

- 결과: PASS
- 범위: Gate 1~7 비운영 보존 검증
- 신규 schema/migration/provider/consumer: 0
- 운영 데이터 이관, 운영 DB, 실운영방, feature/prod, Gate8: 0

## 판정

`data/itemInfo.json#castlePremiumItem`의 offense 3건과 defense 3건을 서로 독립된 exact occurrence로 검증했다. 원문 이름과 `successRate` payload, locator/payload fingerprint, migration 387 active 행, item25 canonical provider의 active/options/CUID/crosswalk 계약이 일치한다.

migration 387은 이미 적용된 레거시 provenance라 수정하지 않는다. 현재 identity 판정은 해당 migration의 CODE가 아니라 표준을 준수하는 canonical provider의 CUID2 8자리 `item_id`와 exact source locator crosswalk가 담당한다.

레거시 `/영지공격` runtime4와의 6→4 매핑은 확인되지 않았으므로 만들지 않았고 확률도 바꾸지 않았다. runtime parity는 별도 WBS756 범위다.

## T1/T2 검증

```text
focused: item25 raid + castle preservation + canonical provider + canonical inventory = 22/22 PASS
typecheck: PASS
build: PASS
object-data validator: PASS (98 registered targets)
git diff --check: PASS
full suite: not run (final T3 policy)
MariaDB: no new run; unchanged Lease2556 isolated transcript reused
```
