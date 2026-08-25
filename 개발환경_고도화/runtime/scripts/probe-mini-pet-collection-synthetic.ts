import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetCollection } from "../src/mini-pet/collection-read-command.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";
import { ApplicationError } from "../src/shared/application-error.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");
const scope = "mini-pet.read:collection:900000005";

// 컬렉션 조회 operation과 감사 원장을 집계합니다.
async function counts() {
  const rows = await database.query<Array<Record<string, bigint>>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ?) operations,
    (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = ?) executions,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = ?) audits,
    (SELECT COUNT(*) FROM command_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = ?) commands`,
  [scope, scope, scope, scope]);
  return rows[0]!;
}

// 8등급 pin, missing-unsaved, siege silent, replay와 rollback을 실제 MariaDB에서 검증합니다.
async function main() {
  const request = { environmentCode: "dev" as const, providerEventId: "minipet-collection-probe-v1", viewerExternalUserId: "synthetic-non-admin-gamma" };
  const first = await service.readLatestCollection(request);
  const replay = await service.readLatestCollection(request);
  assert.equal(first.poolVersion, "collection-v1");
  assert.deepEqual(first.collectionGrades.map((row) => row.grade), ["창조", "창세", "태초+", "태초", "초월+", "초월", "신화+", "신화"]);
  assert.equal(first.collectionRepairRequired, true);
  assert.deepEqual(replay.collection, first.collection);
  assert.match(formatMiniPetCollection(first), /컬렉션 성장 보상/);
  const repairRows = await database.query<Array<{ stage: number }>>(`SELECT projection.stage FROM mini_pet_collection_projections projection
    JOIN mini_pet_definitions definition ON definition.id = projection.mini_pet_definition_id
    WHERE projection.player_id = 900000003 AND definition.grade_display_name = '신화'`);
  assert.equal(repairRows[0]?.stage, 0);

  const empty = await service.readLatestCollection({ environmentCode: "dev", providerEventId: "minipet-collection-empty-v1", viewerExternalUserId: "synthetic-user-beta-kakao" });
  assert.equal(empty.collection.length, 8);
  assert.equal(empty.collection.every((item) => item.stage === 1 && !item.registered), true);
  const emptyStored = await database.query<Array<{ count: bigint }>>(`SELECT COUNT(*) count FROM mini_pet_collection_projections projection
    JOIN mini_pet_definitions definition ON definition.id = projection.mini_pet_definition_id
    WHERE projection.player_id = 900000002 AND definition.code LIKE 'mini_pet_collection_%'`);
  assert.equal(Number(emptyStored[0]?.count), 0);

  await database.execute("UPDATE castle_battle_seasons SET status = 'active' WHERE id = 900000001");
  await assert.rejects(service.readLatestCollection({ ...request, providerEventId: "siege-silent" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_COLLECTION_SIEGE_SILENT");
  await database.execute("UPDATE castle_battle_seasons SET status = 'completed' WHERE id = 900000001");
  const afterReplay = await counts();
  assert.equal(Number(afterReplay.operations), 1);

  await database.execute("DROP TRIGGER IF EXISTS synthetic_fail_minipet_collection_audit");
  await database.execute(`CREATE TRIGGER synthetic_fail_minipet_collection_audit BEFORE INSERT ON command_audit
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic collection rollback'`);
  await assert.rejects(service.readLatestCollection({ ...request, providerEventId: "minipet-collection-rollback-v1" }));
  await database.execute("DROP TRIGGER synthetic_fail_minipet_collection_audit");
  assert.deepEqual(await counts(), afterReplay);
  const recovery = await service.readLatestCollection({ ...request, providerEventId: "minipet-collection-recovery-v1" });
  assert.equal(recovery.collectionGrades.length, 8);
  console.log(JSON.stringify({ poolVersion: recovery.poolVersion, grades: recovery.collectionGrades,
    missingUnsaved: true, repairReadOnly: true, siegeSilent: true, replay: true, rollback: true, effectsAfterRecovery: await counts() },
  (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
