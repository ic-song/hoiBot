# WBS756 checkpoint

- phase: EXECUTE
- catalog: foreman-assigned WBS756
- lease: 2568
- worktree: `C:\Users\user\Desktop\hoiBot-worktrees\guild-territory-attack-runtime4-parity-v1-20260906`
- branch: `codex/guild-territory-attack-runtime4-parity-v1-20260906`
- baseline: `a397e2dc6cb810404efc812ab0c4ee33c43b369b`
- state: final focused T1/T2 complete; latest-diff independent review APPROVED (P0/P1/P2=0); isolated Maria cleanup 0
- commit/push: recorded on the source branch after independent approval; final integration is tracked separately

## changed scope

- additive schema-only migration478 + exact rollback
- canonical runtime4 policy provider: canonical item definition/import replay와 CUID8 candidate 적용
- single production service boundary bootstrap: readiness fail-close, concurrent single effect, replay DML 0
- existing guild territory attack service: candidate priority, `<=`, success-only decrement, RFA03 transaction retry adoption
- focused unit/Maria/resilience tests
- `COMMAND_INDEX.md` verified DB runtime notes
- evidence five files

## invariants

- migration353/387, `main.js`, `Info.js`, `data/*`, castlePremium six, feature/prod, Gate8, operational DB unchanged.
- candidate `item_id`는 canonical PK만 참조하고 legacy inventory는 승인된 import crosswalk로만 해석한다.
- policy priority/bps/source locator는 candidate table 한 곳만 권위이며 canonical definition에 복제하지 않는다.
- object-data contract는 migration478/table을 99번째 대상으로 검사하고 applied353 composite PK를 integration dependency로 pin한다.
- response/outbox/audit/receipt and fallback ordering preserved.
- runtime4 candidate policy is independent from `castlePremiumItem` six metadata.

## next action

1. foreman이 source commit을 최종 통합 기준선에 반영한다.
2. WBS/Lease 승인 기록 후 운영 데이터 이관과 Gate8은 별도 WBS로 유지한다.
