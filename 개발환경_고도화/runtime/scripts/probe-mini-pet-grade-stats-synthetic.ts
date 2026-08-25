import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetGradeStats } from "../src/mini-pet/grade-stats-read-command.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";
import { ApplicationError } from "../src/shared/application-error.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");
const scope = "mini-pet.public.read:grade_stats";

// 등급 통계 조회 operation과 감사 원장을 집계합니다.
async function counts() {
  const rows = await database.query<Array<Record<string, bigint>>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ?) operations,
    (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = ?) executions,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = ?) audits,
    (SELECT COUNT(*) FROM command_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = ?) commands`, [scope, scope, scope, scope]);
  return rows[0]!;
}

// bag-only, alias, unknown, order, percentage, replay와 rollback을 실제 MariaDB에서 검증합니다.
async function main() {
  const first = await service.readLatestGradeStats({ environmentCode: "dev", providerEventId: "minipet-stats-probe-v1" });
  const replay = await service.readLatestGradeStats({ environmentCode: "dev", providerEventId: "minipet-stats-probe-v1" });
  assert.equal(first.poolVersion, "collection-v1");
  assert.deepEqual(first.gradeAggregate.map((row) => [row.grade, row.count]),
    [["이벤트", 1], ["창조", 1], ["엘리트", 2], ["신화", 1], ["기타", 1]]);
  assert.equal(first.gradeTotalCount, 6);
  assert.deepEqual(first.gradeAggregate.map((row) => row.percentage), ["16.7", "16.7", "33.3", "16.7", "16.7"]);
  assert.deepEqual(replay.gradeAggregate, first.gradeAggregate);
  assert.doesNotMatch(formatMiniPetGradeStats(first), /7마리/);
  const afterReplay = await counts();
  assert.equal(Number(afterReplay.operations), 1);

  await database.execute("DROP TRIGGER IF EXISTS synthetic_fail_minipet_stats_audit");
  await database.execute(`CREATE TRIGGER synthetic_fail_minipet_stats_audit BEFORE INSERT ON command_audit
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic stats rollback'`);
  await assert.rejects(service.readLatestGradeStats({ environmentCode: "dev", providerEventId: "minipet-stats-rollback-v1" }),
    (error: unknown) => error instanceof Error);
  await database.execute("DROP TRIGGER synthetic_fail_minipet_stats_audit");
  assert.deepEqual(await counts(), afterReplay);
  const recovery = await service.readLatestGradeStats({ environmentCode: "dev", providerEventId: "minipet-stats-recovery-v1" });
  assert.equal(recovery.gradeTotalCount, 6);
  console.log(JSON.stringify({ poolVersion: recovery.poolVersion, rows: recovery.gradeAggregate,
    bagOnly: true, aliases: true, unknown: true, replay: true, rollback: true, effectsAfterRecovery: await counts() },
  (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
