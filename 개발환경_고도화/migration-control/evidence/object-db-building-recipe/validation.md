# WBS741 건물·범용 조합 오브젝트 DB화 Gate 1~4

## Gate 1 — 현행 근거

- 검색어: `건물`, `homeInfo`, `recipe`, `/다이아조합`, `/펫스킬북조합`, `/전체조합`, `runCombineAll`, `saveJsonFile`, `addPoint`, `addItem`, `removeItem`.
- 건물 원본은 `data/petSweetHomeInfo.json#homeInfo`의 300개 진행 행이며, 기존 395/428 근거상 299개 정의와 2,683개 재료 요구사항이다. 기존 적용 migration은 수정하지 않는다.
- `/다이아조합 [숫자]`는 `전설의 돌맹이🗿` 1개와 포인트 500,000,000을 배수 차감하고 정확한 아이템명 `다이아상자💎(/다이아상자오픈)` 1개를 배수 지급한 뒤 `data/member.json` 경로를 한 번 저장한다.
- `/펫스킬북조합 [숫자]`는 조각 10개를 책 1개로 교환하고 성공 때만 같은 member data를 저장한다.
- `runCombineAll`은 `정령조각🥀` 10개당 `정령 강화석🥀` 1개를 최대 수량으로 교환한다. `/전체조합`, `/전체조합2`와 `/정리`, `ㅇㅇㅇ` 자동 흐름이 공유한다.
- 불확실성: 전체 활성 조합의 catalog seed/consumer 전환은 후속 slice이며, 이번 Gate 1~4는 스키마·repository·합성 계약만 만든다.

## Gate 2 — 모델 경계

- 건물 정의/원본 import, 조합 정의/원본 import, typed item·currency inputs/outputs, 건물-조합 관계를 분리한다.
- 사용자별 정의값을 복제하지 않는다. 조합 실행은 `player_id + request_key`와 payload fingerprint로 한 번만 커밋한다.
- item/currency 대상은 다형 문자열이 아니라 각 정의 FK로 보장한다. mutation과 typed ledger는 동일 transaction이다.
- 건물 승급의 결과는 item output이 아니라 `canonical_building_craft_recipes.building_id` 관계다. canonical 사용자 홈 상태 provider가 아직 없으므로 건물 조합 실행은 fail-closed하고 이번 범위에서는 catalog만 등록한다.
- `canonical_players`, item 정의/stack은 444를 사용하고 currency 정의/balance는 정확히 `452_canonical_currency_ledger.sql`에 pin한다.

## Gate 3 — 합성 fixture

- `canonical-building-recipe-v1.json`은 식별되지 않는 합성 ID로 다이아 조합, 전체조합 핵심 교환, 건물 정의 한 건을 표현한다.
- 운영 snapshot은 읽기 근거로만 사용했고 수정·복사·적재하지 않았다.

## Gate 4 — 구현 및 검증 범위

- 신규 migration: `453_canonical_building_recipe.sql`.
- repository: definition payload-bound replay, CUID2 8자 충돌 제한 재시도, KST 감사값, recipe active/batch 검증, item/currency stable lock 및 원자 증감, typed ledger, duplicate/deadlock/lock-timeout 제한 재시도.
- cross-owner FK는 operation owner와 stack/balance owner+target의 복합 FK로 차단한다.
- 단독 `id`, object `CODE`, 실행 SQL/JS payload는 저장하지 않는다.
- 검증: object-data contract validator PASS(52 tables), typecheck PASS, build PASS, focused tests 27/27 PASS.
- 전체 suite: 1,681개 중 1,672 PASS, 8 SKIP, 1 FAIL. 실패는 기존 `currency-definition-snapshot-freeze`가 신규 canonical 파일의 `currency_ledger` 문자열 2건을 과거 provider46 집합에 포함해 48건으로 계산한 경계 충돌이며, 적용 완료 snapshot은 수정하지 않았다. 452 통합 시 legacy provider snapshot과 신규 canonical provider를 분리하는 후속 correction이 필요하다.

## 미완료

- Gate 5 실제 MariaDB: 452→453 통합 후 fresh migration/reapply, same-key/new-stack 동시성 및 rollback/restart 검증 필요.
- Gate 6 Shadow: 운영 미러 입력 비교 미실행.
- Gate 7 운영 준비: 백업/복구, seed/import, cutover/rollback, 모니터링 승인 미실행.
