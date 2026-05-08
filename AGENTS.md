# AGENTS.md

This document defines dedicated rules for AI agents working in the `hoiBot` repository.
Project guidance for human operators/developers is maintained in `README.md`.

## 1) Project Overview

- This repository is a game operation script project running in an Android Messenger Bot JavaScript environment.
- Core entry files:
  - `main.js`: Command handling and main game logic
  - `Info.js`: Lookup/support features
  - `data/`: Game operation data (JSON/TXT)

## 2) Runtime Environment Assumptions

- Runtime: Android-based Messenger Bot script engine
- Main callback:
  - `response(room, msg, sender, isGroupChat, replier, imageDB, packageName)`
- Example APIs:
  - `Api.replyRoom`
  - `FileStream`
  - `Device`
  - `android.os.*`
  - `java.io.*`
- Production data path:
  - `/sdcard/호이랜드/`
- Development/test data path:
  - `/sdcard/호이랜드_dev/`

## 3) Working Principles

- ALWAYS preserve existing behavior whenever possible.
- Minimize modification scope when editing large single files such as `main.js`.
- ALWAYS validate JSON syntax and encoding after modifying data files.
- NEVER commit sensitive information such as personal data, tokens, or private operational data.
- NEVER overwrite or revert user changes unless explicitly requested.
- When modifying save logic, ALWAYS verify DEV/PROD context handling together with `saveJsonFile` and `loadJsonFile` call flows.

## 4) Code Modification Guidelines

- Prefer small, isolated changes.
- Keep one logical purpose per commit.
- When modifying command/branch logic, check for conflicts with existing commands.
- If `data/` structures are changed, also update all related readers (`main.js`, `Info.js`).
- ALWAYS preserve UTF-8 encoding.

### Korean/Emoji File Safety Rules

The following files may contain Korean text and emojis:

- `main.js`
- `Info.js`
- `AGENTS.md`
- `README.md`
- `data/*.json`

NEVER use the following methods on these files:

- PowerShell `Get-Content` / `Set-Content`
- `cmd > file`
- Pipe redirection

These methods may corrupt UTF-8 encoding.

If scripted modification is required, ONLY use:

```js
fs.readFileSync(path, "utf8")
fs.writeFileSync(path, text, "utf8")
```

or `apply_patch`.

### Git Restore Safety

When restoring file contents from Git:

- Prefer:
  ```bash
  git restore -- <file>
  ```

- Avoid shell redirection restore methods.

If byte-preserving recovery is required, prefer approaches such as:

```bash
git archive --output=<tmp.tar> HEAD <file>
```

followed by extraction.

### Encoding Verification

After modifying Korean/emoji files, ALWAYS verify UTF-8 integrity directly:

```bash
node -e "const fs=require('fs'); console.log(JSON.stringify(fs.readFileSync('Info.js','utf8').slice(0,80)))"
```

### Additional Guidelines

- Place new functions near related domain functions.
- Probability, reward, ranking, guild, and pet-skill logic are balance-sensitive. Prefer constants/config-based management whenever possible.
- Bot messages are direct user-facing UI. Preserve formatting, line breaks, emojis, and `allsee` behavior carefully.
- NEVER perform broad regex replacements across `main.js` unless explicitly requested.
- Avoid unnecessary refactoring of large sections.
- Prefer additive changes over structural rewrites.

## 5) Data File Guidelines

- `data/*.json` files may also serve as operational samples/backups. Be careful with deletion or reset operations.
- Renaming keys may introduce backward compatibility issues. Add migration logic when necessary.
- Preserve existing schema types. Avoid mixing number/string types inconsistently.

## 6) Validation Checklist

Minimum syntax validation after modification:

```bash
node --check main.js
```

If `Info.js` was modified:

```bash
node --check Info.js
```

Minimum verification items:

- No script loading errors
- Frequently used commands respond correctly
- No data read/write path issues
- No JSON parsing errors

Whenever possible, verify changes in a test room or sandbox environment before production deployment.

## 7) Git Workflow Rules

- Avoid direct pushes to protected branches.
- Use working branches + PR workflow.
- Commit messages and PR titles/descriptions should be written in Korean.

Create branches from:

```text
feature/main
```

### Branch Naming Conventions

- `feature/hoi`
  - Hoi-requested feature work

- `feature/bugFix`
  - Bug fixes

- `feature/bm`
  - Package/BM related work

- `feature/dev-setting`
  - Development environment setup

- `feature/doc`
  - Documentation/config updates
  - (`README.md`, `AGENTS.md`, `.gitignore`, etc.)

- `feature/guildTerritoryWar`
  - Guild territory war related features

- `feature/<feature-name>`
  - General feature development

### Recommended Flow

```bash
git checkout -b feature/<task-name>
git add -A
git commit -m "type: change summary"
git push origin feature/<task-name>
```

### PR Description Requirements

Include:

- Purpose of changes
- Main modified files
- User impact (commands/data/operations)
- Verified test items

## 8) Agent Behavior Rules

- NEVER guess when code/data can be directly inspected.
- DO NOT modify unrelated files.
- STOP immediately if unexpected large-scale formatting or structural changes appear.
- ALWAYS include failure logs and reproduction steps clearly in the final report.
- Preserve user-facing UI formatting whenever possible.
- Treat operational game balance logic as sensitive.
- Prefer minimal-risk modifications.