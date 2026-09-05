# RFA-02 current source audit

- catalog: `SC-20260902-1`
- lease: `2560`
- baseline: `b586e5f9c88731536f2770d5beda8abae7d3e88c`
- scope: shared provider/contract/tests/evidence only

## Search terms

`withTransaction`, `withControlledTransaction`, `withSavepoint`, `TransactionalOperationRunner`, `requestKey`, `idempotencyKey`, `payload_fingerprint`, `result_fingerprint`, `typedReceipt`, `canonical_app_wiring_receipt_links`, `outbox_messages`, `result_json`, `replay`, `rollback`, `lease_generation`, `MUTATION_STARTED`.

## Existing provider findings

| source | current strength | gap or compatibility decision |
| --- | --- | --- |
| `runtime/src/shared/request-reuse-contract.ts` | Canonical data-only request/result snapshots; identity, payload, request and result fingerprints; raw request-key locking; exact terminal replay. | Authoritative RFA-01 dependency. Its existing terminal snapshot primitive is minimally exported for RFA-02 reuse; fingerprint and replay formulas are unchanged. Git blob at baseline: `0f33975b313533d94ea8aae3ff75f7da7c8cdadd`. |
| `runtime/src/shared/transactional-operation.ts` | Domain work, audit, one outbox and `operations.result_json` share `DatabaseClient.withTransaction`. | Replay lookup does not compare actor/action/target/reason/payload fingerprints. It is retained for existing consumers, not promoted to the RFA-02 request contract. |
| `runtime/src/database.ts` | `withControlledTransaction` owns connection lifetime; nested work can join by savepoint; commit/rollback/release failures are surfaced. | It is the preferred future DB adapter capability. RFA-02 does not modify it or invent another DB client. An adapter must freshly re-read after an ambiguous commit result. |
| `runtime/src/dispatch/app-wiring-operation-provider.ts` | Claim-before-mutation, lease token/generation fencing, typed-receipt link and result-fingerprint verification, mutation reply/outbox atomicity, exact replay and post-commit reconciliation. | Strong specialized precedent. It remains unchanged because dispatch and consumer adoption are outside Lease2560. Its private claim identity omits the full RFA-01 actor/player envelope, so it is not silently treated as RFA-01 complete. |
| migrations `463`, `466` and later additive receipt extensions | Typed operation receipts, exactly-one typed FK link, terminal status and fingerprint constraints. Current app-wiring provider declares 11 typed receipt mappings. | Schema is read-only in this lease. Heterogeneous typed-row fingerprint equality remains a provider/adapter read and insert responsibility. |
| `runtime/src/integration/outbox-worker.ts` | Restart-safe delivery claims pending/failed Iris text outbox rows and records delivery success/failure. | Delivery occurs after the producer transaction by design. RFA-02 governs atomic outbox evidence creation, not transport delivery. |
| domain services | 312 source files directly insert `outbox_messages`; many already place domain DML/audit/outbox/result in one local transaction. | Existing behavior is intentionally not swept or adopted. Each future consumer must prove it joins the RFA-02 store transaction and loads all referenced evidence atomically. |

## Frozen implementation decision

The smallest non-duplicate provider is `TransactionReceiptOutboxProvider`, an adapter coordinator around `RequestReuseProvider`:

1. RFA-01 continues to snapshot and verify the complete request and exact result.
2. RFA-02 requires a completed typed receipt plus either `OUTBOX` evidence or explicit `NO_OUTBOX` terminal evidence.
3. The adapter owns one raw-request-key locked transaction containing domain DML, typed receipt, delivery evidence, and the RFA-01 terminal.
4. Replay loads the complete evidence set through RFA-01's exported canonical receipt snapshot; partial/mismatched evidence fails before consumer work.
5. Only the explicit `TransactionCommitAckAmbiguousError` activates post-commit reconciliation. Deterministic failures retain their original error.
6. After the explicit ambiguity signal, a fresh exact read is mandatory. Missing, unreadable, or drifted evidence never returns success.

## Deferred compatibility boundary

- No app/dispatcher/consumer adoption.
- No changes to `main.js`, `Info.js`, migrations, schema, database, package files, or operational data.
- No claim/lease recovery implementation is duplicated. App-wiring retains its specialized fencing; future adapters must preserve it when composing the shared contract.
- RFA-03 remains responsible for any cross-provider database error classification policy.
