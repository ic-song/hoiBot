# WBS776 `/가방` canonical SHADOW checkpoint

- Execution: `아이템가방직접조회DB-SL-ITEM-BAG-CANONICAL-DIRECT-READ-01-202609080638`
- Lease / WBS: `2604` / `776`
- Consumer: `legacy-94904fa11988ff04`
- Branch: `codex/item-bag-canonical-read-v1-20260908`
- Baseline: `4f7492f980bf95744b3f0eb4f9e8717cc4dd50d3`
- Runtime route: exact `/가방|ㄴㄴㄴ` operational Iris ingress, `SHADOW` only
- Cutover: `false`; the WBS776 wrapper does not claim a MODERN or external DIRECT reply

## Gate state

- Gate 1: the frozen consumer locator and source span remain unchanged. The original manifest still classifies the whole legacy bag across ITEM and PET-EQUIPMENT targets; this slice narrows only the evaluator to stack-bag and fails closed when canonical item instances or other unsupported records are present.
- Gate 2: `direct_reply | legacy_reply | silent` is explicit. Castle active, missing player/member context, invalid identity/parity, and unproven presentation authority are silent. Canonical import incompleteness remains transitional legacy ownership. Silent and evaluation-error outcomes create no transitional legacy outbox.
- Gate 3: active `PlayerContextPort` resolves the legacy and canonical player once. The WBS776 wrapper supplies those exact ids to the byte-preserved Wave6 parity provider and fails closed on unexpected SQL query shapes; it does not reinterpret the caller identity.
- Gate 4: stack parity, owner label, world guild-territory-war authority, operation notice advertisement, and import provenance are SELECT-only snapshot participants. No new schema, migration, importer, or canonical/source-domain mutation is introduced.
- Gate 5: actual Maria read-only snapshot passes for active subaccount selection, exact resolved legacy/canonical ids, world castle authority, 8 marker/rank-20 owner label, operation notice, complete/incomplete import receipts, and canonical output. The actual buildApp route is registry-controlled and runs the evaluator only for the exact SHADOW decision; LEGACY_ONLY remains on the legacy path.
- Gate 6: 77 focused/shared recovery tests pass, and an actual Maria SHADOW receipt is persisted/replayed across app/pool reconstruction. A completed replay validates the exact transitional legacy outbox and rejects missing, duplicate, payload, destination, status, or type drift, including a COMPLETED receipt discovered during failure reconciliation. Wave17 seals `182` executable receipts: immutable Wave16 prefix `167` plus three WBS776 ITEM READ SQL providers times five scenarios. All 15 additions are `READ_ONLY`, `DML=0`, exact-output/tamper/restart checked. No WBS776 wrapper MODERN or external DIRECT reply is claimed.
- Gate 7: isolated schema `hoibot_rehearsal_item_bag_2604` applied the then-current 475 migrations. Actual buildApp request and app/pool reconstruction preserve one transitional legacy outbox and one SHADOW receipt for a non-silent decision, while a castle-silent decision preserves one receipt and zero legacy outboxes. WBS777 and WBS778 separately seal the three later migrations and their isolated MariaDB continuation/side-effect evidence. The injected immediate HTTP callback count is zero and fixture legacy/canonical quantities remain unchanged. A fresh detached review of pushed commit `909fc1ab` returned GO with focused `65/65`, typecheck, build, object-data `119`, `main.js`/`Info.js` syntax, and diff checks passing; P0/P1/P2 findings are zero.
- Gate integration audit: the official manifest generator derives `1,133` consumers (`SQL_REPOSITORY=84`) with consumer-set SHA-256 `015ed7d96a4579c84d170888151e44a36cf95192760555966ac47df0764ffb3a`. The ledger derives `READ=504`, `MUTATION=629`, `DIRECT_PASS=33`, `STATIC_ONLY=1,018`, `BLOCKED_DYNAMIC=82`, missing/duplicate `0`, entry-set SHA-256 `775a00e4ef73f19361bab6d3a057984ffb4902a1afadc5167067edea7ce5a882`. The three WBS776 SQL READ providers have current Wave17 DIRECT execution receipts. Historical Wave6 `sql-repository-3001ad9fc2f36d01` remains `STATIC_ONLY` because its immutable receipt source span differs from the current provider source.

## Explicit blockers

1. ITEM_BAG MODERN routing and external DIRECT reply remain intentionally disabled; Gate 6/7 SHADOW completion does not authorize cutover.
2. Transitional `MariaBagRepository` remains legacy-only evidence and is not counted as canonical external DIRECT evidence.
3. No operational database, operational JSON, real chat room, external network, `feature/prod`, or Gate 8 action was used.

## Next safe slice

WBS776 is COMPLETE with Gate 1~7 true and Lease2604 released. Audit the remaining WBS730~744 Gate 1~7 scope before WBS745 non-operational Gate 8 preparation. Any MODERN routing, transitional-reader removal, operating import, or production action requires a later separately authorized slice.
