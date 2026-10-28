---
name: hoibot-command-navigator
description: Use for hoiBot command, alias, guard, handler, COMMAND_INDEX.md, or COMMAND_REGISTRY.md exploration and changes. Persistence and mutation safety belong to hoibot-save-flow-guard.
---

# hoiBot Command Navigator

Use this skill when working with hoiBot commands.

## Core Rules

- The current source code is always the source of truth.
- `COMMAND_INDEX.md` is a navigation helper, not the source of truth.
- `COMMAND_REGISTRY.md` is a human-facing command checklist, not deletion approval.
- A failed search means unverified, not nonexistent.
- Reuse existing helpers and command flows before adding new logic.
- Avoid broad rewrites or large-scale replacements in `main.js`.
- Preserve user-facing formatting, line breaks, emoji, and `allsee` behavior.

## Command exploration

Use [the command-index workflow](references/command-index-workflow.md) for discovery and index maintenance. Verify the actual source; `main.js`/`Info.js` are legacy examples, not required files in every repository. Persistence entrypoints are inputs for save-flow review, not a reason to repeat it.

Update `COMMAND_REGISTRY.md` only when command membership, usage/deletion status or notes materially change; use [the registry rules](references/command-registry-rules.md) for that task.

## Modernization Slice Output

When command exploration is part of hoiBot modernization, also return:

- the target slice ID and user-visible function
- every related command, alias, argument form, and automatic flow
- shared guards, helpers, outputs, JSON paths, load/save calls, and DB candidates
- whether the command is primary, supporting, alias, or automatic within the slice
- unresolved or cross-slice dependencies

Do not reset a previously verified command merely because it is regrouped into a slice. Carry forward only evidence confirmed in the current code, Git, DB, or tests.

When `명령어_이관` usage status is involved:

- keep `미사용 검토` as a paused decision backlog and do not silently convert it to `미사용`
- exclude confirmed `미사용` commands from new slice mapping and migration progress, while preserving their current Rhino source code
- if a confirmed `미사용` command was already migrated, identify command-specific new-system code, DB mappings, fixtures, tests, and shared dependencies so the migration artifacts can be removed without deleting objects used by active slices
- do not mark legacy source removal or `COMMAND_REGISTRY.md` deletion solely from the WBS usage status

## Guard matching

Match executable commands to their actual documented argument contract. Item/currency mutation commands must reject unrelated suffix prose. Use [the risky-command guard examples](references/risky-command-guards.md) when changing those guards and check valid, malformed and suffix-text inputs. Do not infer a new command contract from an example.
