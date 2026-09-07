# Wave14A-2 `/펫스킬확률` 원자성 검증

- 고정 소스: `fe502370`, Git tree `55373a58b3d58df4490aca55cccffd3e9f7b17bc`.
- 원자 경계: 공통 Maria exact-pair retry가 매 시도 새 root transaction을 열고 inbox claim, actor/canonical projection, operation, command execution, audit, outbox를 함께 commit/rollback한다.
- 멱등성: 동일 event exact replay는 callback과 outbox를 추가하지 않는다. 환경·DB·event/provider·payload·message·actor·channel·destination drift는 fail closed 한다.
- 무응답 경계: 미가입과 닉네임 길이 guard도 operation/execution/audit terminal receipt를 남기며 outbox는 만들지 않는다.
- 실제 HTTP: provider/queue 중간 실패 rollback 후 재처리, 1205/1213 exact pair retry, code-only/errno-only no retry, 3회 exhaustion, 동시 요청 단일 outbox를 isolated MariaDB에서 확인했다.
- 정규 펫스킬 정의·alias·grade policy는 전후 count/hash가 같고 외부 네트워크는 주입 callback 외 0회다.
- `/펫스킬`, `/펫스킬정보`, 운영 DB/data, feature/prod, Gate8은 변경하지 않았다.

## 집중 검증

- `node --import tsx --test test/maria-database-error-policy.test.ts test/pet-skill-probability-service.test.ts test/pet-skill-probability-migration.test.ts test/pet-skill-probability-source-provenance.test.ts test/canonical-pet-skill-read-provider.test.ts` — 22/22 PASS
- `WAVE14A_ISOLATED_MARIADB_TEST=true node --import tsx --test test/pet-skill-probability-http-mariadb.integration.test.ts` — 1/1 PASS
- `npm run typecheck` — PASS
- `npm run build` — PASS
- 독립 dirty review — P0 0, P1 0

정식 executable parity receipt와 ledger DIRECT 승격은 이 provenance 이후 생성·검증될 때만 인정한다.
