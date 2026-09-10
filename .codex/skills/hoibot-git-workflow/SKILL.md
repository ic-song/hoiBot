---
name: hoibot-git-workflow
description: Use for hoiBot branch selection, feature/prod baseline updates, Korean commit messages, pushing task branches, reflecting changes into feature/prod, and choosing merge versus cherry-pick.
---

# hoiBot Git Workflow

Use this skill for git branch, commit, push, and production reflection tasks in the hoiBot repository.

## Core Rules

- Check the current branch and working tree before switching, committing, pushing, or merging.
- Commit messages should be written in Korean as clear, human-readable summaries.
- Do not push directly to `main`.
- Do not merge directly into `main`.
- Do not proactively synchronize `feature/prod` into `main`; wait for the user to request a `feature/prod` to `main` PR after operational stabilization.
- Do not commit directly on `feature/prod`.
- Do not push direct local edits to `feature/prod`.
- If the current checkout is `feature/prod` and the user asks for a task change or follow-up fix, switch to the original task branch or create a new task branch before editing or committing.
- Before pushing `feature/prod`, verify the commit(s) being pushed already exist on a pushed source branch; if they do not, stop and move the work to the correct task branch first.
- Update `feature/prod` only by reflecting validated task-branch work through merge, cherry-pick, or an approved PR-style merge flow.
- `feature/prod` is the operational branch.
- Local `feature/prod` is the active operational baseline for production-facing and bug-fix work.
- Documentation, workflow, branch strategy, and tools changes belong on `feature/workflow`.
- Validated `feature/workflow` changes should be reflected into `feature/prod` by default after `feature/workflow` is pushed, unless the user explicitly says not to reflect them.
- `CODEX-CONFIG` is the canonical source for user-authored hoiBot skills. Do not edit `.codex/skills/` or installed personal skill folders as the first or only source change.
- For skill changes, update and validate `CODEX-CONFIG`, push its `main`, then run its `sync-skills.ps1 -ProjectPath <hoiBot-path> -Force` so `.codex/skills/` is a generated deployment mirror.
- Installed personal skill folders should be junctions to `CODEX-CONFIG`; verify the junction target after central skill changes instead of manually copying files.
- Bug fixes belong on a freshly created `feature/bugFix` from the latest `feature/prod` unless the user explicitly requests another exact branch; if both `feature/bugFix` and `feature/bugfix` exist, verify the exact casing requested by the user.
- Treat `feature/bugFix` as short-lived: after the validated bug-fix commit is pushed and reflected into `feature/prod`, delete local and remote `feature/bugFix` by default so the next bug fix starts cleanly from `feature/prod`.
- If `feature/bugFix` already exists when starting a new bug fix, verify whether its previous commits are already reflected into `feature/prod`; then delete/recreate it from latest `feature/prod` unless the user asks to preserve it.
- Before starting work on a specific branch, update local `feature/prod` from `origin/feature/prod`, then bring that local `feature/prod` into the branch.
- Other task branches should be based on the updated local `feature/prod`, not on `origin/main`.
- Do not use `origin/main` as the freshness baseline for production-facing or bug-fix work unless the user explicitly requests main synchronization.
- Create PRs from `feature/prod` to `main` only when the user explicitly requests stable synchronization after operational stabilization.
- When the user says "노션 확인", "노션 확인(핫픽스, ready)", or asks to check Notion HOTFIX/READY without explicitly requesting implementation, count and list development-needed items by the Notion planning DB status property only: `상태 = 🔥 HOTFIX` and `상태 = 🛠 READY`.
- For Notion status checks, report counts by status and list matching page titles/links only after verifying page properties; title text such as `(READY / date)` is not the status source of truth.
- When the user says "노션확인 후 개발", check git status and prepare the correct task branch first, then fetch the Notion planning DB/data source, identify READY items by the DB status property only (`상태 = 🛠 READY`), fetch the selected document, summarize requirements, re-verify the current code, implement, validate, and report results.
- When the user says "노션 핫픽스 수정", "핫픽스", or otherwise asks to implement a Notion hotfix, check git status and prepare the correct hotfix branch first, then fetch the Notion planning DB/data source, identify HOTFIX items by the DB status property only (`상태 = 🔥 HOTFIX`), fetch the selected document, summarize requirements, re-verify the current code, implement, validate, and report results.
- Do not use broad Notion workspace search as the source of truth for READY/HOTFIX development items.
- Prefer DB/data-source querying by the exact `상태` property. If DB querying is unavailable, report the limitation and use only the narrowest DB-scoped fallback: search within the confirmed data source, fetch each candidate page, and verify the page properties contain the exact target status.
- Never conclude that no HOTFIX exists from a text search for `HOTFIX` alone. A page can be grouped under `🔥 HOTFIX` by its status property even when the title/body does not contain the word `HOTFIX`.
- If the user provides a screenshot or visible board card title, search that exact title within the confirmed data source, fetch the matching page, and verify its `상태` property.
- If multiple Notion READY/HOTFIX items are found and the user did not specify one, ask which item to implement before editing.
- Treat `운영 반영예정일` as a text planning field. If it is omitted, empty, or whitespace-only, interpret it as `즉시 반영 필요` for prioritization and reporting only; leave the Notion property blank and preserve explicit values.
- Keep `운영 반영예정일` separate from the date-type `운영반영일` and text-type `운영반영버전`; never store `즉시 반영 필요` in either actual-reflection property.
- After a Notion READY/HOTFIX development item is implemented, validated, pushed on the source branch, reflected into `feature/prod`, and verified on `origin/feature/prod`, update that Notion item status from READY/HOTFIX to DEV, set `운영반영일` to the production-reflection date in Korea Standard Time (`Asia/Seoul`), and set `운영반영버전` to `ver_<HoiBotVersion>` from the verified production commit.
- After remote production verification, first synchronize the existing planning page with the developed user-visible behavior (commands, formulas, limits, UI, exceptions and acceptance criteria), then update status/date/version. Do not add an implementation-record section or internal storage/helper details.
- For a production-facing change without an originating Notion item, search the confirmed planning data source for the exact feature or command before reflection and reuse a matching page. If none exists, skip synchronization; do not create a page, placeholder or absence record unless separately requested. Workflow-only changes do not require a planning page.
- Treat planning-content synchronization and the Notion `상태`, `운영반영일`, and `운영반영버전` updates as one completion workflow; verify the content and all three properties and report partial failure.
- Do not move the Notion item from READY/HOTFIX to DEV or populate/change `운영반영일` or `운영반영버전` before remote production reflection is verified.

