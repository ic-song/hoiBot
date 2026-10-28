# Command Index Workflow

Use this checklist when exploring or changing hoiBot commands.

## Exploration

1. Start from `COMMAND_INDEX.md` if present.
2. Search the actual source with `rg`:
   - command text
   - aliases
   - output phrases
   - helper names
   - item names
3. Confirm the actual handler/branch in the current source (`main.js`/`Info.js` in legacy hoiBot).
4. Trace aliases, helpers and handler calls. Note persistence entrypoints without repeating a separate save-flow audit.
5. Record uncertain areas instead of declaring nonexistence.

## Findings

Return only the paths, handlers/helpers, relevant persistence entrypoints, possible duplicate behavior and uncertainties needed for the request. Reuse findings already supplied instead of generating another full checklist.

## Documentation Sync

Update `COMMAND_INDEX.md` only from verified code.

Do not rely on the index to prove that a command does not exist.
