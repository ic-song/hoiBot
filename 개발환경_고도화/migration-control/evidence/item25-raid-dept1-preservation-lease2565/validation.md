# WBS753 레이드 dept1 8종 보존 검증

- 결과: PASS
- 범위: Gate 1~7 비운영 보존 검증
- 신규 schema/migration/provider/consumer: 0
- 운영 데이터 이관, 운영 DB, 실운영방, feature/prod, Gate8: 0

## 판정

`data/itemInfo.json`의 dept1 8개 occurrence를 exact JSON pointer, `RAID_ITEM_DEFINITION`, 원문 payload, locator hash와 payload hash로 검증했다. migration 386의 active 정의와 기존 item25 canonical provider의 active/options/CUID/crosswalk 계약을 그대로 재사용한다. 보유 경로는 이름이 아니라 `player_id`, `item_id`를 사용하는 기존 generic stack repository로 조건부 처리된다.

migration 386은 이미 적용된 레거시 provenance라 수정하지 않는다. 현재 identity 판정은 해당 migration의 CODE가 아니라 표준을 준수하는 canonical provider의 CUID2 8자리 `item_id`와 exact source locator crosswalk가 담당한다.

전용 획득·효과 consumer가 확인되지 않은 사실은 삭제·비활성·신규 규칙의 근거가 아니다.

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
