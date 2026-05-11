# COMMAND_CLEANUP_STRATEGY.md

Status: ACTIVE

---

## Purpose

This document defines the command management and cleanup strategy for `hoiBot`.

Command decisions are human-driven.
Codex supports exploration, synchronization, and approved code cleanup.

---

## Document Roles

- `main.js` / `Info.js`
  - Actual source of truth
- `COMMAND_INDEX.md`
  - AI-oriented navigation index
  - Used for helper discovery, command tracing, and save-flow tracing
- `COMMAND_REGISTRY.md`
  - Human-managed command registry
  - Used to manage command status and cleanup decisions

---

## Basic Workflow

1. Collect commands from actual source code.
2. Register and manage command status in `COMMAND_REGISTRY.md`.
3. Record verification level in `COMMAND_REGISTRY.md`.
4. Use `COMMAND_INDEX.md` for code exploration and impact checking.
5. Remove commands only when explicitly approved.
6. Synchronize related Markdown documents after changes.

---

## Command Status

Recommended statuses:

- `ACTIVE`
- `UNUSED`
- `LEGACY`
- `DEV`
- `ADMIN`
- `REMOVE`

Only commands marked `REMOVE` are deletion candidates.

---

## Verification Level

Recommended verification levels:

- `패턴수집`
- `분기확인`
- `실행확인`

Meaning:

- `패턴수집`: command-like string collected first, not yet confirmed as a real branch
- `분기확인`: actual command branch confirmed in source code
- `실행확인`: runtime behavior or output flow also checked

---

## Critical Rules

- Never treat Markdown files as the source of truth over actual code.
- Never decide deletion based on guesswork or failed search results alone.
- Never remove shared helpers unless their usage is fully verified.
- Prefer minimal changes over broad cleanup or refactoring.
- Re-check save/load flow when a command changes game data.

---

## Source of Truth

If code and documentation conflict:

    TRUST THE CODE

Then update the Markdown documents accordingly.
