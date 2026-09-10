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

For production-facing code/data/bug-fix changes, verify
`data/hoiBotChangeLog.json` has a new top entry before reflection. The entry
must increase the latest version by `0.001`, use the reflection date, and
summarize the user-visible fix or change in `changes`.

Workflow-only, documentation-only, and internal agent rule changes may skip
`data/hoiBotChangeLog.json` unless they change live bot behavior or the user
explicitly requests a visible change record.

If the task branch contains unrelated commits, cherry-pick only the validated task commit(s).

After reflecting into `feature/prod`, run relevant validation and push `feature/prod`.

For non-Notion production-facing work, search the confirmed planning data source for the exact feature/command before reflection and reuse a matching page. If none exists, skip Notion synchronization without creating a page or absence marker. Workflow-only work does not require a planning page.

After verifying the pushed `origin/feature/prod`, synchronize the existing planning content to the actual user-visible behavior without a separate implementation record, then update every corresponding Notion READY/HOTFIX item as one completion workflow:

- set `상태` to `🧪 DEV`
- set `운영반영일` to the production-reflection date in Korea Standard Time (`Asia/Seoul`)
- set `운영반영버전` to the exact `ver_<HoiBotVersion>` verified in production

Verify the synchronized planning content and all three properties after updating. Do not write the date or version before remote production verification. If one production change implements multiple linked Notion items, apply the same verified production version to each corresponding item. Report any partial failure rather than claiming the Notion update completed.

After verifying the pushed `origin/feature/prod`, when the PlayMCP KakaoTalk
`나에게 보내기` tool is available, use the `hoibot-playmcp-version-notifier`
skill when available and send exactly `ver_<HoiBotVersion>`. Do not
add a prefix, suffix, commit hash, or explanatory text. Do not send when
production was not updated or remote verification failed. If the tool is
unavailable, skip the notification without failing production reflection and
report that it was skipped. If the available tool fails to send, retry once
when safe and report the notification failure without claiming it was sent.

For bug-fix work on `feature/bugFix`, delete local and remote `feature/bugFix`
after the validated commit has been pushed, reflected into `feature/prod`, and
`feature/prod` has been pushed. The next bug fix should recreate
`feature/bugFix` from the latest `feature/prod`.

For workflow changes:

1. for skill changes, update and validate the canonical `CODEX-CONFIG` folder and push its `main`
2. synchronize the hoiBot `.codex/skills/` deployment mirror from `CODEX-CONFIG`
3. commit and push the workflow change on `feature/workflow`
4. switch to `feature/prod`
5. pull `feature/prod`
6. cherry-pick or merge only the validated workflow commit(s)
7. verify those commit(s) already exist on the pushed `feature/workflow`
8. push `feature/prod`
9. verify personal skill paths are junctions to the canonical folders and the project mirror has no drift
10. report the `CODEX-CONFIG`, workflow source, and `feature/prod` commits plus junction and mirror verification

## Commit Messages

Use Korean summaries.

Good examples:

```text
명령어 안내 문구 오작동 방지
git-agent 운영 반영 규칙 추가
상점 구매 수량 검증 보강
```
