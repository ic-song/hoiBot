import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetAdminInfo } from "../src/mini-pet/admin-info-read-command.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");

// 재시작 뒤 동일 관리자 event와 허용 필드 snapshot이 그대로 재생되는지 확인합니다.
async function main() {
  const result = await service.readLatestAdminInfo({ environmentCode: "dev", providerEventId: "minipet-admin-recovery-v1",
    viewerExternalUserId: "synthetic-admin-alpha", requestChannelId: "synthetic-room-001", targetName: "테스트베타" });
  assert.equal(result.targetDisplayName, "테스트베타");
  assert.deepEqual(Object.keys(result.adminLegacySnapshot ?? {}).sort(), ["bag", "battle", "collection", "draw", "equipped", "profile"]);
  assert.match(formatMiniPetAdminInfo(result), /^🔎 테스트베타님의 미니펫 정보/s);
  const rows = await database.query<Array<{ operations: bigint; executions: bigint; audits: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.read:admin_info:900000004') operations,
      (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = 'mini-pet.read:admin_info:900000004') executions,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'mini-pet.read:admin_info:900000004') audits`
  );
  assert.equal(Number(rows[0]!.operations), 2);
  assert.equal(Number(rows[0]!.executions), 2);
  assert.equal(Number(rows[0]!.audits), 2);
  console.log(JSON.stringify({ shadow: "PASS", target: result.targetDisplayName,
    allowedFields: Object.keys(result.adminLegacySnapshot ?? {}), effects: rows[0] },
  (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
