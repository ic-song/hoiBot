---
name: hoibot-git-workflow
description: Use for hoiBot branch selection, origin/main freshness updates, Korean commit messages, pushing task branches, reflecting changes into feature/prod, and choosing merge versus cherry-pick.
---

# hoiBot Git Workflow

Use this skill for git branch, commit, push, and production reflection tasks in the hoiBot repository.

## Core Rules

- Check the current branch and working tree before switching, committing, pushing, or merging.
- Commit messages should be written in Korean as clear, human-readable summaries.
- Do not push directly to `main`.
- Do not merge directly into `main`.
- Do not commit directly on `feature/prod`.
- Do not push direct local edits to `feature/prod`.
- Update `feature/prod` only by reflecting validated task-branch work through merge, cherry-pick, or an approved PR-style merge flow.
- `feature/prod` is the operational branch.
- Documentation, workflow, branch strategy, and tools changes belong on `feature/workflow`.
- Bug fixes belong on the requested bugfix branch; if both `feature/bugFix` and `feature/bugfix` exist, verify the exact casing requested by the user.
- Before starting work on a specific branch, bring `origin/main` into that branch first.

## Starting Work On A Branch

1. Run `git status --short --branch`.
2. Switch to the target branch.
3. Pull the target branch with fast-forward only when possible.
4. Fetch `origin/main`.
5. Merge or otherwise bring `origin/main` into the target branch before editing.
6. Resolve conflicts before making task changes.

## Production Reflection

When the user says "prod까지 올려줘" or "운영반영해줘":

1. Classify the changed files before touching `feature/prod`.
2. Treat the user's production-reflection keyword as a request for the work to end up on `feature/prod`; do not stop after pushing only the source task branch unless you explicitly tell the user `feature/prod` was not updated.
3. If the change is documentation, workflow, branch strategy, tools, or Codex skill work, commit and push it on `feature/workflow` first.
4. After the workflow branch is pushed, reflect only the validated workflow commit(s) into `feature/prod` by cherry-pick, merge, or approved PR-style merge flow when the user has requested production reflection.
5. For production-facing code/data work, commit and push the current task branch first.
6. Switch to `feature/prod`.
7. Pull `feature/prod`.
8. Reflect only the validated work into `feature/prod` by merge, cherry-pick, or approved PR-style merge flow.
9. Push `feature/prod`.
10. In the final response, explicitly state whether `feature/prod` was updated and which commit(s) were reflected.

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
