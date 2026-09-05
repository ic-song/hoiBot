# RFA-01 validation

- baseline: `f31d4a206d36e0125b7735a6911fc1142e785612`
- catalog: `SC-20260902-1`
- lease/execution: `2558` / `요청재사용계약DB-SL-COMMON-RUNTIME-INTEGRATION-01-RFA01-202609060240`
- runtime: Node `v24.15.0`, npm `11.12.1`
- dependency lock SHA-256: `d42aefb62bea066d46db205e9e2d624ec6da20e997405f6560b46fb93f7c6dda`
- migration bundle: 465 files, SHA-256 `8a7e260102b1f2c849945bf2e7fe7ca2a5b2e8118b7872099fcb29e80f07fea1`
- completed: `2026-09-06 03:02:47 KST`

## 결과

| 검증 | 결과 |
| --- | --- |
| 신규 RFA-01 + item/currency/furniture/app-wiring/typed-receipt 영향 7파일 | 118/118 PASS, suites 9, skip 0 (자체 23 + 영향 회귀 95) |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run build` | PASS |
| `npm.cmd run object-data:validate` | PASS, 등록 대상 98개 |
| 신규 JSON parse | 2/2 PASS |
| 독립 review | REVIEW0 — P0 0, P1 0, P2 0; boundary single-read/data-only snapshot 보완 독립 재검토 완료 |
| 변경 경계 | 신규 shared provider/contract/test/evidence만; consumer/dispatch/schema/migration/app/main/Info 변경 0 |
| DDL/DML | provider source와 test에 SQL/DDL/DML 0 |

집중 명령:

```text
node --import tsx --test test/request-reuse-contract.test.ts test/canonical-item-inventory-repository.test.ts test/maria-canonical-currency-repository.test.ts test/canonical-furniture-home-repository.test.ts test/app-wiring-operation-provider.test.ts test/app-wiring-entrypoint-runner.test.ts test/pet-title-canonical-mutation-provider.test.ts
```

원본 focused log: `focused-test.log`, SHA-256 `489d0ceba329adc67c04ef11b894b4ad3e980e384f8143609219ea488f3c3de2`.

## 시나리오 증거

- exact replay: effect 1, receipt 1, replay result 동일.
- identity drift: scope/source event/actor type/actor id/player/operation/target 변경을 모두 실행 전 차단.
- payload drift: item/quantity/reason 변경을 모두 실행 전 차단.
- distinct event: 같은 payload라도 서로 다른 event/key는 각각 1회 실행.
- concurrency: 동일 요청 두 개를 동시에 호출해 실행 1, replay 1.
- restart/failure: 실패 attempt의 effect/receipt 0, 완료 뒤 새 provider instance에서 effect 0 replay.
- integrity: 첫 실행과 replay 모두 detached deep-frozen receipt result를 반환하고 저장 result fingerprint drift를 차단.
- boundary snapshot: input/actor/target/player/receipt/result를 own descriptor로 1회 data-only snapshot하고 그 snapshot만 지문/비교/저장/반환에 사용. accessor·nested accessor·symbol·extra fixed field·Proxy는 getter/trap 실행 없이 차단(`resultReads`/`actorReads`/nested reads 0).
- legacy: currency/furniture/app-wiring 기존 공식과 byte-exact hash 일치. fingerprint 없는 item/operations receipt shape는 provider API에서 effect 0으로 거절.

## 실행하지 않은 검증

- 전체 `npm test`: T3 통합 기준선 중앙 1회 정책에 따라 실행하지 않음.
- MariaDB 리허설: Lease2558은 DB adapter/schema/migration/driver를 변경하지 않으며 실제 transaction/outbox adapter는 RFA-02 범위라 실행하지 않음.
- 운영 DB/JSON/실운영방/Gate8: 금지 범위라 사용하지 않음.
