# Legacy title ownership crosswalk

This slice extends the canonical reference snapshot with the 125 definitions already present in `title_definition_catalog_entries`. The existing 100 object-registry TITLE projections are enriched by stable `definitionCode`; the 25 catalog-only definitions are emitted as virtual read-only projections.

No title definition, ownership row, schema, migration, or runtime provider is created. Display names are used only for exact legacy reference comparison and never as a new canonical identity.

## Result

| Metric | Count |
| --- | ---: |
| Legacy ownership rows | 368,458 |
| Distinct legacy title names | 2,089 |
| Existing title definitions | 125 |
| Virtual catalog projections | 25 |
| Additional resolved occurrences | 104,305 |
| Remaining title identities | 2,033 |
| Remaining title occurrences | 262,544 |

The remaining 2,031 orphan identities and 2 inactive identities stay quarantined for a later source-authority decision. `DATA-MIGRATION-READY` therefore remains false.

Only the aggregate public classification is committed. Raw ownership names and row-level mappings remain in local TEMP evidence and are excluded from Git and WBS.
