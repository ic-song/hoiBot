# WBS753 시나리오 매트릭스

| 시나리오 | 기대 결과 |
| --- | --- |
| exact dept1 8 pointer와 원문 payload | 8건 모두 manifest와 audit fingerprint 일치 |
| migration 386 active 정의 | 8건 이름 보존, active=1 유지 |
| canonical provider projection | `RAID_SPECIAL`, active_flag=true, definition_options exact |
| CUID identity/crosswalk | 기존 `item_id CHAR(8)` 및 source locator crosswalk 재사용 |
| generic ownership | `player_id + item_id` 조건부 stack 경로 사용, 이름 비교 없음 |
| pointer 또는 payload drift | provider가 DML 전 fail-close |
| bare auction 이름 | exact 8과 동일 identity로 추론하지 않음 |

획득·효과·전용 consumer는 추가하지 않는다. 보존 검증과 별개인 제품 결정을 만들지 않는다.
