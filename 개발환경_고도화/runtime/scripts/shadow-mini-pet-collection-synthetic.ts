import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetCollection } from "../src/mini-pet/collection-read-command.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");

// 재시작 뒤 recovery event의 8등급 snapshot과 저장 결과가 그대로 재생되는지 확인합니다.
async function main() {
  const result = await service.readLatestCollection({ environmentCode: "dev", providerEventId: "minipet-collection-recovery-v1", viewerExternalUserId: "synthetic-non-admin-gamma" });
  assert.equal(result.poolVersion, "collection-v1");
  assert.equal(result.collectionGrades.length, 8);
  assert.match(formatMiniPetCollection(result), /^🐹 미니펫 컬렉션/s);
  const rows = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.read:collection:900000005') operations,
    (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = 'mini-pet.read:collection:900000005') executions,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'mini-pet.read:collection:900000005') audits`);
  assert.equal(Number(rows[0]!.operations), 2);
  assert.equal(Number(rows[0]!.executions), 2);
  assert.equal(Number(rows[0]!.audits), 2);
  console.log(JSON.stringify({ shadow: "PASS", poolVersion: result.poolVersion,
    grades: result.collectionGrades.map((row) => row.grade), effects: rows[0] },
  (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
