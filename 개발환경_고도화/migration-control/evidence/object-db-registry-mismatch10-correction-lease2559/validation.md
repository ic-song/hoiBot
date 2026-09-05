# WBS750 registry mismatch 10 source correction

## Scope

- Catalog: `SC-20260902-1`
- Lease: `2559`
- Execution: `원장불일치교정DB-SL-OBJECT-DB-EXECUTABLE-PARITY-REGISTRY-MISMATCH-CORRECTION-01-202609060240`
- Base: `f31d4a206d36e0125b7735a6911fc1142e785612`
- Runtime command behavior, database, migration, operation data, WBS Gate, `feature/prod`: unchanged
- `COMMAND_REGISTRY.md` usage/deletion state: unchanged

## Source-derived correction

The previous audit searched for a registry label anywhere in `main.js` and then attributed it to whichever consumer span contained those bytes. That made display names, comments, and an internal result comparison look like executable command consumers. The corrected audit first identifies a positive top-level command-entry predicate, then checks whether that predicate accepts the registry command. Anchored composite regular expressions are evaluated with bounded representative argument forms; broad parent prefixes do not own arbitrary descendant command names.

| Before mismatch | Source finding | After |
| --- | --- | --- |
| `main.js:/다이아패스추가` | `main.js:7246` composite `다이아패스(추가\|삭제)` entry; existing logical key and `legacy-2cf2f61871447ec9` | existing stable consumer binding |
| `main.js:/다이아패스삭제` | same source entry, source span `380621..381346`, SHA-256 `c7072e999a7bd1138584fd2470efdf629afc7a0d2783a686eea77948faab64f7` | same stable consumer binding |
| `main.js:/길드계급표` | exact read-only handler at `main.js:26090`; already explicitly excluded by `isExcludedLegacyObjectSurface` from object DB consumers | object-consumer mismatch excluded |
| `main.js:/길드스타터오픈4` | only item display name/reply at `main.js:10827-10832`; executable entry is `/길스스스스...` | confirmed registry-source decision backlog; no ID attribution |
| `main.js:/길드스타터오픈5` | only item display name/reply at `main.js:10852-10857`; executable entry is `/길스스스스스...` | confirmed registry-source decision backlog; no ID attribution |
| `main.js:/길드영지오픈1` | only item display name/reply at `main.js:10652-10657`; executable entry is `/길영...` | confirmed registry-source decision backlog; no ID attribution |
| `main.js:/오픈하면어른이됩니다` | only package display name at `main.js:27543`; executable entry is `/어버...` | confirmed registry-source decision backlog; no ID attribution |
| `main.js:/창세오픈` | comment only at `main.js:14763`; nearby executable command is separately registered `/창조오픈` and is not guessed as an alias | confirmed registry-source decision backlog; no merge/rename/deletion |
| `main.js:/펫탐험시작` | internal comparison at `main.js:6129,6157` inside the `/펫탐험정산`/timer entry, not an independent top-level entry | confirmed registry-source decision backlog; no ID attribution |
| `main.js:/호월오픈` | only item display name/reply at `main.js:8409-8414`; executable entry is `/호월...` | confirmed registry-source decision backlog; no ID attribution |

### Residual reconciliation

The original mismatch 10 separates into three corrected classifications and seven remaining registry-source decision rows. Applying the same command-token boundary rule to every active registry row also exposed one pre-existing false binding that was not in the original ten: `main.js:/펫먹`. Its active registry label had been accepted only because the raw substring occurred at the start of `/펫먹이조합` and `/펫먹이박스오픈`; neither longer command is an executable `/펫먹` guard. It is therefore retained fail-closed as a newly discovered eighth unattributed decision-backlog row. No alias, exception, registry edit, merge, deletion, or consumer ID was guessed.

