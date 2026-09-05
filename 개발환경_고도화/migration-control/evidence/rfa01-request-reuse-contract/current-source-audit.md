# RFA-01 current source audit

- catalog: `SC-20260902-1`
- lease: `2558`
- execution: `요청재사용계약DB-SL-COMMON-RUNTIME-INTEGRATION-01-RFA01-202609060240`
- baseline: `f31d4a206d36e0125b7735a6911fc1142e785612`
- frozen at: `2026-09-06 02:40:20 KST`

## 조사 키워드

`requestKey`, `idempotencyKey`, `payload_fingerprint`, `request_identity_fingerprint`, `result_json`, `replay`, `FOR UPDATE`, `withTransaction`, `typed receipt`, `CanonicalItemInventoryRepository`, `MariaCanonicalCurrencyRepository`, `MariaCanonicalFurnitureHomeRepository`, `TransactionalOperationRunner`, `AppWiringOperationProvider`.

## 현행 계약 판정

| provider | lookup identity | stored request proof | result proof | 판정 | 보완 이유 |
| --- | --- | --- | --- | --- | --- |
| `CanonicalItemInventoryRepository.changeStackQuantity` | `player_id + request_key` | 없음 | `resulting_quantity` | 불충족 | 같은 키의 `item_id`, `quantity_delta`, `reason_type`, actor 변경을 구별하지 못한다. |
| `MariaCanonicalCurrencyRepository.adjustBalance` | `player_id + request_key` | `operation_kind + payload_fingerprint` | operation row | 부분 충족 | currency/amount/kind/reason은 보호하지만 actor와 원본 event identity가 저장 지문에 없다. 다른 player는 별도 lookup이므로 같은 외부 event의 교차 계정 재사용을 차단하지 못한다. |
| `MariaCanonicalFurnitureHomeRepository` | `player_id + scope + key` | operation별 fingerprint | replay row + owned row | 부분 충족 | operation/player/item 또는 owned target/수치는 보호하지만 actor와 원본 event identity가 없다. scope 변경은 별도 요청으로 실행된다. |
| `TransactionalOperationRunner` | `scope + idempotency_key` | 없음 | `result_json` | 불충족 | 기존 결과를 반환할 때 actor/source/action/target/reason 또는 작업 payload를 비교하지 않는다. duplicate race 경로도 동일하다. |
| `AppWiringOperationProvider` | namespace/entrypoint/external request fingerprint | canonical payload fingerprint | terminal receipt + typed receipt link + outbox replay | 부분 충족 | payload와 typed receipt 검증은 강하지만 actor는 request identity/payload와 별도로만 전달되어 actor drift가 저장 계약에서 검출되지 않는다. dispatcher 파일은 Lease2558 변경 금지다. |
| `PetTitleCanonicalMutationProvider` | app-wiring claim 사용 | claim payload fingerprint | typed receipt/result fingerprint | 상위 계약 의존 | 소비자 자체 중복 provider는 만들지 않는다. actor 보호는 app-wiring 인증/claim 계약 보완 뒤 재판정한다. |

## 확인된 호출부

- canonical item/currency: `runtime/src/pet/pet-title-canonical-mutation-provider.ts`
- canonical furniture repository: production import 없음. 집중 테스트와 향후 home consumer 후보만 존재한다.
- `TransactionalOperationRunner`: `currency/currency-service.ts`, `event/event-ranking-service.ts`, `market/market-service.ts`, `inventory/inventory-service.ts`, `guild/guild-service.ts`, `home/home-social-service.ts`, `pet/pet-explore-rank-service.ts`, `pet/pet-service.ts`.
- app-wiring: 공용 ingress/receipt coordinator이며 이번 Lease에서는 읽기 전용 조사 대상이다.

## 동결 결론

기존 provider 중 RFA-01 전체 의미 필드(scope/key/source event/actor/player/operation/target/payload/result)를 공용으로 검증하는 재사용 계약은 없다. app-wiring의 private canonical JSON 및 claim 계약과 currency/furniture의 legacy fingerprint는 재사용 가능한 근거지만 각자 저장 형태와 누락 필드가 다르다. 따라서 기존 소비자를 이번 provider review 전에 수정하지 않고, 다음만 추가한다.

1. 순서·타입이 명확한 공용 request envelope/fingerprint/terminal receipt 계약.
2. caller-owned atomic lock/transaction adapter 안에서만 effect와 receipt를 한 번 실행하는 공용 coordinator.
3. currency/furniture/app-wiring의 기존 fingerprint를 정확히 검산하는 명시적 legacy compatibility 함수. 누락 필드를 새 계약으로 간주하지 않는다.
4. item/legacy operations의 fingerprint 없는 receipt는 안전한 payload 재사용 증거가 아니므로 자동 호환하지 않고 fail closed 한다.

## 미확인·후속 경계

- 실제 소비자 adoption과 저장 컬럼/schema 보완은 provider 독립 review·ACK 이후 별도 소비자 범위다.
- transaction participant와 receipt/outbox 원자성의 구체 DB adapter는 RFA-02 책임이다.
- DB duplicate/lock error 공통화는 RFA-03 책임이다.
- `app.ts`, `dispatch/*`, `main.js`, `Info.js`, schema/migration, 운영 DB/JSON은 변경하지 않는다.
