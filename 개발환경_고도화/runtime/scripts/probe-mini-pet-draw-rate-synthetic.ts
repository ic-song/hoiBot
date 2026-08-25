import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";
import { formatMiniPetDrawRates } from "../src/mini-pet/draw-rate-read-command.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");
const expectedGrades = ["일반", "고급", "희귀", "영웅", "전설", "전설+", "신화", "신화+", "초월", "초월+", "태초", "태초+", "창세", "창조"];

try {
  const first = await service.readLatestDrawRates({ environmentCode: "dev", providerEventId: "minipet-draw-rate-probe-v1" });
  const replay = await service.readLatestDrawRates({ environmentCode: "dev", providerEventId: "minipet-draw-rate-probe-v1" });
  assert.equal(first.poolVersion, "draw-rate-v1");
  assert.deepEqual(first.catalog.map((entry) => entry.filterKey), expectedGrades);
  assert.equal(first.catalog.some((entry) => entry.filterKey === "이벤트"), false);
  assert.equal(first.totalRawProbability, "100.00000000");
  assert.deepEqual(replay, first);
  assert.match(formatMiniPetDrawRates(first), /^📊 미니펫 등급별 뽑기 확률\n일반: 50\.0000%/);
  assert.match(formatMiniPetDrawRates(first), /창조: 0\.1000%\n총 확률: 1\.0000$/);

  await assert.rejects(service.read({
    projectionCode: "draw_rates", environmentCode: "dev", poolVersion: "draw-rate-v1",
    snapshotAt: "2026-08-25T04:00:01.000Z", providerEventId: "minipet-draw-rate-rollback-v1"
  }));
  const recovery = await service.readLatestDrawRates({ environmentCode: "dev", providerEventId: "minipet-draw-rate-rollback-v1" });
  assert.deepEqual(recovery.catalog.map((entry) => entry.filterKey), expectedGrades);

  const effects = await database.withTransaction(async (tx) => {
    const rows = await tx.query<Array<{ operations: bigint; executions: bigint; audits: bigint; commands: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.public.read:draw_rates') operations,
        (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:draw_rates') executions,
        (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:draw_rates') audits,
        (SELECT COUNT(*) FROM command_executions WHERE command_code = 'mini_pet_draw_rates') commands`
    );
    const row = rows[0]!;
    return { operations: row.operations.toString(), executions: row.executions.toString(), audits: row.audits.toString(), commands: row.commands.toString() };
  });
  assert.deepEqual(effects, { operations: "2", executions: "2", audits: "2", commands: "2" });
  console.log(JSON.stringify({ poolVersion: first.poolVersion, grades: expectedGrades, allowedOnly: true,
    sourceOrder: true, fourDecimals: true, zeroTotalContract: true, replay: true, rollback: true, effects }));
} finally {
  await database.close();
}