This audit answers whether an executable source guard owns the registry label; it does not certify runtime prefix safety. A `startsWith`, `indexOf`, or `includes` call whose string literal exactly equals the registry command is therefore recognized as an existing source guard, while a command found only as a raw substring inside a longer literal is rejected. Broad-guard runtime safety is a separate review backlog outside this lease.

Search keywords: the original ten registry labels plus `/펫먹`, their enclosing `if` predicates, `registrySourceMismatches`, `deriveConsumerLogicalKey`, and `legacyEntryStatements`. Files checked: `COMMAND_INDEX.md`, `COMMAND_REGISTRY.md`, `main.js`, consumer manifest, stable ID registry, transition audit and executable ledger builder/validator. The only modified logic is classification/evidence generation. No game-runtime helper, JSON save/load path, or command output changed.

## Result

| Metric | Before | After |
| --- | ---: | ---: |
| Manifest consumers / ledger entries | 1,111 / 1,111 | 1,111 / 1,111 |
| Consumer set SHA-256 | `f103c427a8e632ada272149529c3dcc740734832c8fadb89c7bd254ae59ff0a1` | same |
| Stable ID registry canonical SHA-256 | `976453a286f4ba590179ef683672c8725152f785913d8d57c285e3fb9edf928b` | same; file unchanged |
| Registry mismatch total | 10 | 8 (7 original residual + 1 newly exposed boundary mismatch) |
| Attributed / unattributed | 7 / 3 | 0 / 8 |
| `BLOCKED_REGISTRY_MISMATCH` | 7 | 0 |
| `STATIC_ONLY` / `BLOCKED_DYNAMIC` | 558 / 546 | 559 / 552 |
| Proven / unproven | 0 / 1,111 | 0 / 1,111 |

Current canonical hashes use `CRLF_AND_CR_TO_LF_BEFORE_HASH`:

- consumer manifest: `bac5cfebd63e31cada18f0903fd5f8bd215cd34ac764c4ab2c91c245e9fa0f7a`
- executable ledger schema: `ca8cda281946533405d9d179eb906638ace0671f899d442b2462bd8c05b57a05`
- executable ledger: `a3e42ea172f64f67d8d6df8367ecdec2eb4185cec5a759b32c766d066bee88d8`
- ledger entry set: `aed8cfa936cd03f0ca86e168156b8eaa7ac789d1dc3a2ca308e2d35580c3ec40`

## Validation

Run from `개발환경_고도화/runtime`:

```text
node --import tsx scripts/build-object-db-consumer-transition-manifest.ts
node --import tsx scripts/build-object-db-consumer-executable-parity-ledger.ts
node --import tsx scripts/validate-object-db-consumer-executable-parity-ledger.ts
node --import tsx --test test/object-db-consumer-transition-contract.test.ts test/object-db-consumer-stable-id.test.ts test/object-db-consumer-executable-parity-ledger.test.ts
npm run typecheck
npm run build
npm run object-data:validate
```

Results:

- Dependency restore: PASS, 82 packages; `package.json` and `package-lock.json` unchanged
- Focused tests: PASS, 26 / 26 (24-test contract/ID/ledger set plus leaf-guard and manifest-binding boundary regressions)
- Deterministic ledger validation: PASS
- Ledger and receipt Draft 2020-12 validation: `AJV2020_STRICT_PASS`
- TypeScript typecheck: PASS
- TypeScript build: PASS
- Object data model validator: PASS, 98 registered targets
- JSON parse: PASS, 3 changed/generated contracts plus the unchanged stable ID registry control
- `git diff --check`: PASS
- Full `npm test` and MariaDB: not run by this bounded T1 lease

The executable ledger remains deliberately fail-closed at `PASS=0`. Eight active registry rows without executable source guards remain visible as an unattributed decision backlog; seven are residuals from the original ten and `/펫먹` is the additional boundary mismatch exposed by this correction. This lease does not change their usage/deletion status. This correction removes false consumer-ID ownership only and does not claim WBS751 harness execution or WBS744 Gate 6 completion.
