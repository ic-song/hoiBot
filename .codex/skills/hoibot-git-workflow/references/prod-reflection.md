# Production Reflection

Production reflection means moving validated task work into `feature/prod`.

Branch role classification comes first. Do not commit directly on
`feature/prod`, and do not push direct local edits to `feature/prod`.
Update `feature/prod` only by reflecting validated task-branch work through
merge, cherry-pick, or an approved PR-style merge flow.
Documentation, workflow, branch strategy, tools, and Codex skill changes belong
on `feature/workflow` unless the user explicitly confirms direct `feature/prod`
reflection for that workflow change.

## Required Checks

- current branch
- working tree status
- changed file classification
- commits to reflect
- whether unrelated commits exist
- validation performed

## Safe Reflection

Do not commit directly on `feature/prod`.

Do not push direct local edits to `feature/prod`.

If the task branch contains unrelated commits, cherry-pick only the validated task commit(s).

After reflecting into `feature/prod`, run relevant validation and push `feature/prod`.

## Commit Messages

Use Korean summaries.

Good examples:

```text
명령어 안내 문구 오작동 방지
git-agent 운영 반영 규칙 추가
상점 구매 수량 검증 보강
```
