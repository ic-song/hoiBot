# WBS756 scenario matrix

| 시나리오 | 기대 결과 | 직접 검증 |
| --- | --- | --- |
| 방어 50·20 동시 보유, draw 20% 초과/50% 이하 | 50 선택·50만 1 차감·방어 승리 | Maria PASS |
| 방어 50 미보유, 20 보유·성공 | 20 선택·1 차감·방어 승리 | Maria PASS |
| 공격 40·10 동시 보유, 40 성공 | 40 선택·40만 1 차감 | Maria PASS |
| 공격 40 미보유, 10 보유·성공 | 10 선택·1 차감·기습 승리 | Maria PASS |
| item draw == threshold | 성공 (`<=`) | unit PASS |
| 상위 방어·공격 item roll 실패, 하위도 보유 | 하위 재판정 없이 둘 다 미차감, snapshot fallback | Maria PASS |
| 공격 item 성공 뒤 cube strict `<` 성공 | 공격 item 차감 유지, 방어 승리, 환불 없음 | Maria PASS |
| cube 0 또는 미발동 | 공격 item 차감 후 점령 | Maria PASS |
| late receipt 실패 | 공격횟수·기금·draw·ledger·audit·outbox 전부 rollback | Maria PASS |
| 동일 event replay | 저장 결과 재생, mutation 한 번 | Maria PASS |
| 새 DB client로 재접속 후 replay | 동일 결과, operation 한 건 | Maria PASS |
| SHADOW dispatch | mutation 0 | Maria PASS |
| runtime4 provider 최초 적용 | canonical definition/import와 candidate 각 4행 생성 | Maria PASS |
| 동시 최초 명령 두 건 | service bootstrap 직렬화, candidate 총 4행·명령 mutation single effect | Maria PASS |
| runtime4 provider 재적용 | 기존 canonical identity를 재사용하고 candidate DML 0, replay 4 | Maria PASS |
| migration478 rollback 뒤 재적용 | canonical definition/import 4행 보존, 빈 candidate table을 provider가 4행 복원 | Maria PASS |
| canonical definition 또는 candidate 정책값 drift | 조용히 덮어쓰지 않고 fail-close | Maria PASS |
| legacy 표시명/active crosswalk drift | provider readiness에서 명령 transaction 전 fail-close | Maria PASS |
| 1213/1205 | root transaction 전체만 domain 허용 3회 제한 재시도 | RFA03 focused PASS |
| migration rollback | 후보 table 제거, policy353·metadata387 보존 | Maria PASS |
| migration restart apply | schema만 재생성 후 provider replay가 후보 네 행 복원 | Maria PASS |
| migrate 직후 SHADOW | candidate 0행 유지, mutation 0 | Maria PASS |

`castlePremiumItem` 여섯 metadata를 runtime4 후보로 매핑하거나 수정하는 시나리오는 범위 밖이며 실행하지 않았다.
