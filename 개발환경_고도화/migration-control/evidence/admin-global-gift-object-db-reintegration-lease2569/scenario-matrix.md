# WBS752 scenario matrix

| 시나리오 | 기대 | 결과 |
|---|---|---|
| exact `/선물전달` | 후보 인정 | PASS |
| 공백·접미·인자·개행 | 후보 거부 | PASS |
| SHADOW | 지급/outbox 0 | PASS |
| 권한 없는 identity | 403, 지급 0 | Maria PASS |
| active channel 11 미만/순서 gap | 409, 지급 0 | Maria PASS |
| active legacy 회원의 canonical mapping 누락 | 409, 지급/outbox 0 | Maria PASS |
| 신규/기존 stack 혼합 | 각 active snapshot 대상 +1 | Maria PASS |
| same event 동시 2회 | 1회 실행+1회 replay | Maria PASS |
| 재시작 후 same event | 최초 11 outbox DTO replay, 추가 DML 0 | Maria PASS |
| same event/actor + 다른 inbound channel | RFA01 payload conflict | Maria PASS |
| replay outbox payload/status drift | fail closed | Maria PASS |
| recipient player 단일행 치환(행수 동일) | recipient aggregate drift로 fail closed | Maria PASS |
| recipient before/after 동시 변조(관계식 유지) | recipient aggregate drift로 fail closed | Maria PASS |
| stack owner만 다른 player로 치환(aggregate 동일) | recipient↔stack 관계 drift로 fail closed | Maria PASS |
| operation item만 다른 canonical item으로 치환(aggregate 동일) | operation↔stack↔terminal 관계 drift로 fail closed | Maria PASS |
| commit ACK ambiguous | 전체 receipt/snapshot/outbox 재검산 후 reconcile | Maria PASS |
| ambiguous ACK 재조회 첫 SELECT 직후 별도 connection recipient drift commit | 단일 fresh transaction의 일관된 snapshot만 검산, pool autocommit read 0 | Maria PASS |
| 수량 overflow | recipient/stack/outbox/receipt 전량 rollback | Maria PASS |
| 적용된 receipt 존재 시 rollback | fail closed | Maria PASS |
| provenance=true + 무관 owned instance FK 참조 | rollback 시작 전 fail closed, table/item/instance DDL·DML 0 | Maria PASS |
| empty-state rollback/reapply | 5개 전용 table 제거/재생성 | Maria PASS |
| 선재 exact source binding(예약 ID 포함) | provenance=false, 재귀속 0, rollback 후에도 원행 불변 | Maria PASS |
| 선재 source binding drift | migration 전 fail closed | Maria PASS |

채널 설정은 합성 `synthetic-room-1..11`만 사용했다. 실제 room ID는 읽거나 기록하지 않았다.
