# Wave6 scenarios

- Two consumers × five required scenarios = `10` new receipts; prior `45` retained, combined `55`.
- `resolveSelf` active path: exact active-context SQL and seven parameters execute once with row count `1`, returning `ACTIVE_CONTEXT`.
- `resolveSelf` fallback path: active-context query returns `0`, then exact legacy crosswalk SQL and two parameters execute second with row count `1`, returning `LEGACY_CROSSWALK`.
- `BagShadowParityProvider.compare` normal path: exact identity → legacy stack → canonical stack → canonical instance order, row counts `1/1/1/0`, matched stack fingerprints, `parity=true`, `cutoverReady=true`.
- Bag alternative branch: the same four-query order with row counts `1/1/1/1`; canonical instance is classified `ITEM_INSTANCE_OUT_OF_SCOPE`, `hasOutOfScopeRecords=true`, `cutoverReady=false`.
- Both invalid-input scenarios fail before query (`queryTrace=[]`, DML0, `GUARD_REJECTED`). All positive, alternative, DML-zero and restart scenarios remain `READ_ONLY`, lock order empty, and DML row count `0`.
- Restart scenarios execute the complete ordered query plan twice in fresh child processes; process IDs and module UUIDs must both differ while results remain identical.
- Drift defenses cover locator, input, exact SQL, parameters, query order/count, row payload and result; trusted mapping and runner both fail closed.

