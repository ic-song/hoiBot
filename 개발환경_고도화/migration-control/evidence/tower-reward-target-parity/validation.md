# SL-ASSET-TOWER-REWARD-TARGET-PARITY-01 검증

- 기준 커밋: `631a882216e37303761e885c711a24087f27ab48`
- 구현 커밋: `423ad5d7d63cd4c37a5c2976c9bcc6b354051619`
- 승인 원본: `5925b83b1dbfb78ef583354604e112b9430003f3:data/trialTowerBoss.json`, `5925b83b1dbfb78ef583354604e112b9430003f3:data/eventTowerBoss.json`
- 카탈로그 버전: `ASSET-FREEZE-v2.438-tower-reward-target-01`
- 마이그레이션: `429_tower_reward_target_parity.sql`

## 정합성

- 시련탑 보스 120개와 이벤트 보스 7개, 보상 occurrence 384개를 승인 원본 순서대로 고정했습니다.
- 이벤트 층 occurrence 368개를 별도 보존하고 이벤트 우선·시련탑 최초 범위 매칭 규칙을 유지했습니다.
- 보상 target 24개 중 기존 exact canonical 정의 22개를 재사용하고 `신입지원금`, `펫타이틀권🦊(/펫타이틀이름)` STACK 정의 2개만 추가했습니다.
- 이벤트 보상 변경 1건과 시련탑 보상 변경 보스 120개를 원본 행 단위로 보존했습니다.
- 신규 보유 모델, provider, consumer cutover, 운영 데이터 변경은 없습니다.

## 검증 결과

- focused test: 7/7 PASS
- TypeScript typecheck: PASS
- build: PASS
- fresh MariaDB migration: 411개 적용, migration 429 포함
- replay: applied 0
- rollback: 신규 catalog/boss/floor/reward/item/object 0, 기존 시련탑 기반 행 보존
- rollback/replay/restart/reconnect: PASS
- relational probe: 7/7 PASS
- Shadow parity: 384/384 PASS
- full regression: 1,408 total / 1,401 pass / 0 fail / 7 skip
- Gate 8: FALSE

전용 합성 MariaDB 컨테이너에서만 검증했으며 feature/prod 및 운영 DB는 변경하지 않았습니다.
