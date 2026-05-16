# Save/Load Flow

When persistence changes, verify both read and write paths.

## Check

- which data object is loaded
- which variable is mutated
- which path is saved
- whether surrounding response flow also saves
- whether multiple files must be saved together
- whether helper functions are receiving loaded data instead of loading/saving files themselves
- whether load failures are left visible instead of being silently replaced with empty/default data

## Common Risk

A command may mutate:

- `data`
- `petData`
- `guildData`
- `petSkillData`
- home or mini-pet data

Each mutation needs the correct persistence path.

Avoid helper-level file IO. If a helper is called repeatedly, `loadJsonFile` or `saveJsonFile` inside that helper can multiply disk IO and hide command-level save order. Prefer this shape:

```js
var data = loadJsonFile(filePath);
var result = helper(data, msg);
if (result.ok) saveJsonFile(data, filePath);
```

Do not wrap `loadJsonFile` so parse/missing-file failures become `[]`, `{}`, or default data unless the user explicitly asked for a recovery or initialization command.
