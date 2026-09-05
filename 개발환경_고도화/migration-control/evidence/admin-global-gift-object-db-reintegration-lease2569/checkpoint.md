# WBS752 checkpoint

- Gate 1: 레거시 source와 exact command/item/message/11 room order 동결 완료.
- Gate 2: migration 479 및 guarded rollback 완료.
- Gate 3: canonical source binding → item_id, active member snapshot, +1 ownership 구현 완료.
- Gate 4: RFA01~03 typed receipt/outbox 및 partial MODERN dispatch 구현 완료.
- Gate 5: typecheck/build, focused 27/27, object contract, 격리 Maria 8/8, 실제 FK introspection, rollback/reapply/restart 검증 완료.
- Gate 6: P1 4건/P2 2건 보완 후 최신 diff 독립 읽기전용 재리뷰 P0=0/P1=0/P2=0 APPROVED.
- Gate 7: 한국어 commit/push/origin exact clean 진행.

운영 전제: 별도 운영 데이터 이관 WBS가 `canonical_admin_global_gift_channel_configs`에 실제 11개 destination을 legacy 순서로 적재해야 한다. 설정이 정확히 11개가 아니면 명령은 mutation 전에 409로 닫힌다.
