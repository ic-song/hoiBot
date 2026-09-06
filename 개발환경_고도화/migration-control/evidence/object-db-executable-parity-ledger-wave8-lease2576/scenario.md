# Wave8 scenarios

- Per consumer receipt scenarios (`6 × 4 = 24`): positive, invalid guard, permission denial, exact/replay output, rollout shadow/source-domain DML0, and fresh-child restart consistency.
- Positive/exact/restart paths assert exact ordered SELECT/DML SQL, parameters, rows, result, transaction timeline and `FOR UPDATE` lock order. ServerStats uses two snapshot rows and proves its variable row DML count.
- Invalid guard rejects before service invocation with query0/DML0. Permission and rollout behavior follow each service's actual source path; routing/evidence DML is distinguished from source-domain DML.
- Restart runs fresh child PIDs and module UUIDs. Generated operation keys must both be UUIDv4 and differ across children.
- Additional risk scenarios (`11`): rollback for all four consumers; DataStatus deadlock retry success/exhaustion; ServerStats deadlock retry success/exhaustion, duplicate retry success/exhaustion, and replay mismatch.
- Retry success proves failed attempt rollback and a fresh successful commit. Exhaustion proves three failed transaction attempts and final original error propagation. Duplicate failures occur at the actual operation INSERT; their attempted DML remains visible but `committed=false`.
- Negative drift changes chain hash, SQL, parameters, rows, or result and must fail closed.
