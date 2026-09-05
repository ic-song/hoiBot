# RFA-02 scenario matrix

| scenario | expected | evidence |
| --- | --- | --- |
| first mutation with typed receipt and outbox | domain, receipt, outbox and RFA-01 terminal commit once | focused test |
| same request after provider restart | exact detached RFA-01 result and same receipt/delivery evidence; work count unchanged | focused test |
| concurrent same raw request key | store serializes; one effect and one complete terminal | focused test |
| actor/identity drift | RFA-01 identity conflict before a second effect | focused composition test |
| payload drift | RFA-01 payload conflict before a second effect | focused composition test |
| typed receipt fingerprint drift | fail closed | focused test |
| outbox result binding drift | fail closed | focused test |
| partial/missing receipt or delivery evidence | fail closed and transaction rolls back | focused test |
| intentional no reply | explicit `NO_OUTBOX` evidence required; omission rejected | focused test |
| terminal persistence failure | no domain/receipt/outbox/terminal count survives | focused atomic-store test |
| deterministic work/persist/adapter failure | original error is rethrown; no reconciliation read | focused test |
| plain error with ambiguity-like message | original plain error is rethrown; only the exported error class is classified | focused test |
| subclass, `Object.create(prototype)`, proxied branded instance, or throwing `getPrototypeOf` trap | private `WeakSet` brand does not classify it; exact original value is rethrown without prototype inspection | focused test |
| commit succeeds but `TransactionCommitAckAmbiguousError` is raised | fresh exact read reconciles success | focused test |
| ambiguous commit fresh read drifted | `RFA02_COMMIT_RECONCILIATION_DRIFT` | focused test |
| ambiguous commit fresh read fails | `RFA02_COMMIT_RECONCILIATION_READ_FAILED` | focused test |
| mutable stored RFA-01 receipt | exported RFA-01 snapshot returns a detached deep-frozen receipt/result | focused test |
| top-level terminal and nested requestReceipt/typed/delivery accessor, proxy, or partial shape during replay | every listed boundary/form is directly rejected before work; accessors are not invoked | focused test |
| top-level terminal and nested requestReceipt/typed/delivery accessor, proxy, or partial shape during fresh reconciliation read | every listed boundary/form is directly rejected; no unverified success | focused test |
| runtime versus contract RFA-02 error-code drift | exported and JSON error-code sets must match exactly | focused test |
| app-wiring/consumer adoption and MariaDB row verification | deferred; no consumer/schema writes in Lease2560 | source audit |
