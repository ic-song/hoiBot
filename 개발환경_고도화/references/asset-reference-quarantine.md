# Asset reference quarantine contract

This contract makes unresolved legacy asset references safe for an isolated migration rehearsal without inventing canonical definitions.

The private manifest records only issue kind, requested type, hashed identity, and exact occurrence count. Validation fails closed when any of the following changes:

- staging snapshot hash
- canonical snapshot hash or catalog version
- manifest content hash
- issue kind or requested type
- identity hash or occurrence count
- full issue-set coverage

## Current sealed result

| Metric | Count |
| --- | ---: |
| References | 2,055,629 |
| Canonically resolved occurrences | 1,499,513 |
| Quarantined identities | 3,367 |
| Quarantined occurrences | 556,116 |
| Unapproved issues | 0 |

`DATA-MIGRATION-READY=true` means WBS690 may run against a fresh isolated MariaDB while preserving all quarantined values outside canonical ownership tables. It does not authorize operational import, Gate 8, automatic definition creation, or deletion of legacy data.
