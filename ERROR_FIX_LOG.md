# ERROR_FIX_LOG.md

Runtime error and bug-fix investigation notes for hoiBot.

The source code is always the source of truth. This log is a reusable reference for future fixes, not proof that a fix has already been implemented or deployed.

---

Add new runtime error records below this line.

---

# 2026-06-01 - `/출석목록` rank lookup undefined

Status: FIXED_IN_BRANCH

## Raw Error Summary

- System: `info`
- Message: `Cannot read property "rank" from undefined`
- Reported file: `info`
- Reported line: `635`
- Trigger message: `/출석목록`
- Room: `팻 테스트방`
- Sender: `호이 남`

## Reported Context

`/출석목록` builds display rows from `data.attend_list` and directly reads `data.member[user].rank.emoji` for each attended user. The reported line is in the second-page mapping branch, so the failing entry was likely the 11th attended user or later.

## Investigated Files / Functions

- `Info.js`
  - `/출석목록` branch at lines `622-638`
  - `data.attend_list` is read directly and split into top 10 plus remaining users.
  - No existence guard is present before `data.member[user].rank.emoji`.
- `main.js`
  - Attendance command around lines `3505-3546` pushes `sender` into `data.attend_list` and updates `data.member[sender]`.
  - Reset helper around lines `27099-27105` already checks `data.member.hasOwnProperty(user)` before resetting `today`, then clears `data.attend_list`.
- `COMMAND_INDEX.md`
  - `/출석목록` entry records `data.attend_list` and `data.member[user].rank.emoji`.
- `data/member.json`
  - Current repository snapshot check: `attend_list` count `249`, missing `data.member[user]` entries `0`, missing `rank` entries `0`.

## Suspected Cause

The active runtime data likely contains at least one name in `data.attend_list` that no longer exists in `data.member`, or exists in a different spelling/key than the member record. Because `/출석목록` directly dereferences `data.member[user].rank.emoji`, any stale or orphaned attendance-list entry crashes the command.

This was not reproducible from the repository snapshot because all current `attend_list` entries have corresponding member and rank records.

## Recommended Fix

- In `/출석목록`, filter or format attendance users through a small guard before reading `rank.emoji`.
- Preserve the current output order, line breaks, and `allsee` behavior.
- Decide the desired user-facing behavior for orphaned attendance entries before code change:
  - skip invalid attendance names, or
  - show them with a fallback rank marker and keep the name visible for operator cleanup.
- If the fix changes command/data-flow behavior, update `COMMAND_INDEX.md` after source verification.

## Validation Plan

- Run `node --check Info.js`.
- Run `node --check main.js`.
- Create a copied DEV-style member snapshot where `data.attend_list[10]` contains a missing member key, then verify `/출석목록` no longer throws.
- Verify normal `/출석목록` output still shows the first 10 users, `allsee`, and remaining users in the same order.

## Follow-up Notes

- Added a guarded attendance row formatter in `Info.js` so missing member/rank data no longer crashes `/출석목록`.
- Updated `COMMAND_INDEX.md` with the guarded formatting behavior.
- If this error repeats before the next reset, inspect the live `/sdcard/호이랜드/` member data for orphaned names in `attend_list`.

---

# 2026-05-19 - `noticeMsg is not a function`

Status: FIXED_IN_BRANCH

## Raw Error Summary

- System: `main`
- Message: `noticeMsg is not a function, it is undefined.`
- Reported file: `main`
- Reported line: `4533`
- Trigger message: `미국향기가뭔데 `
- Room: `💖신생💖20대 30대 반말방🎙️보이스룸 수다 벙`
- Sender: `유후 여`

## Root Cause

Inside `response(...)`, `var noticeMsg = ""` was declared as a local message-building variable for the punch-machine legend notice.

Because `var` is function-scoped, Rhino/JavaScript hoisted that local declaration to the top of `response(...)`. That shadowed the top-level `noticeMsg(msg)` helper throughout `response(...)`, so earlier call sites such as line `4533` saw `noticeMsg` as the local undefined variable instead of the global notice function.

## Fix

- Renamed the local punch-machine message variable from `noticeMsg` to `punchLegendNoticeMsg`.
- Removed the function-scope name collision without changing notice output text.

## Validation

- Run `node --check main.js`.
- Run `node --check Info.js`.
- Confirm no local `var/let/const noticeMsg` declaration remains in `main.js`.