## Starting Work On A Branch

1. Run `git status --short --branch`.
2. Switch to the target branch.
3. Pull the target branch with fast-forward only when possible.
4. Switch to `feature/prod` and update it from `origin/feature/prod`.
5. Switch back to the target branch.
6. Merge or otherwise bring local `feature/prod` into the target branch before editing.
7. Resolve conflicts before making task changes.

## Production Reflection

When the user says "prod까지 올려줘" or "운영반영해줘", or when validated workflow/documentation changes have been committed and pushed on `feature/workflow`:

1. Classify the changed files before touching `feature/prod`.
2. Treat the user's production-reflection keyword as a request for the work to end up on `feature/prod`; do not stop after pushing only the source task branch unless you explicitly tell the user `feature/prod` was not updated.
3. If the change is documentation, workflow, branch strategy, or tools work, commit and push it on `feature/workflow` first. For Codex skill work, update, validate, commit, and push `CODEX-CONFIG` first, then synchronize the generated `.codex/skills/` mirror and commit that mirror on `feature/workflow`.
4. After the workflow branch is pushed, reflect only the validated workflow commit(s) into `feature/prod` by cherry-pick, merge, or approved PR-style merge flow unless the user explicitly says not to.
5. For production-facing code/data work, commit and push the current task branch first.
6. For production-facing code/data/bug-fix work, verify `data/hoiBotChangeLog.json` has a new top entry before reflection: latest version + `0.001`, reflection date, and a concise user-visible `changes` summary for `/개발자노트`.
   - Before switching to `feature/prod`, inspect the source-branch diff/commit list and confirm both `data/hoiBotChangeLog.json` and `main.js` are included.
   - If either file is missing for a production-facing change, stop production reflection and add the developer-note/version update on the source branch first.
   - Write developer-note text in a Toss-like, user-friendly style: explain what users/operators can do now, what became easier, or what inconvenience was fixed.
   - Prefer short sentences such as `~할 수 있어요`, `~가 더 쉬워졌어요`, `~를 더 안정적으로 처리해요`, and `~문제를 고쳤어요`.
   - Avoid internal helper/file/key names and developer-only jargon unless the command/data name itself is user-facing.
   - If one version contains several changes, group the wording by user impact such as `새로 추가`, `더 좋아짐`, `문제 수정`, or `운영 개선` instead of implementation area.
   - When multiple entries share the same date, `/개발자노트` should present them under one date section while each production-facing change still receives its own `0.001` version increase.
   - Verify `HoiBotVersion` in `main.js` matches the latest `data/hoiBotChangeLog.json` version so `/호이봇버전` and `/개발자노트` stay consistent.
7. Workflow-only, documentation-only, and internal agent rule changes may skip `data/hoiBotChangeLog.json` unless they change live bot behavior or the user explicitly requests a visible change record.
8. Switch to `feature/prod`.
9. Pull `feature/prod`.
10. Verify the commit(s) to reflect already exist on the pushed source branch.
11. Reflect only the validated work into `feature/prod` by merge, cherry-pick, or approved PR-style merge flow.
12. Push `feature/prod`.
13. Re-check `origin/feature/prod` and confirm the reflected production-facing commit includes the developer-note/version update; report the reflected `/개발자노트` version.
14. For every corresponding Notion READY/HOTFIX development item, update `상태 = 🧪 DEV`, `운영반영일` to the KST reflection date, and `운영반영버전 = ver_<HoiBotVersion>` only after step 13 succeeds. Treat and verify the three properties as one operation; when one production change implements multiple linked items, apply the same verified version to each.
15. After the remote `feature/prod` verification succeeds, use the `hoibot-playmcp-version-notifier` skill when available. When the PlayMCP KakaoTalk `나에게 보내기` tool is available, send exactly `ver_<HoiBotVersion>` and no other text. Do not send when production was not updated or verification failed. If the tool is unavailable, skip the notification without failing production reflection and report that it was skipped; if the available tool fails, retry once when safe and report the failure.
16. If `.codex/skills/` changed, verify it matches `CODEX-CONFIG` and confirm the installed personal skill is a junction to the same canonical folder.
17. In the final response, explicitly state whether `feature/prod` was updated, which commit(s) were reflected, which `/개발자노트` version is current, which Notion items received the production date/version, whether the KakaoTalk version notification succeeded, and whether local skills were updated.

## Merge Versus Cherry-Pick

Use a normal merge only when the task branch contains only relevant commits and is clean.

Prefer cherry-pick when:

- the task branch is far ahead of upstream
- unrelated historical commits are present
- only some commits should go to production
- a whole-branch merge would create unnecessary risk

## References

- Read `references/branch-policy.md` for branch role details.
- Read `references/prod-reflection.md` before production reflection.
