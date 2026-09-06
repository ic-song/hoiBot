# Wave10 검증

- fixture generation: PASS (3 consumer, 15 receipt binding, 18 risk binding)
- focused Wave10: 6/6 PASS
- prior receipt: 119 exact prefix/hash/identity 보존, total 134 unique
- transaction: 정상 DML5, restart DML10, BEGIN/COMMIT 및 lockOrder 비교
- negative: query/DML0, app duplicate·wrong channel은 routing 이후 service DML0
- rollback: middle DML 실패 후 persisted0 계약
- fixture/harness/target/consumer canonical hash 고정 및 tamper fail-close
- probability: 13종, 합계 100
- BIGINT: 64-bit 초과 listing/instance 식별자 보존
- typecheck: PASS
- full suite/T3: 최종 단계 전이므로 실행하지 않음
