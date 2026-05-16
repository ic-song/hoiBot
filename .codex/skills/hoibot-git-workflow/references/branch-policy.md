# Branch Policy

## Branch Roles

- `feature/prod`: operational branch for production-facing code.
- `feature/hoi`: primary hoi-managed task branch used by operation scripts.
- `feature/workflow`: documentation, agent strategy, branch strategy, and tools workflow changes.
- `feature/bugFix`: bug fixes, root-cause analysis, minimal fixes, and regression validation, unless the user explicitly requests another exact branch.
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
