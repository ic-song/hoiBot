import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetEquippedRank } from "../src/mini-pet/equipped-rank-read-command.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");

// 재시작 뒤 동일 event가 저장 결과를 재생하고 stable 순위를 유지하는지 확인합니다.
async function main() {
  const result = await service.readLatestEquippedRank({ environmentCode: "dev", providerEventId: "minipet-rank-recovery-v1" });
  assert.equal(result.poolVersion, "equipped-rank-v1");
  assert.deepEqual(result.owned.map((item) => item.ownedId), ["900000001", "900000021", "900000031"]);
  assert.match(formatMiniPetEquippedRank(result.owned), /^🏆 미니펫 종합 순위 🏆\n1위\. 🧪테스트알파/s);
  const rows = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.public.read:equipped_rank') operations,
      (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:equipped_rank') executions,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'mini-pet.public.read:equipped_rank') audits`
  );
  assert.equal(Number(rows[0]!.operations), 2);
  assert.equal(Number(rows[0]!.executions), 2);
  assert.equal(Number(rows[0]!.audits), 2);
  console.log(JSON.stringify({ shadow: "PASS", poolVersion: result.poolVersion,
    stableOrder: result.owned.map((item) => item.ownedId), effects: rows[0] },
    (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
