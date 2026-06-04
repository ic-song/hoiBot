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
  - `tools/`: local helper scripts for development/operation workflows
  - `.codex/skills/`: repo-managed source copies of hoiBot Codex skills
  - `.codex/skill-drafts-ko/`: Korean review drafts for hoiBot Codex skills, not auto-loaded skill sources
  - `COMMAND_INDEX.md`: AI-oriented command navigation index for exploration, helper discovery, and save-flow tracing
  - `COMMAND_REGISTRY.md`: human-facing command source, unused, removal, and note checklist
  - `ERROR_FIX_LOG.md`: runtime error investigation records for future bug-fix reference

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
- Do not hide or normalize `loadJsonFile` failures. If a JSON file is missing, invalid, or cannot be parsed, let the existing load/error flow fail naturally unless the user explicitly requests recovery behavior.
- Avoid `loadJsonFile` / `saveJsonFile` calls inside helper functions. Load and save in the command/entry flow, then pass already-loaded data into helpers so repeated helper calls do not cause repeated file IO.
- NEVER perform full-file regex replacement or large-scale refactoring on `main.js` unless explicitly requested.
- Structural cleanup must be gradual. Do not reorganize all of `main.js` in one task unless the user explicitly requests a full-file migration.
- Keep the preferred high-level order as global configuration and required bootstrap values first, then `response(...)`, then helper sections grouped by domain.
- Use `GLOBAL_CONFIG` as the preferred top-level object for operational constants above `response(...)` when the values include mixed configuration types.
- Structure `GLOBAL_CONFIG` by feature/domain first, for example `GLOBAL_CONFIG.titleGift`, `GLOBAL_CONFIG.happyFoundation`, and `GLOBAL_CONFIG.guildTerritory`.
- For large domains, group nested values by role inside the domain, for example `GLOBAL_CONFIG.guildTerritory.limits`, `GLOBAL_CONFIG.guildTerritory.timers`, `GLOBAL_CONFIG.guildTerritory.rates`, `GLOBAL_CONFIG.guildTerritory.rewards`, and `GLOBAL_CONFIG.guildTerritory.items`.
- Do not add duplicate alias constants for values already in `GLOBAL_CONFIG` unless a runtime compatibility issue requires it.
- Do not introduce broad ambiguous containers such as `GLOBAL_VALUE` when a clearer `GLOBAL_CONFIG` section name can express the role.
- New operational constants should be added to centralized global objects instead of scattering raw numbers or repeated strings.
- Promote existing hard-coded values to global objects only when the touched logic already needs modification; avoid broad mechanical sweeps for unrelated constants.
- Keep feature changes and pure structure cleanup in separate commits when practical.
- Preserve user-facing UI formatting:
  - line breaks
  - emojis
  - `allsee` formatting
- When creating or modifying slash commands, avoid broad prefix guards for execution commands.
- Commands with no arguments must use exact equality such as `msg === "/명령어"`.
- Commands with numeric arguments must use full-pattern guards such as `msg === "/명령어" || /^\/명령어\s+\d+$/.test(msg)` or `/^\/명령어\s+\d+$/.test(msg)` when the argument is required.
- Inputs with extra guide text after valid arguments, such as `/명령어 1 해봐`, must not execute command logic unless that command explicitly accepts free-form text.
- When adding a new helper/function, add a brief one-line purpose comment directly above it, for example `// 현재 날짜 문자열 반환 함수`.
- When a function declares several derived or summary variables, add short inline comments beside the non-obvious variables explaining what each value calculates, for example `var towerAttempts = ...; // 시련탑 도전 횟수 계산`.

## Notion READY Development Workflow

