import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetEquippedRank } from "../src/mini-pet/equipped-rank-read-command.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";
import { ApplicationError } from "../src/shared/application-error.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");
const scope = "mini-pet.public.read:equipped_rank";

// 이 슬라이스가 만든 operation과 effect 수를 집계합니다.
async function counts() {
  const rows = await database.query<Array<Record<string, bigint>>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ?) operations,
      (SELECT COUNT(*) FROM mini_pet_read_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = ?) executions,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = ?) audits,
      (SELECT COUNT(*) FROM command_executions execution JOIN operations operation ON operation.id = execution.operation_id WHERE operation.idempotency_scope = ?) commands`,
    [scope, scope, scope, scope]
  );
  return rows[0]!;
}

// snapshot pin, stable tie, replay, mismatch와 강제 rollback을 실제 MariaDB에서 검증합니다.
async function main() {
  const first = await service.readLatestEquippedRank({ environmentCode: "dev", providerEventId: "minipet-rank-probe-v1" });
  const replay = await service.readLatestEquippedRank({ environmentCode: "dev", providerEventId: "minipet-rank-probe-v1" });
  assert.equal(first.poolVersion, "equipped-rank-v1");
  assert.deepEqual(first.owned.map((item) => item.ownedId), ["900000001", "900000021", "900000031"]);
  assert.deepEqual(replay.owned, first.owned);
  assert.match(formatMiniPetEquippedRank(first.owned), /1위\. 🧪테스트알파/);
  await assert.rejects(
    service.read({ projectionCode: "equipped_rank", environmentCode: "dev", poolVersion: "different-version",
      snapshotAt: "2026-08-25T02:00:00.000Z", providerEventId: "minipet-rank-probe-v1" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_REPLAY_MISMATCH"
  );
  const afterReplay = await counts();
  assert.equal(Number(afterReplay.operations), 1);
  assert.equal(Number(afterReplay.executions), 1);
  assert.equal(Number(afterReplay.audits), 1);
  assert.equal(Number(afterReplay.commands), 1);

  await database.execute("DROP TRIGGER IF EXISTS synthetic_fail_minipet_rank_audit");
  await database.execute(`CREATE TRIGGER synthetic_fail_minipet_rank_audit BEFORE INSERT ON command_audit
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic rank rollback'`);
  await assert.rejects(service.readLatestEquippedRank({ environmentCode: "dev", providerEventId: "minipet-rank-rollback-v1" }));
  await database.execute("DROP TRIGGER synthetic_fail_minipet_rank_audit");
  const afterRollback = await counts();
  assert.deepEqual(afterRollback, afterReplay);

  const recovery = await service.readLatestEquippedRank({ environmentCode: "dev", providerEventId: "minipet-rank-recovery-v1" });
  assert.equal(recovery.owned.length, 3);
  console.log(JSON.stringify({ poolVersion: first.poolVersion, ownedSnapshotVersion: first.ownedSnapshotVersion,
    stableOrder: first.owned.map((item) => item.ownedId), replay: true, rollback: true,
    effectsAfterRecovery: await counts() }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
