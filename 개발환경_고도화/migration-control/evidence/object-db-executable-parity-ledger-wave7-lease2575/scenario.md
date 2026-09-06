# Wave7 scenarios

- Three consumers × five required scenarios = `15` new receipts; prior `55` retained, combined `70`.
- Point shop normal path executes catalog head → enabled entries → castle tax state in exact order; empty-catalog alternative keeps the same three queries and returns the empty message.
- Package bag normal path executes external identity → package inventory; unlinked-player alternative stops after the first empty identity query and returns the signup message.
- Package wizard guide normal path executes operator identity → replay lookup and returns the guide; replay alternative returns the persisted result after the same two-query order.
- Every invalid identity input fails before handler service/database invocation (`queryTrace=[]`, DML0, `GUARD_REJECTED`). All positive, alternative, DML-zero and restart scenarios are `READ_ONLY`, lock order empty and DML row count `0`.
- Restart scenarios execute the complete query plan twice in fresh child processes; both process IDs and module UUIDs differ while results remain identical.
- Drift defenses cover frozen/current dispatch, downstream chain hash/needle, invocation input, query count/order/SQL/parameters/rows and final result. Trusted mapping and runner both fail closed.