- When the user says "노션확인 후 개발", treat it as a request to check Notion READY items from the Notion planning DB first and then develop according to the selected Notion document.
- The required order is:
  1. Check the current git branch and working tree status.
  2. Prepare the correct hoiBot task branch according to the branch workflow rules.
  3. Fetch the Notion planning DB/data source and confirm its schema.
  4. Identify READY items by the DB status property only: `상태 = 🛠 READY`; do not use `섹션 = READY` or broad workspace search as the source of truth.
  5. Fetch and read the selected READY document.
  6. Summarize the requirements, acceptance criteria, constraints, and uncertain areas.
  7. Re-verify the relevant current code, commands, helpers, data flow, and save flow before editing.
  8. Implement the requested change with minimal scope.
  9. Validate according to the touched files and runtime constraints.
  10. Update `COMMAND_INDEX.md`, `COMMAND_REGISTRY.md`, changelog/version files, or other docs only when the rules require synchronization.
  11. Report the Notion document checked, changed files, validation result, and remaining risks.
- If multiple READY items are found and the user did not specify one, list the candidates and ask which item to implement first before editing.
- If Notion DB querying is unavailable, report the tool limitation and use the narrowest available DB-scoped fallback; do not present broad workspace search results as DB-confirmed.
- If the Notion document conflicts with the current code, trust the current code for implementation details and report the mismatch.
- Do not change runtime behavior while only checking Notion unless the user explicitly asked to proceed with development.
- When a Notion READY development item has been implemented, validated, pushed on the source branch, and reflected into `feature/prod`, update the corresponding Notion item status from READY to DEV.
- Do not change the Notion item from READY to DEV before production reflection is complete.

## Branch Workflow

- `feature/prod` is the operational base branch for production-facing code.
- `feature/hoi` is the primary hoi-managed task branch used by `tools/` upload and `feature/prod` direct-merge scripts.
- `feature/workflow` is the branch for documentation, agent strategy, branch strategy, and `tools/` workflow changes.
- Validated changes made on `feature/workflow` should be reflected into `feature/prod` by default after the workflow branch is pushed, unless the user explicitly says not to reflect them.
- `feature/bugFix` is a short-lived branch for one bug-fix cycle: root-cause analysis, minimal fix, regression validation, source-branch push, and production reflection.
- Bug fixes should be performed on a freshly created `feature/bugFix` from the latest `feature/prod` unless the user explicitly requests another exact branch.
- After the validated bug-fix commit is pushed and reflected into `feature/prod`, delete local and remote `feature/bugFix` by default so the next bug fix starts from a clean branch.
- If `feature/bugFix` already exists when starting a new bug fix, verify that its previous work is reflected into `feature/prod`; then delete/recreate it from the latest `feature/prod` unless the user asks to preserve it.
- If both `feature/bugFix` and `feature/bugfix` exist, verify and use the exact branch casing requested by the user.
- Agents MUST follow the role of each existing branch.
- If no existing branch role fits the task, create a new broad content branch such as `feature/<content-name>`.
- Create task branches from `feature/prod`, not directly from `main`.
- Local `feature/prod` is the active operational baseline for production-facing and bug-fix work.
- Do not create task commits directly on `feature/prod`, even when the current checkout is already `feature/prod`.
- Do not push direct local edits to `feature/prod`; the same commit must first exist on a pushed source branch such as `feature/hoi`, `feature/bugFix`, `feature/workflow`, or another task branch.
- If a follow-up fix is needed after work was already reflected into `feature/prod`, apply the fix on the original task branch or a new task branch first, push that branch, then reflect the validated commit into `feature/prod`.
- Before starting work on a specific branch, update local `feature/prod` from `origin/feature/prod` first, then bring that local `feature/prod` into the target branch.
- Do not use `origin/main` as the freshness baseline for production-facing or bug-fix work; `main` is only a stable/reference branch.
- Do not proactively synchronize `feature/prod` into `main`; after operational stabilization, wait for the user to request a PR from `feature/prod` to `main`.
- Open PRs back into `feature/prod` for operational changes.
- When the user says "prod까지 올려줘" or "운영반영해줘", treat it as a request to push the current task branch and then reflect the validated work into `feature/prod`.
- For production-facing code/data/bug-fix changes, add a new top entry to `data/hoiBotChangeLog.json` before production reflection.
- Treat `data/hoiBotChangeLog.json` as the source for the user-facing `/개발자노트` command.
- Each `data/hoiBotChangeLog.json` entry must increase the latest version by `0.001`, use the reflection date, and summarize the user-visible fix or change in `changes`.
- Write `data/hoiBotChangeLog.json` entries in a Toss-like, user-friendly developer-note style:
  - Describe what users/operators can do now, what became easier, or what inconvenience was fixed.
  - Prefer short sentences such as `~할 수 있어요`, `~가 더 쉬워졌어요`, `~를 더 안정적으로 처리해요`, and `~문제를 고쳤어요`.
  - Avoid internal helper names, file names, JSON key names, implementation details, and developer-only jargon unless the command/data name itself is user-facing.
  - If one version contains several changes, group the wording by user impact such as `새로 추가`, `더 좋아짐`, `문제 수정`, or `운영 개선` instead of implementation area.
