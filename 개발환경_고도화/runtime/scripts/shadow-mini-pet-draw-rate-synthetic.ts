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
  const replay = await service.readLatestDrawRates({ environmentCode: "dev", providerEventId: "minipet-draw-rate-rollback-v1" });
  assert.equal(replay.poolVersion, "draw-rate-v1");
  assert.deepEqual(replay.catalog.map((entry) => entry.filterKey), expectedGrades);
  assert.equal(replay.catalog.some((entry) => entry.filterKey === "이벤트"), false);
  assert.match(formatMiniPetDrawRates(replay), /총 확률: 1\.0000$/);
  const effects = await database.withTransaction(async (tx) => {
    const rows = await tx.query<Array<{ operations: bigint; executions: bigint; audits: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.public.read:draw_rates') operations,
        (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:draw_rates') executions,
        (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:draw_rates') audits`
    );
    const row = rows[0]!;
    return { operations: row.operations.toString(), executions: row.executions.toString(), audits: row.audits.toString() };
  });
  assert.deepEqual(effects, { operations: "2", executions: "2", audits: "2" });
  console.log(JSON.stringify({ shadow: "PASS", poolVersion: replay.poolVersion, grades: expectedGrades,
    allowedOnly: true, sourceOrder: true, total: replay.totalRawProbability, effects }));
} finally {
  await database.close();
}
