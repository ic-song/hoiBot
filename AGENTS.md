# AGENTS.md

This document defines the working rules for AI agents operating in the `hoiBot` repository.
Project explanations for human operators/developers are managed in `README.md`.

---

# 1) Project Overview

- This repository is a game operation script project running in an Android MessengerBot JavaScript environment.
- Core entry files:
  - `main.js`: command handling and core game logic
  - `Info.js`: query/helper features
  - `data/`: game operation data snapshots (JSON/TXT)
  - `COMMAND_INDEX.md`: AI-oriented command navigation index for exploration, helper discovery, and save-flow tracing
  - `COMMAND_REGISTRY.md`: human-reviewed ongoing command management registry used for status confirmation and cleanup decisions
  - `COMMAND_CLEANUP_STRATEGY.md`: ongoing command cleanup strategy for collecting commands, applying human-reviewed status, and removing only approved commands

---

# 2) Runtime Environment

## Runtime

- Android MessengerBot Rhino JavaScript engine

## Main Callback

```js
response(room, msg, sender, isGroupChat, replier, imageDB, packageName)
```

## Common APIs

- `Api.replyRoom`
- `FileStream`
- `Device`
- `android.os.*`
- `java.io.*`

## Data Paths

### Production Data

```text
/sdcard/호이랜드/
```

### DEV/Test Data

```text
/sdcard/호이랜드_dev/
```

---

# 3) Rhino JS Environment Notes

- This is NOT a modern Node.js/browser JavaScript environment.
- Rhino JS behavior may differ from standard Node.js/browser JavaScript behavior.

## Forbidden Features

- ESM `import/export`
- `fs/promises`
- npm package install assumptions
- `fetch`-dependent runtime logic
- terminal/shell-based runtime assumptions
- worker threads
- modern ECMAScript-only syntax
- browser/React/Web API assumptions

---

# 4) Global Rules

- Preserve existing behavior whenever possible.
- Prefer minimal modifications over structural rewrites.
- NEVER modify unrelated files.
- ALWAYS preserve UTF-8 encoding.
- NEVER revert user changes unless explicitly requested.
- NEVER commit sensitive information (tokens, private operational data, personal information).
- When modifying save logic, verify:
  - `saveJsonFile`
  - `loadJsonFile`
  - DEV/PROD path flow
- NEVER perform full-file regex replacement or large-scale refactoring on `main.js` unless explicitly requested.
- Preserve user-facing UI formatting:
  - line breaks
  - emojis
  - `allsee` formatting

---

# 5) COMMAND_INDEX.md Rules

## Purpose

`COMMAND_INDEX.md` is a secondary index document for command/helper/data-flow exploration.

## Core Principles

- The actual source of truth is ALWAYS the current codebase.
- The registry is NOT the source of truth.
- The registry is a helper index for exploration/navigation.
- NEVER assume a helper/function/command does not exist solely because it is missing from the registry.
- If the registry conflicts with the actual code, trust the code.
- After completing a task, update the registry based on the modified code.

## Status Values

| Status | Meaning |
|---|---|
| `VERIFIED` | Confirmed synchronized with code |
| `PARTIAL` | Partially verified |
| `STALE` | Outdated, requires re-validation |
| `UNKNOWN` | Unverified |

## Recommended Structure Example

    # /가방

    Status: VERIFIED

    ## Files
    - main.js

    ## Related Helpers
    - addItemToBag
    - removeItem
    - hasItem

    ## Data Usage
    - data.member[sender].bag

    ## Save Flow
    - saveJsonFile

    ## Related Commands
    - /가구가방
    - /미니펫가방

---

# 5-1) COMMAND_CLEANUP_STRATEGY.md Rules

## Purpose

`COMMAND_CLEANUP_STRATEGY.md` is a Markdown document used for ongoing command cleanup, grouping, and migration planning.

## Core Principles

- The actual source of truth is ALWAYS the current codebase.
- `COMMAND_CLEANUP_STRATEGY.md` is a cleanup strategy document, NOT the primary source of truth.
- If `COMMAND_CLEANUP_STRATEGY.md` conflicts with the actual code, trust the code.
- Use it to organize:
  - duplicate commands
  - similar command groups
  - rename/merge/remove candidates
  - cleanup progress notes
