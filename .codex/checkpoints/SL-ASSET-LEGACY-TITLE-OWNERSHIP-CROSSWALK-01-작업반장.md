# SL-ASSET-LEGACY-TITLE-OWNERSHIP-CROSSWALK-01 checkpoint

- execution: `작업반장-SL-ASSET-LEGACY-TITLE-OWNERSHIP-CROSSWALK-01-2026090213`
- baseline: `5aca301fb2c9b6be4384d232bcef6191d8cf0789`
- catalog version: `ASSET-FREEZE-v2.438-title-ownership-01`
- scope: legacy member-title ownership reference correction only
- Gate 1-7: verified
- Gate 8: false

## Frozen result

- raw ownership rows: 368,458
- raw distinct title names: 2,089
- title definitions projected: 125
- virtual projections added from the existing title catalog: 25
- additionally resolved references: 104,305
- remaining title identities/occurrences: 2,033 / 262,544
- inactive: 2 / 1,347
- orphan: 2,031 / 261,197
- canonical duplicate/collision: 0 / 0

The unresolved names are quarantined. They are not merged or seeded by display name. Raw names and the private crosswalk remain only under the local TEMP directory.

## Verification

- focused tests: 4/4 PASS
- root focused/full: 32/32 PASS
- runtime full: 1,576 PASS, 0 FAIL, 8 SKIP
- typecheck/build: PASS
- MariaDB migrations: 429 carry-forward; schema/migration changes: 0
- restart/reconnect report hash: `135ca38f9838854d5cd8769e893d0d40ec558a53a39054ab23216eeb3c5beffa`
- canonical hash: `055062decc7da0c4b8037935ec62af850f88681b52e251384188ab5d623502b8`
- normalized crosswalk replay hash: `e96ba7e402df6c258523011b669aadfa02bb4be295eb9b9d164fed1ab97138ea`

`DATA-MIGRATION-READY` remains false. No Gate 8, feature/prod, operational DB, legacy source, or legacy data mutation was performed.
