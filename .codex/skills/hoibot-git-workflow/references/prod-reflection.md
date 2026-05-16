# Production Reflection

Production reflection means moving validated task work into `feature/prod`.

Branch role classification comes first. Do not commit directly on
`feature/prod`, and do not push direct local edits to `feature/prod`.
Update `feature/prod` only by reflecting validated task-branch work through
merge, cherry-pick, or an approved PR-style merge flow.
Documentation, workflow, branch strategy, tools, and Codex skill changes belong
on `feature/workflow` unless the user explicitly confirms direct `feature/prod`
reflection for that workflow change. After validated workflow changes are
committed and pushed on `feature/workflow`, reflect those commits into
`feature/prod` by default unless the user explicitly says not to.

A production-reflection keyword means the user expects `feature/prod` to be
updated. Branch classification decides the source branch and reflection method;
it does not by itself cancel the production reflection. If the work is only
pushed to `feature/workflow`, state clearly that `feature/prod` was not updated.

## Required Checks

- current branch
- working tree status
- changed file classification
- commits to reflect
- whether unrelated commits exist
- validation performed
- whether `feature/prod` was actually updated

## Safe Reflection

Do not commit directly on `feature/prod`.

Do not push direct local edits to `feature/prod`.

If the current checkout is `feature/prod`, do not make task or follow-up
commits there. Switch to the original task branch, `feature/workflow`, or a
new task branch first, then commit and push that source branch before touching
`feature/prod`.

Before pushing `feature/prod`, verify the commit(s) being pushed already exist
on a pushed source branch. If they do not, stop and move the work to the correct
source branch first.

If the task branch contains unrelated commits, cherry-pick only the validated task commit(s).

After reflecting into `feature/prod`, run relevant validation and push `feature/prod`.

For bug-fix work on `feature/bugFix`, delete local and remote `feature/bugFix`
after the validated commit has been pushed, reflected into `feature/prod`, and
`feature/prod` has been pushed. The next bug fix should recreate
`feature/bugFix` from the latest `feature/prod`.

For workflow changes:

1. commit and push the workflow change on `feature/workflow`
2. switch to `feature/prod`
3. pull `feature/prod`
4. cherry-pick or merge only the validated workflow commit(s)
5. verify those commit(s) already exist on the pushed `feature/workflow`
6. push `feature/prod`
7. if `.codex/skills/` changed, update the corresponding local Codex skill files when possible
8. report both the workflow source commit and the `feature/prod` reflected commit, plus whether local skills were updated

## Commit Messages

Use Korean summaries.

Good examples:

```text
명령어 안내 문구 오작동 방지
git-agent 운영 반영 규칙 추가
상점 구매 수량 검증 보강
```
