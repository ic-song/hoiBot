# Object DB executable parity Wave1 validation

## Scope and provenance

- Lease: 2561
- Trusted-input phase1 commit: `25669eb87fa1e26131063379dc92e7e342ee8e2e`
- Phase1 commit message: `실행 패리티 신뢰 입력과 검증 경계를 강화`
- The validator confirmed that the commit exists, is an ancestor of current `HEAD`, and contains the fixture, runner, target, and repository source blobs used by every receipt.
- Generated receipts, ledger, and this validation record are phase2 outputs and intentionally remain uncommitted for independent review.

## Proven cohort

One reusable case, `case:canonical-title-list-owned`, is bound only to the three consumers that execute the same `MariaCanonicalTitleRepository.listOwned` path. Each binding retains its own exact manifest locator, domain/table/ID configuration, input, assertion, raw result, SQL, DML/row/lock/transaction trace, and restart evidence.

| consumerId | exact symbol | verdict transition |
| --- | --- | --- |
| `sql-repository-0dc3c380c54081a2` | `member.listOwned` | `STATIC_ONLY` → `DIRECT_PASS` |
| `sql-repository-6a1bdfaafba10749` | `mini-pet.listOwned` | `STATIC_ONLY` → `DIRECT_PASS` |
| `sql-repository-a0a5f5d8f3338d7b` | `pet.listOwned` | `STATIC_ONLY` → `DIRECT_PASS` |

All other 1,108 consumer IDs remain unproven and unchanged. This work does not claim full 1,111-consumer proof, WBS 744 completion, or any Gate completion.

## Generated evidence

- Receipt count: 15 (five required scenarios for each of three consumers)
- Ledger entry-set SHA-256: `e349c167b29844f20766d4656ede236ba4f3bf26f7fa0ae72521c0b005482578`
- Ledger file SHA-256: `f6eb5943ea921eaa25f9b0b1abdb60780afc0f6f6b823af87fe6b74350c3bd2a`
- Receipt bundle SHA-256: `55d46daf9186510ca5e52c42e32ee7dec7e1524675ad07aece6449b09e5ca587`
- Trusted fixture SHA-256: `e69bb41cd41442741014394812faf7acf5411e4d59ed758f649ddf0a5b29e94d`
- Trusted runner SHA-256: `90cbe285e8b249cd730b36e42782d2522fcdafbef7302d3b26fbcba0c41417f0`
- Trusted target SHA-256: `cf1d6e72f4574ee0b2a85318fd6dfded7bb94a97b006943dce046b95d2f6f0fa`

Final ledger coverage is 1,111 entries: `DIRECT_PASS=3`, `STATIC_ONLY=556`, `BLOCKED_DYNAMIC=552`, `PARTIAL=0`, `EQUIVALENT_PASS=0`; source-registry mismatches remain 8 total and 8 unattributed.

## Focused verification

- `node --import tsx scripts/validate-object-db-consumer-executable-parity-ledger.ts`: PASS; ledger and receipt schemas both `AJV2020_STRICT_PASS`; evidence commit ancestor and three committed trusted-input paths attested.
- Wave0 defense, Wave1 cohort, trusted-runner defense, and Maria canonical title repository focused tests: 19/19 PASS.
- Negative defenses cover swapped member→pet domain, symbol, interface, and selection table; query-channel `DELETE`; self-declared trace; and fake restart identity.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- Node syntax checks for the runner, trusted target, and three negative targets: PASS.
- JSON parse for ledger, receipt bundle, and trusted fixture: PASS.
- UTF-8/BOM/EOL check: PASS; inspected phase2/trusted evidence files have no BOM, no bare CR, and LF line endings.
- `git diff --check`: PASS.

No package, migration, database, runtime command behavior, operational data, feature/prod, Gate, or Sheets changes were made. No full test suite was run.
