# WBS744 Gate6 Wave0 executable parity ledger validation

## Scope

- Catalog: `SC-20260902-1`
- Lease: `2557`
- Classification base commit: `f97be62292c3f7e8ea79b2d6f302dd25517584d4`
- Evidence commit: `f07021701d2f058531512b0e805dc0d9c4b2a3fb`
- Runtime, dispatcher, legacy source, database, migration, operation data, WBS Gate and `feature/prod`: unchanged
- This Wave0 artifact is a fail-closed evidence ledger foundation. It does not prove executable parity for any consumer.

## Authoritative inputs

All text hashes use `CRLF_AND_CR_TO_LF_BEFORE_HASH`.

| Input | SHA-256 |
| --- | --- |
| Ledger JSON Schema | `917dc31618a15e78036dcf31ea18b6585bb42e99e454bc34c9b1371079c3632c` |
| Execution receipt JSON Schema | `ddbb42eec2fcd105d630e226e2dbc6467bada385473cb4169bc62660831c1c34` |
| Allowlisted executable harness | `2ed73f163cc81dafc9b3d94469e538d964257a95d778f6a02779996d483fbe2b` |
| Invoked synthetic consumer target | `cb196e95253ea4b58f65e94d60e6acd4028b4c3d9697330e77a7386becd370ec` |
| Consumer manifest | `ce2d0c6a9ff8b5fecf3a69ff0187fa3c747801937e0bc1bbc6f5acd69557f233` |
| Manifest consumer set | `f103c427a8e632ada272149529c3dcc740734832c8fadb89c7bd254ae59ff0a1` |
| Stable consumer ID registry | `976453a286f4ba590179ef683672c8725152f785913d8d57c285e3fb9edf928b` |
| Consumer transition contract | `b11b60649e12bb63bc7cb6ab5d58f2c1bb260e3b786ca4eb736822e20118483e` |
| Empty Wave0 execution receipt bundle | `b0207c4bd1b267d75686fa7f643d4fbfeb2497a2936343449a745305bbf795b8` |
| Registry-mismatch classification source (`main.js`) | `d8541a602a5fda8a2d6d20f7f0214d42c4285775c595816deda7355605e1e6c0` |

Generated entry set SHA-256:

```text
766787db79485f9c92b03c4f8ca58a3869288889166a00b7d96ba66b54772cfe
```

## Baseline result

| Metric | Result |
| --- | ---: |
| Manifest consumers | 1,111 |
| Ledger entries | 1,111 |
| Missing / duplicate / unknown IDs | 0 / 0 / 0 |
| Read consumers | 499 |
| Mutation consumers | 612 |
| Unresolved dynamic consumers / calls | 552 / 790 |
| Registry source mismatches | 10 |
| Registry mismatch attributed / unattributed | 7 / 3 |
| `STATIC_ONLY` | 558 |
| `BLOCKED_DYNAMIC` | 546 |
| `BLOCKED_REGISTRY_MISMATCH` | 7 |
| `PARTIAL` | 0 |
| `DIRECT_PASS` / `EQUIVALENT_PASS` | 0 / 0 |
| Proven / unproven | 0 / 1,111 |

The validator derives registry mismatch ownership from the frozen source span and its hash. Seven labels bind to exact stable consumer IDs; three labels have no valid source-span owner and remain explicitly unattributed. Mismatch takes precedence over dynamic blocking, so the six overlapping dynamic consumers are counted only as `BLOCKED_REGISTRY_MISMATCH` verdicts.

## Fail-closed rules

- Every manifest consumer joins exactly one ledger entry by stable `consumerId`.
- Missing, duplicate, unknown, stable-ID drift, source classification drift, source hash drift and coverage drift are rejected.
- A family-level test cannot promote an entry. Every PASS scenario requires a machine-readable receipt bound to the exact consumer, harness, harness case, fixture and scenario IDs.
- Receipt fingerprints and harness/fixture/invocation-target hashes are recomputed. Only `NODE_OBJECT_DB_PARITY_V1` and its fixed entrypoint are accepted; runner metadata is operationally used to start a child Node process.
- The harness imports and invokes the hashed target export, performs assertions, exits successfully, and writes `passed=true`, positive `assertionCount`, executed consumer/case IDs and invocation target path/hash to a machine case-result artifact. Stdout/print-only harnesses are rejected.
- The harness writes reply/result raw byte artifacts and a raw DML/row/lock/transaction trace. The validator reads those files itself, recomputes fingerprints/normalization and compares them to the receipt. Missing raw artifacts or self-declared hashes cannot promote PASS.
- Every READ scenario is `READ_ONLY` with business DML0. Mutation auth denial, wrong-room denial, payload drift, duplicate replay and restart replay all require business DML0; payload drift also requires rollback.
- READ requires positive, negative guard, exact output, source-domain DML-zero and restart consistency scenarios. MUTATION requires success, failure rollback, duplicate replay DML-zero, payload-drift fail-close, restart replay and concurrency single-writer. Source classification additionally requires auth/wrong-room scenarios, or the exact source-derived not-applicable rule and evidence hash.
- A valid incomplete receipt matrix is only `PARTIAL`; only the complete matrix can be `DIRECT_PASS` or `EQUIVALENT_PASS`.
- `EQUIVALENT_PASS` additionally requires the versioned `SAME_INTERFACE_ACCESS_V1` mechanical rule and the exact complete set of every consumer ID with the same interface and access class. Every listed variant must independently carry the same equivalent-pass rule.
- LF and CRLF source serialization produce the same ledger and source hashes.

## Validation commands

Run from `개발환경_고도화/runtime`.

```text
npm ci --no-audit --no-fund
node --import tsx scripts/build-object-db-consumer-executable-parity-ledger.ts
node --import tsx scripts/validate-object-db-consumer-executable-parity-ledger.ts
node --import tsx --test test/object-db-consumer-executable-parity-ledger.test.ts
npm run typecheck
npm run build
npm run object-data:validate
```

Results:

- Dependency restore: PASS, 82 packages, tracked dependency files unchanged
- Focused tests: PASS, 8 / 8
- Deterministic ledger validator: PASS
- Draft 2020-12 ledger and receipt JSON Schema compilation/validation (`Ajv2020`, strict mode): PASS, 1,111 entries / 0 Wave0 receipts
- TypeScript typecheck: PASS
- TypeScript build: PASS
- Object data model validator: PASS, 98 registered targets
- MariaDB / full `npm test`: not run by this bounded Wave0 lease

## Explicit non-achievement

Wave0 records `PASS=0`. Static discovery, an existing family test, or a selector/manifest match is not executable parity evidence. WBS744 Gate6 and any whole-consumer parity claim remain unachieved until later evidence waves promote exact IDs under this contract.
