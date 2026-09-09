# Wave4 scenarios

- One consumer × five required scenarios = five new receipts; prior `35` retained, combined `40`.
- `READ_POSITIVE`, `EXACT_OUTPUT`, `SOURCE_DOMAIN_DML_ZERO`: exact SQL/`player01` query value/result, DML0, empty lock order, `READ_ONLY`.
- `NEGATIVE_GUARD`: invalid `bad` player ID returns `OBJECT_IDENTITY_CANDIDATE_INVALID` with query count `0` and `GUARD_REJECTED`.
- `RESTART_CONSISTENCY`: two fresh child processes and distinct module executions produce identical results.
- Drift defenses cover locator, input, query values, full SQL, mock DB row and expected result.
