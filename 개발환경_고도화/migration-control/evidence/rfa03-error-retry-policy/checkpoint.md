# RFA-03 checkpoint

- catalog: `SC-20260902-1`
- lease: `2564`
- baseline: `2911301991c8630ab8cf097a9820179adf2f9a0f`
- branch: `codex/object-db-rfa03-error-retry-policy-v1-20260906`
- worktree: `C:\Users\user\Desktop\hoiBot-worktrees\object-db-rfa03-error-retry-policy-v1-20260906`
- status: implementation and T1/T2 focused validation complete; independent review pending
- commit/push: forbidden until independent review reports P0/P1/P2 = 0

Implemented the shared RFA-03 Maria error classification and bounded retry contract and adopted it only in the existing canonical identity/audit provider. Business UNIQUE/FK conflicts cannot be promoted by caller-supplied constraint names; only literal `PRIMARY` in a CUID candidate insert qualifies. Deadlock/timeout retries require the explicit root-transaction capability and domain permission, while scoped/savepoint clients propagate the original conflict. RFA-01/RFA-02 compatibility passed.

Next action: independent full-diff review. After review zero findings, create a Korean commit, push the source branch, and hand the immutable commit to the integration owner. Consumer-wide adoption remains separate work.
