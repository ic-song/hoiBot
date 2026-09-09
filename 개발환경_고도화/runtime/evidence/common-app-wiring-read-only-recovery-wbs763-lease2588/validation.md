# 공용 READ_ONLY SHADOW 복구 검증

- catalog: SC-20260902-1 EXECUTE
- WBS: 763
- lease: 2588
- execution: `공용읽기복구DB-SL-COMMON-APP-WIRING-READ-ONLY-RECOVERY-01-202609071528`
- schema: 기존 migration 002, 462, 466 재사용. 신규 migration 없음.

## 고정 계약

- verified environment/database 객체가 root transaction을 소유한다.
- root transaction은 repeatable-read consistent snapshot으로 시작한다.
- inbox claim, READ_ONLY 평가, projection hash, canonical claim, exact one operation/execution `NO_REPLY` receipt가 한 transaction이다.
- outbox는 0건이다.
- MariaDB 1205/1213만 최대 3회 재시도한다.
- transient exhausted 재시작은 UNIQUE receipt 행을 새로 만들지 않고 기존 failed operation/execution을 fenced update한다.
- non-transient FAILED는 callback 없이 fail-closed replay한다.
- error/result code는 migration 002의 `VARCHAR(64)`에 맞춰 1~64 ASCII 대문자/숫자/밑줄만 허용한다.

## Focused 검증

- `node --import tsx --test test/app-wiring-read-only-recovery-provider.test.ts` — 13/13 PASS
- `node --import tsx --test test/maria-database-error-policy.test.ts` — 8/8 PASS
- `node --import tsx --test test/database-capabilities.test.ts` — production adapter SQL/cleanup 포함 21/21 PASS
- `npm.cmd run typecheck` — PASS
- `npm.cmd run build` — PASS
- `npm.cmd run object-data:validate` — PASS, 등록 대상 105개
- repository root `node --check main.js`, `node --check Info.js`
- `git diff --check`

운영 DB, T3, full suite, feature/prod 반영은 수행하지 않았다.
