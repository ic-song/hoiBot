# ERROR_FIX_LOG.md

Runtime error and bug-fix investigation notes for hoiBot.

The source code is always the source of truth. This log is a reusable reference for future fixes, not proof that a fix has already been deployed.

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

## Investigation

- Checked `main.js` around reported line `4533`.
- The reported line calls `noticeMsg(message)` in the pet exploration start notice flow.
- Checked the helper section and confirmed `function noticeMsg(msg)` exists at top-level scope.
- Searched for `noticeMsg` declarations and found a local `var noticeMsg = ""` inside the `/펀치` command flow.

## Root Cause

Inside `response(...)`, `var noticeMsg = ""` was declared as a local message-building variable for the punch-machine legend notice.

Because `var` is function-scoped, Rhino/JavaScript hoisted that local declaration to the top of `response(...)`. That shadowed the top-level `noticeMsg(msg)` helper throughout the entire `response(...)` function, so earlier call sites such as line `4533` saw `noticeMsg` as the local undefined variable instead of the global notice function.

## Fix

- Branch: `feature/bugFix`
- Commit: `0e8eca8 noticeMsg 지역 변수 충돌 수정`
- Changed file: `main.js`
- Renamed the local punch-machine message variable from `noticeMsg` to `punchLegendNoticeMsg`.
- Removed the function-scope name collision without changing notice output text.

## Validation

- `node --check main.js`: PASS
- `node --check Info.js`: PASS
- `rg -n "var\\s+noticeMsg\\b|let\\s+noticeMsg\\b|const\\s+noticeMsg\\b|noticeMsg\\s*=" main.js`: no shadowing declaration found

## Follow-up Notes

- If this exact error still appears in the live MessengerBot runtime, the fixed `feature/bugFix` commit has probably not been reflected into `feature/prod` and redeployed yet.
- After production reflection/deployment, re-check the pet exploration notice path and any command path that calls `noticeMsg(...)`.