- When multiple entries share the same date, `/개발자노트` should present them under one date section while each production-facing change still receives its own `0.001` version increase.
- Before production reflection, keep `HoiBotVersion` in `main.js` synchronized with the latest `data/hoiBotChangeLog.json` entry so `/호이봇버전` and `/개발자노트` show the same current version.
- Workflow-only, documentation-only, and internal agent rule changes may skip `data/hoiBotChangeLog.json` unless they change the live bot behavior or the user explicitly requests a visible change record.
- Test reflection scripts should use `feature/prod` as their source branch.
- `main` is a stable/reference branch and should not be assumed to be the active production source.
- After validated operational changes settle, synchronize `feature/prod` back to `main` when explicitly requested.

---

# 5) COMMAND_INDEX.md Rules

## Purpose

`COMMAND_INDEX.md` is a secondary index document for command/helper/data-flow exploration.

## Core Principles

- The actual source of truth is ALWAYS the current codebase.
- `COMMAND_INDEX.md` is NOT the source of truth.
- `COMMAND_INDEX.md` is a helper index for exploration/navigation.
- NEVER assume a helper/function/command does not exist solely because it is missing from `COMMAND_INDEX.md`.
- If `COMMAND_INDEX.md` conflicts with the actual code, trust the code.
- After completing a task, update `COMMAND_INDEX.md` based on the modified code when command/helper/data-flow information changes.

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

# 5-1) COMMAND_REGISTRY.md Rules

## Purpose

`COMMAND_REGISTRY.md` is a human-facing command source, unused, removal, and note checklist.

## Core Principles

- The actual source of truth is ALWAYS the current codebase.
- `COMMAND_REGISTRY.md` is for human usage/removal confirmation, not primary code exploration.
- It tracks commands only as a table with source file, `미사용`, `삭제유무`, and `비고`.
- Unchecked `미사용` means the command is treated as `사용` by default.
- Check `미사용` only when the command needs deletion review.
- Check `삭제유무` only after source-code removal is verified.
- Treat values connected by `||` in the same condition as aliases of the same command.
- Do not treat broad outer gate conditions as aliases; split them by the actual inner command branches.
- Do not treat `else if` branches as the same command group.
- Record aliases and trigger notes in `비고`.
- Do not record implementation patterns such as `startsWith(...)` in `비고`.
- Do not add lifecycle states such as `ACTIVE`, `UNUSED`, `REMOVE`, `DEV`, or `ADMIN`.
- Do not add verification levels such as pattern collection, branch confirmation, or execution confirmation.
- `미사용` does NOT automatically mean the command should be removed.
- Command removal requires an explicit user request and source-code re-verification.
- If `COMMAND_REGISTRY.md` conflicts with the actual code about command existence, trust the code.
- Synchronize `COMMAND_REGISTRY.md` only when the command list, `미사용`, `삭제유무`, or `비고` materially changes.

---

# 6) Sub-Agent System

