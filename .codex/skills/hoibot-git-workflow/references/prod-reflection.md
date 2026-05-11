# Production Reflection

Production reflection means moving validated task work into `feature/prod`.

## Required Checks

- current branch
- working tree status
- commits to reflect
- whether unrelated commits exist
- validation performed

## Safe Reflection

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
