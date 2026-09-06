# Wave3 scenarios

- One consumer × five required scenarios = five new receipts; Wave1+2 `30` retained, combined `35`.
- `READ_POSITIVE`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`: exact SQL/values/result, DML0, empty lock order, `READ_ONLY`.
- `NEGATIVE_GUARD`: empty target key returns `PLAYER_CONTEXT_TARGET_INVALID` with query count `0` and `GUARD_REJECTED`.
- `RESTART_CONSISTENCY`: two fresh child processes and distinct module executions produce identical results.
- Drift defenses cover locator, input, query values, full SQL, mock DB row, expected result, self trace, DML injection and fake restart identity.

