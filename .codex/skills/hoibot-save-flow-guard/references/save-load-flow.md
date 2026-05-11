# Save/Load Flow

When persistence changes, verify both read and write paths.

## Check

- which data object is loaded
- which variable is mutated
- which path is saved
- whether surrounding response flow also saves
- whether multiple files must be saved together

## Common Risk

A command may mutate:

- `data`
- `petData`
- `guildData`
- `petSkillData`
- home or mini-pet data

Each mutation needs the correct persistence path.
