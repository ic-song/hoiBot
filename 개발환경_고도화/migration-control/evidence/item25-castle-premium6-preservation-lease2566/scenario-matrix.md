# WBS755 시나리오 매트릭스

| 시나리오 | 기대 결과 |
| --- | --- |
| exact castlePremium 6 pointer | offense 3 + defense 3을 독립 occurrence로 유지 |
| 원문 name/successRate | 1, 0.6, 0.2 / 1, 0.5, 0.25 exact 보존 |
| migration 387 active 정의 | 6건 이름·확률·active=1 유지 |
| canonical provider projection | `TERRITORY_TICKET`, active_flag=true, definition_options exact |
| CUID identity/crosswalk | 기존 `item_id CHAR(8)`와 locator crosswalk 재사용 |
| duplicate/collapse/rate drift | provider가 DML 전 fail-close |
| legacy runtime four | source six와 mapping을 추론하거나 확률을 변경하지 않음 |

이 검증은 WBS756 runtime4 parity remediation을 대신하지 않는다.
