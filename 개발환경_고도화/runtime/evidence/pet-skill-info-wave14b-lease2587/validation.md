# Wave14B `/펫스킬정보` SHADOW 검증

- Run: `펫스킬정보DB-SL-PET-SKILL-INFO-ACTUAL-INGRESS-01-202609071422`
- Slice/WBS/Lease: `SL-PET-SKILL-INFO-ACTUAL-INGRESS-01` / `762` / `2587`
- 범위: `/펫스킬정보` 전용 SHADOW 평가기와 additive metadata. `/펫스킬확률`, `/펫스킬`, 변경 명령의 rollout은 변경하지 않는다.

## 확인된 범위

- 실제 `buildApp.inject`에서 Iris token, operational channel, legacy `startsWith` 후보, placeholder alias, dispatcher `SHADOW`, event inbox, query-only snapshot까지 통과한다.
- 붙여 쓴 `/펫스킬정보청룡언월도`, 공백-only 사용법, 알 수 없는 스킬, 5자 닉네임 silent guard를 분리했다.
- 스킬명과 사용자 닉네임이 같으면 레거시처럼 스킬 조회가 우선하며, 비관리자 타인 조회는 정확한 거부 문구를 낸다.
- catalog 3 SELECT와 매력 metadata 1 SELECT는 하나의 read-only consistent snapshot 안에서 수행한다. canonical source table DML과 outbox는 0이다.
- migration 484는 `NOT NULL DEFAULT 0` 컬럼 추가, active 93행 초기화, tier 30행 backfill, constraint 순서로 적용한다. 격리 MariaDB 3332에서 전체 472개 migration, 93 definitions/30 aliases/4 policies seed, rollback, forward 재적용을 통과했다. 포트 3306은 변경하지 않았고 3332는 종료했다.
- 공유 `canonical-pet-skill-read-provider.ts`와 공유 seeder 구현은 변경하지 않았다. 정보 전용 provider가 네 번째 SELECT를 합성한다.

## 의도적으로 남긴 HOLD

- 관리자 타인 펫스킬가방은 레거시 `checkRank`, 프리미엄 머리말, 가방 순서의 완전한 canonical projection이 없다. 빈 응답을 만들지 않고 `ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN`으로 fail closed 한다.
- 일반 SHADOW event inbox는 평가보다 먼저 commit된다. provider transient 실패 후 동일 event 재수신을 안전하게 재평가하는 durable receipt/1205·1213 정책은 별도 atomic slice가 필요하다.
- 현재 SHADOW 진입은 verified operational open-group 정책이다. 레거시 개인방 HoiPass와 `dev/` 접두 명령의 완전 동치는 증명하지 않았다.
- canonical 93개 중 post-freeze 3개는 기준 main.js 90개 이후 승인된 corrective catalog다. strict current-main parity로 과대 주장하지 않는다.
- 위 HOLD 때문에 이 slice는 DIRECT receipt를 등록하거나 rollout을 ACTIVE로 올리지 않는다.

## 검증 결과

- Focused Node: 6 suites, 41 tests PASS.
- Isolated MariaDB: `WAVE14B_ISOLATED_MARIADB_PASS migrations=all seed=93 rollback=true forward=true port=3332 production3306Unchanged=true`.
- `git diff --check`: PASS.
- Type/build: 기존 `src/app.ts(1267,7) TS2563` 단일 baseline 제약으로 실패. Wave14B 신규 파일의 별도 타입 오류는 없다. full/T3/Gate8은 지시대로 실행하지 않았다.
