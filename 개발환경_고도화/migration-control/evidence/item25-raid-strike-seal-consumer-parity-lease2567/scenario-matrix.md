# WBS754 시나리오 매트릭스

| 시나리오 | 기대 결과 | 결과 |
|---|---|---|
| exact pointer/locator/payload/active/CUID | 같은 canonical `item_id` 1개로 해석 | PASS |
| sealed options `{name, exp:600}` | 정규화 hash까지 일치하고 type/extra-field drift 거절 | PASS |
| `/레이드인장조합 2` | 잡템 2,000·포인트 20억 차감, canonical 인장 2 지급, 응답 보존 | PASS |
| `/레이드인장조합 0` | 기존 최소 수량 1 보존 | PASS |
| 잡템/포인트 부족 | mutation 전에 기존 오류로 거절 | PASS |
| 같은 event·같은 payload 재시작 | 저장 결과 반환, 두 번째 inventory effect 0 | PASS |
| 같은 event의 quantity/channel 변경 | RFA01 request reuse conflict, mutation 0 | PASS |
| canonical ledger 실패 | 공용 root transaction rollback, outbox/completed 0 | PASS |
| 패키지 exact 입력 | `ITEM-RWD-043`은 경계 입력으로만 허용하고 canonical stack으로 지급 | PASS |
| 탑 exact 보상 | `/0/reward/15`, quantity 10 보존; 실행 시 canonical stack으로 지급 | PASS |
| modern 매력 순위 | legacy exact 합계를 제외하고 canonical 수량 × sealed 600을 1회 합산 | PASS |
| 홈 요구 재료 | exact 이름 occurrence 140 및 canonical CUID repository 소비 경계 보존 | PASS |
| 소유 원장 | exact target의 legacy stack/ledger dual-write 0 | PASS |
| Shadow | 격리 Maria actual exact SQL, package/tower DML, charm 1회 합산, replay/rollback | PASS |

실운영 데이터 이관, 운영 Shadow 관찰, 신규 home command, Gate 8은 범위 밖입니다. 감사된 기존 308명/7,342개 소유 이관과 대조가 끝나기 전에는 modern consumer 전환을 운영 활성화하지 않습니다.
