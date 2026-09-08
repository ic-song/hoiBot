# WBS776 `/가방` canonical SHADOW checkpoint

- Execution: `아이템가방직접조회DB-SL-ITEM-BAG-CANONICAL-DIRECT-READ-01-202609080638`
- Lease / WBS: `2604` / `776`
- Consumer: `legacy-94904fa11988ff04`
- Branch: `codex/item-bag-canonical-read-v1-20260908`
- Baseline: `4f7492f980bf95744b3f0eb4f9e8717cc4dd50d3`
- Runtime route: exact `/가방|ㄴㄴㄴ` operational Iris ingress, `SHADOW` only
- Cutover: `false`; `DIRECT_PASS` is not claimed

## Gate state

- Gate 1: the frozen consumer locator and source span remain unchanged. The original manifest still classifies the whole legacy bag across ITEM and PET-EQUIPMENT targets; this slice narrows only the evaluator to stack-bag and fails closed when canonical item instances or other unsupported records are present.
- Gate 2: `direct_reply | legacy_reply | silent` is explicit. Castle active, missing player/member context, invalid identity/parity, and unproven presentation authority are silent. Canonical import incompleteness remains transitional legacy ownership. Silent and evaluation-error outcomes create no transitional legacy outbox.
- Gate 3: active `PlayerContextPort` resolves the legacy and canonical player once. The WBS776 wrapper supplies those exact ids to the byte-preserved Wave6 parity provider and fails closed on unexpected SQL query shapes; it does not reinterpret the caller identity.
- Gate 4: stack parity, owner label, world guild-territory-war authority, operation notice advertisement, and import provenance are SELECT-only snapshot participants. No new schema, migration, importer, or canonical/source-domain mutation is introduced.
- Gate 5: actual Maria read-only snapshot passes for active subaccount selection, exact resolved legacy/canonical ids, world castle authority, 8 marker/rank-20 owner label, operation notice, complete/incomplete import receipts, and canonical output. The actual buildApp route is registry-controlled and runs the evaluator only for the exact SHADOW decision; LEGACY_ONLY remains on the legacy path.
- Gate 6: 77 focused/shared recovery tests pass, and an actual Maria SHADOW receipt is persisted/replayed across app/pool reconstruction. A completed replay validates the exact transitional legacy outbox and rejects missing, duplicate, payload, destination, status, or type drift, including a COMPLETED receipt discovered during failure reconciliation. Formal WBS776 executable parity remains `STATIC_ONLY`; no WBS776 `DIRECT_PASS` or cutover proof is claimed.
- Gate 7: isolated schema `hoibot_rehearsal_item_bag_2604` applied all 475 migrations. Actual buildApp request and app/pool reconstruction preserve one transitional legacy outbox and one SHADOW receipt for a non-silent decision, while a castle-silent decision preserves one receipt and zero legacy outboxes. The injected immediate HTTP callback count is zero and fixture legacy/canonical quantities remain unchanged.
- Gate integration audit: the official manifest generator derives 1,132 consumers (`SQL_REPOSITORY=83`). The two additive ITEM READ consumers are `STATIC_ONLY`; existing Wave6 `sql-repository-3001ad9fc2f36d01` remains byte-exact `DIRECT_PASS`, which does not prove the alternate WBS776 wrapper.

## Explicit blockers

1. The current import schema has no per-player completeness receipt that proves an empty source bag and no post-import mutation. Empty canonical stacks therefore keep `cutoverReady=false`.
2. The frozen consumer includes owned item instances and PET-EQUIPMENT targets. Stack-only direct output remains disabled whenever an out-of-scope canonical record is present.
3. Transitional `MariaBagRepository` still resolves the caller-linked `external_identities.player_id`, filters `item.active=TRUE`, uses the stored display name without full `checkRank`, and reads `legacy.bag.advertisement`. It does not prove active-subaccount or exact frozen-output parity and is not counted as canonical DIRECT evidence.
4. No operational database, operational JSON, real chat room, external network, feature/prod branch, or Gate 8 action was used. Task-branch push remains pending at this checkpoint.

## Next safe slice

Add a forward-only, audited per-player bag import-completeness projection covering zero rows and post-import mutation, then prove full frozen-domain coverage or formally reclassify the consumer dependency. Only after isolated MariaDB import and actual-ingress exact-output parity should a separate lease consider MODERN routing or removal of the transitional legacy reader.
