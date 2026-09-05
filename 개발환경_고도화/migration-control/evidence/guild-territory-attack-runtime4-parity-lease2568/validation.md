# WBS756 validation

## focused T1

```text
node --import tsx --test test/guild-territory-attack.test.ts test/guild-territory-attack-runtime4-policy.test.ts test/maria-database-error-policy.test.ts
15/15 PASS

node --import tsx --test test/object-data-model-contract.test.ts
23/23 PASS
```

## isolated MariaDB T2

- container: `hoibot-modernization-mariadb-1`
- dedicated schema: `hoibot_wbs756_20260906`
- migrations: 001~478, file count 466, migration478 fresh apply PASS
- 운영 snapshot/운영 DB 사용: 0

```text
node --import tsx --test test/guild-territory-attack-mariadb.integration.test.ts
13/13 PASS

node --import tsx --test test/guild-territory-attack-resilience-mariadb.integration.test.ts
4/4 PASS
```

검증 범위: runtime4 전 후보, 우선순위, `<=`, 성공 시만 차감, 공격 차감→cube strict `<`, no-refund, fallback, replay, 동시 duplicate, forced late rollback, 새 DB client 재접속 replay, SHADOW mutation 0.

## schema / rollback / restart

- candidate rows: 4, role priority `DEFENSE 50→20`, `ATTACK 40→10`.
- canonical runtime4 definitions/imports: `4/4`; 동시 최초 provider 두 건 합계 `inserted 4/replayed 4`, 즉시 재적용 `inserted 0/replayed 4`.
- PK: `guild_territory_attack_item_candidate_id CHAR(8) ascii/ascii_bin`, four CUID2-8 values.
- FK: `item_id CHAR(8) ascii/ascii_bin → canonical_item_definitions.item_id`; policy composite FK도 참조 컬럼 이름·타입 일치.
- audit: `INSERT_USER`, `INSERT_TIME`, `UPDATE_USER`, `UPDATE_TIME`, KST CHAR(19), NOT NULL, format CHECK.
- rollback 전/후 preserved counts: policy353 `1→1`, metadata387 `6→6`, canonical runtime4 definition/import `4/4→4/4`; candidate rows `4→table absent`.
- schema migration record를 격리 rehearsal에서 제거한 뒤 migration runner 재실행: migration478 schema 재적용 PASS, provider replay로 candidate rows `0→4`.
- 재적용 직후 SHADOW는 candidate `0→0`; 이어진 동시 ACTIVE 명령 두 건이 service bootstrap을 거쳐 candidate `0→4`, 동일 event mutation 한 건만 생성.
- candidate 정책 bps와 legacy 표시명 synthetic drift를 각각 주입해 stable drift error로 fail-close한 뒤 원복.

## static/build/standard

```text
npm.cmd run typecheck       PASS
npm.cmd run build           PASS
npm.cmd run object-data:validate  PASS, registered objects 99 (migration478 candidate 포함)
git diff --check            PASS
```

- full suite: 실행하지 않음(T1/T2 제한 준수).
- `main.js`, `Info.js`, `data/*`, migration353, migration387 diff 0.
- independent latest-diff review: focused 전체 `38/38`, type/build/object99/diff PASS; `P0=0, P1=0, P2=0`, APPROVED.
- isolated Maria cleanup: exact schema `hoibot_wbs756_20260906` 존재 `1→0`; 잔존 schema 0.
- migration478 SHA-256: `f196c3cfd6fc6665355010c673da1e57e1d775a8a2ff0c86deb4e44649af0f9c`.
- service SHA-256: `d6f8a5654db68aaaccbcdf239d6fcf181787912f2cfa3748520640d7e5661bd0`.
- runtime4 provider SHA-256: `ef45498528bbc17bde10d888ea8d60378fa502a4423ebb24c3ce82a223bfc004`.
- object-data contract SHA-256: `a83f712501783b7e6356d7635feebcf71f19b44fbf36ef6de7ff20018cd9ba20`; validator SHA-256: `49590f74f5be52709a1fcdb0479d601510e3c6bb43f5765b3f7efbe55acec932`.
- standard contract/validator: migration478 table + applied353 integration dependency 등록, registered objects `98→99`.
