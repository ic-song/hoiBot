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
- Update `feature/prod` only by reflecting validated task-branch work through merge, cherry-pick, or an approved PR-style merge flow.
- `feature/prod` is the operational branch.
- Local `feature/prod` is the active operational baseline for production-facing and bug-fix work.
- Documentation, workflow, branch strategy, and tools changes belong on `feature/workflow`.
- Validated `feature/workflow` changes should be reflected into `feature/prod` by default after `feature/workflow` is pushed, unless the user explicitly says not to reflect them.
- When `.codex/skills/` files change, update the corresponding local Codex skill files after `feature/prod` is updated, if filesystem permissions allow it.
- Bug fixes belong on `feature/bugFix` unless the user explicitly requests another exact branch; if both `feature/bugFix` and `feature/bugfix` exist, verify the exact casing requested by the user.
- Before starting work on a specific branch, update local `feature/prod` from `origin/feature/prod`, then bring that local `feature/prod` into the branch.
- Other task branches should be based on the updated local `feature/prod`, not on `origin/main`.
- Do not use `origin/main` as the freshness baseline for production-facing or bug-fix work unless the user explicitly requests main synchronization.
- Create PRs from `feature/prod` to `main` only when the user explicitly requests stable synchronization after operational stabilization.

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
6. Switch to `feature/prod`.
7. Pull `feature/prod`.
8. Reflect only the validated work into `feature/prod` by merge, cherry-pick, or approved PR-style merge flow.
9. Push `feature/prod`.
10. If `.codex/skills/` changed, update the corresponding local Codex skill files when possible.
11. In the final response, explicitly state whether `feature/prod` was updated, which commit(s) were reflected, and whether local skills were updated.

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
