# Lease2618 공식 WBS742 경로 정렬

- 공식 worktree: `C:\Users\user\Desktop\hoiBot-worktrees\object-db-import-v1-20260903`
- 공식 branch: `codex/object-db-import-v1-20260903`
- 공식 기준: `ab7a347d4572e453b11918fda987bc58c55d4cf1`
- 통합 부모: `d99832c56972c7ff81fbe7a075fc65869a7192bf`
- 경로 정렬 merge: `a17e2254`
- delimiter 실행기 merge: `d355bd31`
- delimiter source: `cfec1a17f2a0d7b774c10a410234ca3754956daa`

## 충돌 해소

- 충돌 14개를 stage2 공식 WBS742와 stage3 통합 상태로 각각 대조했다.
- 공식 WBS742의 45 direct targets, 241 columns, 23 definition targets, atomic import, replay, reverse rollback 및 parity 의미는 stage3에 모두 포함돼 있었다.
- stage3는 V1~V4 profile, 119 registered tables, pre-466 compatibility, item-bag completeness와 최신 검증을 추가한다.
- 따라서 충돌 14개는 stage3를 채택했고, 공식 고유 5개 commit은 merge parent ancestry로 보존했다.

## 검증

- object-domain/catalog/profile/parity/migration delimiter 집중 테스트: `85/85 PASS`
- `npm run typecheck`: `PASS`
- `npm run build`: `PASS`
- `npm run object-data:validate`: `PASS`, registered tables `119`
- unmerged paths: `0`
- operating DB/3306/operating JSON/live room/network/feature-prod: `0`

전체 회귀는 이 Lease 범위에서 실행하지 않았다.