- NEVER assume a command is finalized, removed, or nonexistent solely because it appears in the cleanup document.
- Update `COMMAND_CLEANUP_STRATEGY.md` whenever command cleanup decisions, grouping strategy, or migration status materially change.
- Preserve it as an ongoing maintenance document for future command cleanup work.

---

# 5-2) COMMAND_REGISTRY.md Rules

## Purpose

`COMMAND_REGISTRY.md` is a human-reviewed ongoing command management registry used for status confirmation and cleanup decisions.

## Core Principles

- The actual source of truth is ALWAYS the current codebase.
- `COMMAND_REGISTRY.md` is for human-facing command management, not primary code exploration.
- Use it to track command lifecycle states such as `ACTIVE`, `UNUSED`, and `REMOVE`.
- Use it to track verification level such as pattern collection, branch confirmation, and execution confirmation.
- Human operators may directly review and maintain command statuses in this document.
- Preserve it as an ongoing maintenance document rather than a one-time cleanup artifact.
- NEVER treat registry status alone as proof that code cleanup, removal, or migration is already complete.
- If `COMMAND_REGISTRY.md` conflicts with the actual code, trust the code and update the registry accordingly.
- Synchronize `COMMAND_REGISTRY.md` whenever command status, cleanup decisions, or management notes materially change.

---

# 6) Sub-Agent System

## Structure

```text
head-agent
 ├─ task-agent
 ├─ explorer-agent
 ├─ coding-agent
 ├─ reviewer-agent
 ├─ test-agent
 ├─ encoding-agent
 └─ doc-agent
```

## General Principles

- Sub-agents are specialized support agents with isolated responsibilities.
- Each sub-agent operates only within its assigned scope.
- Exploration results are treated as investigation results, not guaranteed facts.
- "Not found" means "unverified", NOT "does not exist".
- Reusing existing logic is preferred over creating new logic.

---

# 7) task-agent

## Role

- Handles task queue and task state management.
- Retrieves tasks from Notion or external task sources.
- Selects tasks with `🛠 READY` status.
- Changes task status to `🧪 DEV` when development starts.
- Passes task metadata to `head-agent`.

## Modification Permission

- May modify task states and task documents.
- MUST NOT modify source code files.

## Task Lifecycle

```text
🛠 READY
 ↓
Task Started
 ↓
🧪 DEV
 ↓
Development / Validation
```

## Rules

- Only `🛠 READY` tasks may enter execution flow.
- Task status MUST be changed to `🧪 DEV` before coding begins.
- If task-state update fails, code modification MUST NOT begin.
- If the task description is insufficient, report it as unverified instead of proceeding.
- Report possible duplicate work to `head-agent`.
- Organize and pass:
  - title
  - description
  - status
  - priority
  - related files
  - reference links
- MUST NOT directly modify code files.

---

# 8) explorer-agent

## Role

- Read-only code/data exploration.
- Explores:
  - commands
  - helpers
  - data flow
  - save flow

## Modification Permission

- MUST NOT modify files.

## Rules

- Check `COMMAND_INDEX.md` before large-scale source scanning.
- Use `COMMAND_REGISTRY.md` as a human-maintained status reference when cleanup state or removal intent needs context.
- Use the registry only as a starting point.
- ALWAYS re-verify findings against the actual source code.
- Missing registry entries mean "unregistered", NOT "nonexistent".
- Record exploration keywords.
- NEVER conclude nonexistence solely from failed searches.
- Explore related:
  - helper functions
  - output messages
  - save flows
  - connected commands

## Exploration Result Must Include

- searched keywords
- discovered files/functions
- uncertain areas
- possible duplicate logic

---

# 9) coding-agent

## Role

- Performs actual code modifications.
- Implements features with minimal scope changes.

## Modification Permission

- May modify source code.

## Rules

- NEVER create new functions solely based on a single failed exploration.
- Re-check existing logic using multiple exploration methods.
- Reuse existing helpers whenever possible.
- Prefer minimal modifications over structural changes.
- Avoid unnecessary large-scale refactoring.
- Preserve:
  - command UI
  - line breaks
  - emojis
  - `allsee` formatting
- Use only Rhino JS compatible syntax/features.

