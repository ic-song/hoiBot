# Wave2 executable scenarios

Each of the three consumers has exactly one bound execution receipt for each source-required scenario: `READ_POSITIVE`, `NEGATIVE_GUARD`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`, and `RESTART_CONSISTENCY`.

- New receipts: `3 consumers × 5 scenarios = 15`; retained Wave1 receipts: `15`; combined bundle: `30`.
- Every receipt captures separate raw reply, raw result, and runner-owned SQL/DML/lock/transaction trace artifacts.
- Negative inputs return the method-specific `UNMAPPED` quarantine reason without issuing a query.
- Positive/exact/DML-zero paths assert exact SQL, query values, mapped row, result, DML `0`, empty locks, and `READ_ONLY`.
- Restart executes two fresh child processes and two distinct module executions, then compares stable results.
- Swapped consumer locator, method, input/query values, SQL, mock/result data, self-declared trace, query-channel DML, and fake restart identity fail closed.

