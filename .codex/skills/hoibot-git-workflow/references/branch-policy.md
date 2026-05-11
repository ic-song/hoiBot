# Branch Policy

## Branch Roles

- `feature/prod`: operational branch for production-facing code.
- `feature/hoi`: primary hoi-managed task branch used by operation scripts.
- `feature/workflow`: documentation, agent strategy, branch strategy, and tools workflow changes.
- `feature/bugFix` or requested bugfix casing: bug fixes, root-cause analysis, minimal fixes, and regression validation.
- `main`: stable/reference branch, not the active production source.

## Production Guard

Do not commit directly on `feature/prod`, and do not push direct local edits to
`feature/prod`. Like `main`, `feature/prod` is a protected integration target.
Update it only by reflecting validated task-branch work through merge,
cherry-pick, or an approved PR-style merge flow.

Classify changed files before production reflection. Use `feature/workflow` for
documentation, workflow, branch strategy, tools, or Codex skill changes unless
the user explicitly confirms `feature/prod` reflection for that specific
workflow change.

## Freshness Rule

When starting work on a specific branch:

1. update the target branch from its upstream
2. bring `origin/main` into the target branch
3. start task edits only after freshness/conflicts are handled

This reduces later conflicts.
