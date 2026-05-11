---
name: hoibot-save-flow-guard
description: Use when hoiBot changes touch saveJsonFile/loadJsonFile, data mutation, DEV/PROD path flow, data snapshots, inventory/point/item mutations, or persistence-sensitive command logic.
---

# hoiBot Save Flow Guard

Use this skill when a change mutates game data or touches persistence.

## Core Rules

- Verify `saveJsonFile` and `loadJsonFile` usage when save logic changes.
- Preserve DEV/PROD path behavior.
- Treat `data/*.json` as production-like snapshots.
- Never overwrite original snapshot files during validation.
- Use copies or DEV contexts when mutation testing is required.
- Mutation-heavy commands need careful input guards.

## Save Flow Checklist

1. Identify every mutated data object.
2. Identify the expected save file for each object.
3. Verify the matching save call exists.
4. Verify no unrelated file is saved or mutated.
5. Check DEV/PROD path handling if paths are touched.
6. Validate JSON parsing for any changed data file or generated snapshot.

## References

- Read `references/save-load-flow.md` for save/load review.
- Read `references/dev-prod-paths.md` when path logic changes.
- Read `references/data-snapshot-safety.md` before testing with data files.