## Structure

```text
head-agent
 ├─ git-agent
 ├─ explorer-agent
 ├─ coding-agent
 ├─ reviewer-agent
 ├─ error-bugfix-agent
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

# 7) git-agent

## Role

- Manages Git branch, push, PR, and merge workflows.
- Chooses the appropriate branch based on the task.
- Pushes task branches and creates PRs with human-readable titles and bodies.
- May merge approved PRs into `feature/prod`.
- May create PRs from `feature/prod` to `main` after operational stabilization.

## Modification Permission

- May modify Git workflow documentation and helper scripts.
- MUST NOT modify game source logic unless explicitly requested.

## Rules

- `feature/prod` is the operational base branch.
- Task branches should branch from `feature/prod`.
- Operational PRs should target `feature/prod`.
- Documentation, agent strategy, branch strategy, and `tools/` workflow changes should use `feature/workflow`.
- After validated documentation, agent strategy, branch strategy, `tools/`, or Codex skill changes are committed and pushed on `feature/workflow`, reflect those commits into `feature/prod` by default unless the user explicitly says not to.
- Bug fixes should use a fresh `feature/bugFix` created from the latest `feature/prod` unless the user explicitly requests another exact branch.
- After the bug-fix commit is pushed and reflected into `feature/prod`, delete local and remote `feature/bugFix` by default.
- If an old `feature/bugFix` exists, verify reflected commits before deleting/recreating it from `feature/prod`.
- If both `feature/bugFix` and `feature/bugfix` exist, verify the intended remote/local branch and use the exact branch casing requested by the user.
- Follow the role of each existing branch before choosing or creating a branch.
- If no existing branch role fits the work, create a new broad content branch from `feature/prod` using `feature/<content-name>`.
- Local `feature/prod` is the active operational baseline; other task branches should be based on the updated local `feature/prod`, not on `origin/main`.
- Before starting work after switching to a task branch, update local `feature/prod` from `origin/feature/prod`, bring that local `feature/prod` into the task branch, and resolve any conflicts before editing.
- Do not bring `origin/main` into bug-fix or production-facing task branches unless the user explicitly requests main synchronization.
- PRs to `main` are allowed for stabilization/synchronization.
- Create PRs from `feature/prod` to `main` only when the user explicitly requests that stable synchronization after operational stabilization.
- Do not directly push to `main`.
- Do not directly merge into `main`.
- Do not commit task or follow-up fixes directly on `feature/prod`.
- Before pushing `feature/prod`, verify the commit(s) being pushed already exist on a pushed source branch; if they do not, move the work to the correct task branch first.
- Merge into `feature/prod` only after explicit user approval.
- For "prod까지 올려줘" or "운영반영해줘", push the current task branch first, then merge or cherry-pick the validated task changes into `feature/prod`, and push `feature/prod`.
- Before reflecting production-facing code/data/bug-fix changes into `feature/prod`, verify `data/hoiBotChangeLog.json` has a new top entry with the latest version increased by `0.001` and a concise Toss-like `/개발자노트` summary.
- For workflow/documentation changes, do not wait for a separate production-reflection phrase; push `feature/workflow`, then reflect the validated workflow commit(s) into `feature/prod`.
- If the task branch contains unrelated historical commits or is far ahead of its upstream, do not merge the whole branch into `feature/prod`; cherry-pick only the validated task commit(s).
- Before pushing, creating PRs, or merging, check the current branch and working tree status.
- Commit messages should be written in Korean as clear, human-readable summaries of the change.
- Keep `tools/*.bat`, `README.md`, and `AGENTS.md` synchronized when branch strategy changes.
- Keep repo-managed Codex skill sources in `.codex/skills/` synchronized with workflow changes when those skills encode the affected workflow.
- When repo-managed Codex skill sources in `.codex/skills/` change, after `feature/prod` is updated, update the corresponding local Codex skill files under the user's Codex skills directory when filesystem permissions allow it.
- PR titles and bodies must summarize:
  - changed files or areas
  - user-visible behavior changes
  - validation performed
  - unverified risks

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
- Use `COMMAND_REGISTRY.md` only as a human-maintained source, `미사용`, `삭제유무`, and `비고` reference.
- Use the registry only as a starting point, not as proof of command existence or removal approval.
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
- `COMMAND_REGISTRY.md` tracks only source file, `미사용`, `삭제유무`, and `비고`.
- Do not remove command code solely because a command is marked `미사용`.
- Remove command code only when the user explicitly requests removal and source-code impact is re-verified.
- Mark `삭제유무` only after the command removal is verified against the actual source code.
- Preserve:
  - command UI
  - line breaks
  - emojis
  - `allsee` formatting
- For new or edited slash commands, never rely on `msg.startsWith("/명령어")` or `msg.indexOf("/명령어") === 0` for mutation, purchase, sale, equip, open, combine, or cleanup logic.
- Use exact or full-pattern guards so suffix text cannot be interpreted as a valid command.
- Use only Rhino JS compatible syntax/features.
- Add a concise one-line purpose comment above each new helper/function.
- In calculation-heavy blocks with many derived variables, add short inline comments for non-obvious variables so future maintainers can quickly read what each value means.

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
- Verify consistency between actual code and `COMMAND_REGISTRY.md` when command lists, `미사용`, `삭제유무`, or `비고` are involved.
- Verify that `미사용` was not treated as automatic deletion approval.
- Verify command removal had explicit user approval.
- Verify `삭제유무` is checked only for commands actually removed from source code.
- Verify `COMMAND_REGISTRY.md` still uses only source file, `미사용`, `삭제유무`, and `비고`.

## Main Review Targets

- duplicate helpers
- command conflicts
- save-flow omissions
- DEV/PROD path issues
- unnecessary structural changes

---

# 10-1) error-bugfix-agent

## Role

- Receives runtime error logs and turns them into reusable bug-fix investigation records.
- Analyzes:
  - error message
  - file name
  - line number
  - triggering message
  - room/sender context when useful
  - suspected command/helper path
  - root cause candidates
  - recommended fix and validation steps

## Modification Permission

- May modify Markdown investigation records such as `ERROR_FIX_LOG.md`.
- MUST NOT modify source code unless the user explicitly asks for the actual bug fix.

## Rules

- When the user provides an error payload such as `[ERROR : Main error] {...}`, record the analysis in `ERROR_FIX_LOG.md`.
- Each record should include the raw error summary, affected file/line, trigger message, cause analysis, proposed solution, validation checklist, and current status.
- Re-check the current code around the reported line and search related helper/function names before writing the cause.
- If line numbers appear stale because the code has changed, note the mismatch and analyze the closest matching helper or call site.
- Do not treat a single stack line as full proof of root cause; list uncertainty explicitly.
- Do not change runtime behavior while recording an error unless the user also requests a fix.
- If the error involves save/load, inventory, points, item mutation, or DEV/PROD path flow, also apply save-flow guard rules.
- If a source fix is later implemented, update the same `ERROR_FIX_LOG.md` entry with the commit/branch, changed files, validation result, and remaining risk.

## Error Record Must Include

- date
- status
- raw error summary
- reported context
- investigated files/functions
- suspected cause
- recommended fix
- validation plan
- follow-up notes

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
- other registry-style `*.md` files

## Rules

- NEVER update documentation based purely on assumptions.
- Verify documentation synchronization whenever commands/helpers/data-flow change.
- If documentation conflicts with code, update documentation based on code.
- Maintain `COMMAND_INDEX.md` as the AI-oriented command/helper/data-flow navigation index.
- Maintain `COMMAND_REGISTRY.md` as the human-facing source file, `미사용`, `삭제유무`, and `비고` command checklist.
- Do not use `COMMAND_REGISTRY.md` for lifecycle states, verification levels, or deletion approval.
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
