# Branch Policy

## Branch Roles

- `feature/prod`: operational branch for production-facing code.
- `feature/hoi`: primary hoi-managed task branch used by operation scripts.
- `feature/workflow`: documentation, agent strategy, branch strategy, and tools workflow changes.
- `feature/bugFix` or requested bugfix casing: bug fixes, root-cause analysis, minimal fixes, and regression validation.
- `main`: stable/reference branch, not the active production source.

## Freshness Rule

When starting work on a specific branch:

1. update the target branch from its upstream
2. bring `origin/main` into the target branch
3. start task edits only after freshness/conflicts are handled

This reduces later conflicts.
