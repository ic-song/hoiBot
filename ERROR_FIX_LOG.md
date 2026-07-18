# ERROR_FIX_LOG.md

Runtime error and bug-fix investigation notes for hoiBot.

The source code is always the source of truth. This log is a reusable reference for future fixes, not proof that a fix has already been implemented or deployed.

---

Add new runtime error records below this line.

---

# 2026-07-18 - `member.json` malformed JSON and blocked `/봇살리기`

Status: FIXED_IN_BRANCH

## Raw Error Summary

- Symptom: 최근 운영 중 `member.json` 끝부분에 불필요한 `}}` 등이 기록되어 JSON 파싱이 실패함
- Trigger period: 계정정지 기능과 최근 길드영지 관련 업데이트 이후 2~3일
- Recovery symptom: `/봇살리기`를 입력해도 직전 백업 복구 분기까지 도달하지 못함
- Exact Android stack/line: not provided

## Reported Context

기존에는 운영 파일이 손상되어도 `/봇살리기`로 `member_back.json`을 복원할 수 있었으나, 계정정지 검사 추가 이후에는 모든 슬래시 명령이 복구 분기보다 먼저 현재 `member.json`을 파싱했다.

## Investigated Files / Functions

- `main.js`
  - `response(...)`의 계정정지 선검사와 `/봇살리기` 처리 순서
  - 매 슬래시 명령 전 `member.json`, `member_pet.json`, `petSkillData.json` 직전 백업 흐름
  - `loadJsonFile(...)`, `parseJsonContent(...)`, `saveJsonFile(...)`
  - 길드영지 타이머의 비동기 member/guild 저장 흐름
- Repository snapshots
  - `data/member.json`, `data/member_pet.json`, `data/petSkillData.json`, `data/guildData.json`은 조사 시점에 정상 파싱됨

## Suspected Cause

- 확정 원인: 계정정지 검사가 `/봇살리기`보다 먼저 손상된 `member.json`을 파싱하여 복구 명령 자체를 차단했다.
- 손상 유력 원인: 기존 `saveJsonFile(...)`이 본 파일에 직접 기록했고 경로별 저장 잠금, 임시 파일 검증, 교체 롤백이 없어 동시 응답이나 비동기 타이머 저장 중 부분·경쟁 기록에 취약했다.
- 계정정지 데이터 구조가 직접 잘못된 JSON을 생성했다는 증거는 확인되지 않았다. 추가 선행 로드는 기존 저장 취약점의 노출 가능성을 높인 정황으로만 본다.

## Recommended Fix

- `/봇살리기`를 계정정지 검사와 현재 member 파싱보다 먼저 처리한다.
- 계정정지 검사에서 읽은 정상 member 객체를 공통 명령 처리에서 재사용한다.
- `member.json`과 `member_back.json`은 경로별 잠금 안에서 임시 파일 기록, UTF-8 재파싱, 디스크 동기화, 롤백 가능한 교체를 수행한다.
- 파싱 실패를 빈 객체로 대체하지 않고 기존 오류 흐름을 유지한다.

## Validation Plan

- `node --check main.js`
- 저장 관련 운영 스냅샷 JSON 읽기 전용 파싱
- DEV의 손상된 `member.json` 복사본에서 `dev/봇살리기`가 직전 백업으로 복구되는지 확인
- Android Rhino에서 연속 명령과 영지전 타이머가 겹쳐도 member/backup JSON이 정상 파싱되는지 확인

## Follow-up Notes

- `/봇살리기` 선처리, 계정정지용 member 로드 재사용, member/직전 백업 검증 저장을 `feature/bugFix`에 적용했다.
- Android `FileDescriptor.sync()`와 `File.renameTo(...)` 동작은 운영 PC DEV 환경 검증이 필요하다.

---

# 2026-06-05 - `/??` date display `formatDate` undefined

Status: FIXED_IN_BRANCH

## Raw Error Summary

- System: `main`
- Message: `"formatDate" is not defined.`
- Reported file: `main`
- Reported line: `35233`
- Trigger message: `/?? ??`
- Room: `? ????`
- Sender: `?? ?`

## Reported Context

`/?? ??` reached the ?? ??? ?? message builder and crashed while formatting the date text for ???? or ?????.

## Investigated Files / Functions

- `main.js`
  - `/??` branch calls `buildPendingUserIdCheckMessage(...)`.
  - `buildPendingUserIdCheckMessage(...)` calls `formatPendingUserIdDateText(...)` for joined and light attendance records.
  - `formatPendingUserIdDateText(...)` calls `formatDate(dateText)` at the reported line `35233`.
  - `formatDate2(...)` exists in `main.js` and formats `YYYYMMDD` as `MM? DD?`.
  - `formatDateTime(...)` exists in `main.js`, but it is for date-time text.
- `Info.js`
  - `formatDate(...)` exists only in `Info.js` and formats `YYYYMMDD` as `YYYY? MM? DD?`.

## Suspected Cause

The `/??` helper was added to `main.js` using `formatDate(...)`, but that helper is not defined in the `main.js` runtime scope. It likely passed Node syntax checks because undefined function references are runtime errors, not syntax errors.

The command crashes only when `formatPendingUserIdDateText(...)` receives a non-empty date, such as an existing ??? or ??? ?? recent date.

## Recommended Fix

- Replace the `formatDate(...)` call inside `formatPendingUserIdDateText(...)` with a date formatter available in `main.js`.
- Preferred minimal fix options:
  - use existing `formatDate2(dateText)` if `MM? DD?` display is acceptable for `/??`, or
  - add a small `main.js` local helper for `YYYY? MM? DD?` if the `/??` output should match `/??` style dates.
- Preserve `/??` output line breaks and status labels.
- After source fix, update `COMMAND_INDEX.md` only if helper/data-flow details change materially.

## Validation Plan

- Run `node --check main.js`.
- Run `node --check Info.js`.
- Validate `/?? ??` where a matching joined or ??? ?? row has a non-empty date.
- Validate `/?? ??` with no matches still shows ????/????/????? without crashing.

## Follow-up Notes

- Added `formatPendingUserIdDateValue(...)` in `main.js` and changed `formatPendingUserIdDateText(...)` to use it instead of the `Info.js`-only `formatDate(...)`.
- Updated `HoiBotVersion` and `data/hoiBotChangeLog.json` to `2.175`.
- Validation planned before production reflection: `node --check main.js`, `node --check Info.js`, and a focused `/??` date-format helper check.


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
