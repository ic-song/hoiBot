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
- When `.codex/skills/` files change, update the corresponding local Codex skill files after `feature/prod` is updated, if filesystem permissions allow it.
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
- After a Notion READY/HOTFIX development item is implemented, validated, pushed on the source branch, and reflected into `feature/prod`, update that Notion item status from READY/HOTFIX to DEV.
- Do not move the Notion item from READY/HOTFIX to DEV before production reflection is complete.

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
3. If the change is documentation, workflow, branch strategy, tools, or Codex skill work, commit and push it on `feature/workflow` first.
4. After the workflow branch is pushed, reflect only the validated workflow commit(s) into `feature/prod` by cherry-pick, merge, or approved PR-style merge flow unless the user explicitly says not to.
5. For production-facing code/data work, commit and push the current task branch first.
6. For production-facing code/data/bug-fix work, verify `data/hoiBotChangeLog.json` has a new top entry before reflection: latest version + `0.001`, reflection date, and a concise user-visible `changes` summary for `/개발자노트`.
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
13. If `.codex/skills/` changed, update the corresponding local Codex skill files when possible.
14. In the final response, explicitly state whether `feature/prod` was updated, which commit(s) were reflected, and whether local skills were updated.

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
