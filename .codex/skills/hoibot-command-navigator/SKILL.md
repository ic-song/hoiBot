---
name: hoibot-command-navigator
description: Use for hoiBot command exploration, similar command conflict checks, startsWith/indexOf command guard fixes, helper/save-flow tracing, COMMAND_INDEX.md synchronization, and COMMAND_REGISTRY.md validation.
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

## Required Flow

1. Check `COMMAND_INDEX.md` first when it exists and the task involves command/helper/data-flow exploration.
2. Re-verify all findings in `main.js`, `Info.js`, and related helper definitions.
3. Search related command aliases, output messages, helper calls, data usage, and save flow.
4. For modifications, make the smallest safe change that preserves current behavior.
5. If command/helper/save-flow information changes and `COMMAND_INDEX.md` exists in the active branch, update it from the verified code.
6. Update `COMMAND_REGISTRY.md` only when the command list, `미사용`, `삭제유무`, or `비고` materially changes.

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

## Guard Rules

For mutation-heavy or execution commands, prefer exact or full-pattern command guards over broad prefix checks.
When creating or modifying a slash command, choose the guard before implementing the body and make it match the documented usage exactly. No-argument commands use exact equality; numeric-argument commands use a full anchored pattern, allowing the bare command only when its argument is optional. Free-form suffixes are accepted only when explicitly part of that command contract.
Do not use `msg.startsWith("/명령어")` or `msg.indexOf("/명령어") === 0` for commands that consume items, spend points, sell, remove, equip, open, combine, clean up, or mutate data.

Risky:

```js
if (msg.startsWith("/집청소")) {
```

Safer:

```js
if (msg === "/집청소" || /^\/집청소\s+\d+$/.test(msg)) {
```

Messages with guide text after numeric arguments must not execute.
Invalid arguments should also be ignored unless the existing command intentionally replies with a usage error.

Examples that should not execute:

```text
/집청소 1 해볼래
/고급티켓조합방법
/마정석조합 3 알려줘
```

Before finishing a command change, validate both valid and suffix-text cases:

```text
/명령어
/명령어 1
/명령어 1 해봐
/명령어 번호
```

## References

- Read `references/command-index-workflow.md` for the command exploration checklist.
- Read `references/command-registry-rules.md` when touching `COMMAND_REGISTRY.md`.
- Read `references/risky-command-guards.md` when fixing accidental command execution.
