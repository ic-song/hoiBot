import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");

// 재시작 뒤 recovery event의 bag-only 등급 통계가 그대로 재생되는지 확인합니다.
async function main() {
  const result = await service.readLatestGradeStats({ environmentCode: "dev", providerEventId: "minipet-stats-recovery-v1" });
  assert.equal(result.gradeTotalCount, 6);
  assert.deepEqual(result.gradeAggregate.map((row) => row.grade), ["이벤트", "창조", "엘리트", "신화", "기타"]);
  const rows = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.public.read:grade_stats') operations,
    (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:grade_stats') executions,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:grade_stats') audits`);
  assert.equal(Number(rows[0]!.operations), 2);
  assert.equal(Number(rows[0]!.executions), 2);
  assert.equal(Number(rows[0]!.audits), 2);
  console.log(JSON.stringify({ shadow: "PASS", total: result.gradeTotalCount,
    rows: result.gradeAggregate, effects: rows[0] }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