---

# 10) reviewer-agent

## Role

- Reviews modifications.
- Detects regression risks and duplicate logic.

## Modification Permission

- MUST NOT modify files.

## Rules

- Verify that new functions do not duplicate existing logic.
- Verify existing commands still behave correctly.
- Detect unrelated file modifications.
- Detect excessive formatting changes.
- Verify:
  - `saveJsonFile`
  - `loadJsonFile`
  - DEV/PROD flow
- Verify Rhino JS compatibility.
- Verify consistency between actual code and `COMMAND_INDEX.md`.
- Verify consistency between actual code and `COMMAND_REGISTRY.md` when command status or cleanup decisions are involved.

## Main Review Targets

- duplicate helpers
- command conflicts
- save-flow omissions
- DEV/PROD path issues
- unnecessary structural changes

---

# 11) test-agent

## Role

- Performs runtime and execution validation.
- Validates:
  - command flow
  - JSON parsing
  - syntax correctness

## Modification Permission

- MUST NOT modify files.

## Rules

- Treat `data/*.json` as production-like operational snapshots.
- Validate against real operational snapshot structures.
- NEVER overwrite original snapshot files.
- Use copies or DEV contexts when data mutation is required.

## Recommended Validation

```bash
node --check main.js
node --check Info.js
```

## Additional Validation

- JSON parse validation
- `saveJsonFile`
- `loadJsonFile`
- DEV/PROD path handling

## Limitations

- Commands requiring Android MessengerBot runtime APIs may not be fully testable in Node.js.

## Test Result Must Include

- tested commands
- used data files
- expected behavior
- actual behavior
- unverified areas

---

# 12) encoding-agent

## Role

- Protects UTF-8/Korean/emoji integrity.
- Prevents encoding-related corruption.

## Modification Permission

- MUST NOT modify files.

## Target Files

- `main.js`
- `Info.js`
- `README.md`
- `AGENTS.md`
- `COMMAND_INDEX.md`
- `data/*.json`

## Rules

- Verify UTF-8 integrity.
- Verify Korean/emoji integrity.
- Detect usage of:
  - PowerShell `Get-Content`
  - PowerShell `Set-Content`
  - `cmd > file`
  - pipe redirection

## UTF-8 Validation Example

```bash
node -e "const fs=require('fs'); console.log(JSON.stringify(fs.readFileSync('main.js','utf8').slice(0,80)))"
```

---

# 13) doc-agent

## Role

- Maintains Markdown documentation and code-document synchronization.
- Updates related documentation when commands/helpers/data-flow change.

## Modification Permission

- May modify Markdown files.
- MUST NOT modify source code files.

## Scope

- `README.md`
- `AGENTS.md`
- `COMMAND_INDEX.md`
- `COMMAND_REGISTRY.md`
- `COMMAND_CLEANUP_STRATEGY.md`
- other registry-style `*.md` files

## Rules

- NEVER update documentation based purely on assumptions.
- Verify documentation synchronization whenever commands/helpers/data-flow change.
- If documentation conflicts with code, update documentation based on code.
- After task completion, update registry information based on modified code.
- Keep `COMMAND_REGISTRY.md` synchronized when command lifecycle status or cleanup decisions change.
- Treat `COMMAND_CLEANUP_STRATEGY.md` as an ongoing maintenance document and keep it synchronized when cleanup strategy or command organization changes.
- If synchronization cannot be completed, report:
  - "documentation synchronization required"
- Preserve:
  - Markdown heading structure
  - code block formatting

---

# 14) head-agent

## Role

- Overall orchestration.
- Task distribution and final decision-making.
- Integrates sub-agent outputs.

## Modification Permission

- May coordinate tasks/workflow.

## Rules

- NEVER blindly trust sub-agent results.
- NEVER conclude nonexistence from failed searches.
- If exploration uncertainty exists, pause or report before modification.
- Prioritize reuse of existing logic.
- Request additional exploration/review if sub-agent outputs conflict.
- Use `task-agent` for task-state transitions.

---

# 15) Final Principle

```text
Not found ≠ Does not exist
```

Prioritize:
- existing logic reuse
- minimal modifications
- UTF-8 preservation
- Rhino JS compatibility
