# Wave7 scenarios

- Three consumers × five required scenarios = `15` new receipts; prior `55` retained, combined `70`.
- Point shop normal path executes catalog head → enabled entries → castle tax state, then queues the reply; empty-catalog alternative keeps the three queries and queues the empty message.
- Package bag normal path executes external identity → package inventory, then queues the reply; unlinked-player alternative stops after the first empty identity query and still queues the signup message.
- Package wizard guide normal path executes operator identity → replay lookup and queues the guide. Replay alternative returns persisted outbox `91` after the same two queries and performs no new queue transaction.
- Every positive non-replay queue executes exactly three infrastructure INSERTs in one transaction: operations (`UUID_V4`, insert `501`) → command_executions (operation `501`) → outbox_messages (operation `501`, insert `601`, exact payload). Source-domain DML remains zero.
- Duplicate negative dispatch is rejected before handler and queue invocation (`queryTrace=[]`, `dmlTrace=[]`, `GUARD_REJECTED`). It does not rely on a handler error.
- Restart scenarios execute the complete query plus queue transaction twice in fresh child processes; both process IDs/module UUIDs and operation UUIDs differ while linked insert IDs and results remain identical.
- Drift defenses cover frozen/current dispatch, downstream chain hash/needle, invocation/dispatch guard, query count/order/SQL/parameters/rows, mutation SQL/order/parameters/UUID/outbox linkage and final result. Trusted mapping and runner both fail closed.
