# SL-POINT-SHOP-BUY checkpoint

- execution: 작업반장-SL-POINT-SHOP-BUY-RECOVERY-2026090202
- lease: 슬라이스_선점 row 2493
- branch: codex/modernization-point-shop-buy-v2438-20260902
- baseline: 37bdd4eb
- command: /구매, /구매 [가방번호] [수량]
- migration: 440_point_shop_buy_effects.sql
- gates: Gate 1~7 complete, Gate 8 false
- production: feature/prod, operational DB, main.js, data unchanged

## Implemented contract

- Seeds the exact nine v2.400 point-shop products and stable reward bindings.
- Applies point discount, castle tax, tier-ticket bonus, daily carrot limit, and limited-pet confirmation rules.
- Mutates canonical currency, inventory, pet, and guild-resource ownership in one transaction.
- Records command execution, audit, purchase event, ledger, and outbox evidence with replay protection.

## Verification

- focused: 4/4 PASS
- currency provider snapshot: 7/7 PASS, provider union 59
- typecheck: PASS
- build: PASS
- fresh MariaDB migration: 428 migrations, migration 440 PASS
- MariaDB: purchase, replay, quantity limit, rollback, reconnect, and Shadow PASS
- full regression: 1,583 total / 1,575 pass / 0 fail / 8 skip
- verified at: 2026-09-02 01:49:15 KST

