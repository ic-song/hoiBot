# RFA-03 checkpoint

- catalog: `SC-20260902-1`
- lease: `2564`
- baseline: `2911301991c8630ab8cf097a9820179adf2f9a0f`
- branch: `codex/object-db-rfa03-error-retry-policy-v1-20260906`
- worktree: `C:\Users\user\Desktop\hoiBot-worktrees\object-db-rfa03-error-retry-policy-v1-20260906`
- status: implementation, T1/T2 focused validation, and independent review P0/P1/P2 = 0 complete
- commit/push: recorded on the source branch; final integration is tracked separately

Implemented the shared RFA-03 Maria error classification and bounded retry contract and adopted it only in the existing canonical identity/audit provider. Business UNIQUE/FK conflicts cannot be promoted by caller-supplied constraint names; only literal `PRIMARY` in a CUID candidate insert qualifies. Deadlock/timeout retries require the explicit root-transaction capability and domain permission, while scoped/savepoint clients propagate the original conflict. RFA-01/RFA-02 compatibility passed.

Next action: final integration review and WBS acknowledgement. Consumer-wide adoption remains separate work.
