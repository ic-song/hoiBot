# WBS752 checkpoint

- Gate 1: 레거시 source와 exact command/item/message/11 room order 동결 완료.
- Gate 2: migration 479 및 guarded rollback 완료.
- Gate 3: canonical source binding → item_id, active member snapshot, +1 ownership 구현 완료.
- Gate 4: RFA01~03 typed receipt/outbox 및 partial MODERN dispatch 구현 완료.
- Gate 5: source 후속 P1/P2 보완 기준 typecheck/build, focused 27/27, object contract 103 table, 격리 Maria 9/9, ambiguous 단일 transaction trace/동시 drift, shared catalog seed 보존 rollback, local/cross-schema/권한0 참조 불변, 예약 ID 보존/reapply/restart 검증 완료.
- Gate 6: source `0708f69f`/`edae6a6b`, `7539d6ee`, `2d3397d7`까지 이전 독립 승인됨. shared catalog seed 보존 rollback으로 재설계한 현재 source diff도 최신 독립 읽기전용 재리뷰 P0=0/P1=0/P2=0 승인 완료.
- Gate 7: 승인된 source diff를 한국어 추가 commit/push하고 origin exact clean을 확인한다. 통합 branch 반영과 승인은 작업반장이 별도 수행한다.

운영 전제: 별도 운영 데이터 이관 WBS가 `canonical_admin_global_gift_channel_configs`에 실제 11개 destination을 legacy 순서로 적재해야 한다. 설정이 정확히 11개가 아니면 명령은 mutation 전에 409로 닫힌다.
