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

1. Commit on the current task branch.
2. Push the current task branch.
3. Switch to `feature/prod`.
4. Pull `feature/prod`.
5. Reflect only the validated work into `feature/prod`.
6. Push `feature/prod`.

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
