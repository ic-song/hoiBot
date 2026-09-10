# Branch Policy

## Branch Roles

- `feature/prod`: operational branch for production-facing code.
- `feature/hoi`: primary hoi-managed task branch used by operation scripts.
- `feature/workflow`: documentation, agent strategy, branch strategy, and tools workflow changes.
- `feature/bugFix`: short-lived bug-fix branch created fresh from the latest `feature/prod` for one bug-fix cycle, unless the user explicitly requests another exact branch.
- `main`: stable/reference branch, not the active production source.

Local `feature/prod` is the active operational baseline. Other task branches
should be based on the updated local `feature/prod`, not on `origin/main`.

## Production Guard

Do not commit directly on `feature/prod`, and do not push direct local edits to
`feature/prod`. Like `main`, `feature/prod` is a protected integration target.
Update it only by reflecting validated task-branch work through merge,
cherry-pick, or an approved PR-style merge flow.

If work is requested while the current checkout is already `feature/prod`,
switch to the correct source branch before editing. The commit being pushed to
`feature/prod` must first exist on a pushed source branch.

Classify changed files before production reflection. Use `feature/workflow` for
documentation, workflow, branch strategy, tools, or Codex skill changes unless
the user explicitly confirms `feature/prod` reflection for that specific
workflow change.

User-authored skill source changes belong in `AGENT-HUB`. The hoiBot
`.codex/skills/` tree is a generated deployment mirror and should reach
`feature/workflow` only after the canonical change is validated and pushed.

## Freshness Rule

When starting work on a specific branch:

1. update local `feature/prod` from `origin/feature/prod`
2. update the target branch from its upstream
3. bring local `feature/prod` into the target branch
4. start task edits only after freshness/conflicts are handled

Do not use `origin/main` as the freshness baseline for production-facing or
bug-fix work. `main` is a stable/reference branch and should be synchronized
only when explicitly requested.

Do not proactively synchronize `feature/prod` into `main`. After operational
stabilization, wait for the user to request a PR from `feature/prod` to `main`.

This reduces later conflicts.

## Bug-Fix Branch Lifecycle

Use `feature/bugFix` as a disposable branch, not a long-lived integration branch.

1. Start from the latest `feature/prod`.
2. Delete/recreate local `feature/bugFix` if an old one exists and its previous work is already reflected into `feature/prod`.
3. Implement and validate the bug fix on `feature/bugFix`.
4. Push `feature/bugFix`.
5. Reflect only the validated bug-fix commit into `feature/prod`.
6. Push `feature/prod`.
7. Delete local and remote `feature/bugFix` by default.

If the old `feature/bugFix` contains unreflected commits, stop and decide whether
to preserve, back up, or explicitly discard those commits before recreating the
branch.
