# RFA-03 scenario matrix

| scenario | expected | evidence |
| --- | --- | --- |
| Maria `ER_DUP_ENTRY` + 1062, explicit CUID8 candidate, expected `PRIMARY` | limited candidate regeneration | unit + isolated Maria |
| 1062 business UNIQUE | no CUID retry; exact conflict retained | unit + isolated Maria `uq_rfa03_business` |
| caller tries to supply a business constraint name as collision context | ignored; only literal Maria `PRIMARY` can be a CUID collision | unit |
| 1451/1452 FK conflict | no CUID or transaction retry | unit + isolated Maria 1452 |
| code-only, errno-only, or contradictory pair | `OTHER`; fail closed | unit |
| 1213 deadlock, domain allows | rollback and fresh `withTransaction` attempt | unit + isolated Maria `SIGNAL` |
| 1205 lock wait timeout, domain allows | rollback and fresh `withTransaction` attempt | unit + isolated Maria `SIGNAL` |
| 1213/1205, domain denies | original error, one transaction attempt | unit |
| root 1213/1205 retry | distinct root transaction objects on every attempt | unit |
| savepoint/scoped client receives 1213/1205 | current transaction executes once without savepoint entry; exact original error reaches root owner | unit + isolated Maria |
| CUID or transaction retry limit exhausted | stable wrapper message and exact original error object in `cause` | unit |
| error has own accessors or is a Proxy | no getter/trap execution; classification fails closed and exact original error survives | unit |
| canonical source UNIQUE race | rollback, exact constraint match, committed replay read | identity provider focused test |
| canonical identity CUID PK collision | only `PRIMARY` collision consumes another candidate | identity/import focused tests |
| RFA-01/RFA-02 regression | exact request/replay/receipt/outbox behavior unchanged | combined 63-test focused run |

The Maria test uses a dedicated synthetic database and lease-scoped tables. It records server-produced connector code/errno values and removes the synthetic database after validation.
