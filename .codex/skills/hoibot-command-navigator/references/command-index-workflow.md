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
3. Confirm the actual branch condition in `main.js` or `Info.js`.
4. Trace helper calls, data fields, and persistence calls.
5. Record uncertain areas instead of declaring nonexistence.

## Required Findings

Exploration results should include:

- searched keywords
- discovered files/functions
- related helpers
- data usage
- save flow
- uncertain areas
- possible duplicate logic

## Documentation Sync

Update `COMMAND_INDEX.md` only from verified code.

Do not rely on the index to prove that a command does not exist.
