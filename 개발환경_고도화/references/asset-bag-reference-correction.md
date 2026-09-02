# Legacy bag item reference correction

The legacy bag contains a computed pet-intimacy display key that embeds level, current experience, and increase amount. Each state-shaped key is an ownership projection, not a reusable ITEM definition.

This slice excludes only that exact full-string pattern from definition reference validation. Nearby names, suffix text, other item names, inactive definitions, and ambiguous definitions continue to fail closed.

## Result

| Metric | Count |
| --- | ---: |
| Prior ITEM gap identities | 3,306 |
| Dynamic projection identities | 3,076 |
| Dynamic projection occurrences | 21,980 |
| Remaining ITEM identities | 230 |
| Remaining ITEM occurrences | 234,347 |

The remaining 212 orphan, 16 inactive, and 2 ambiguous identities stay quarantined. No name-derived definition, schema, migration, ownership row, or provider is created.

Only aggregate classification is committed. Raw names and row-level mappings remain in local TEMP evidence and are excluded from Git and WBS.
