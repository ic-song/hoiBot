import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCatalogProjectionService } from "../src/mini-pet/catalog-projection-service.js";
import { formatMiniPetAdminInfo } from "../src/mini-pet/admin-info-read-command.js";
import { MariaMiniPetCatalogProjectionRepository } from "../src/mini-pet/maria-catalog-projection-repository.js";
import { ApplicationError } from "../src/shared/application-error.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCatalogProjectionService(new MariaMiniPetCatalogProjectionRepository(database), "dev");
const scope = "mini-pet.read:admin_info:900000004";

// 관리자 정보 조회가 만든 operation과 감사 원장을 집계합니다.
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

// RBAC, trusted identity, 허용방, allowlist, replay와 rollback을 실제 MariaDB에서 검증합니다.
async function main() {
  const request = { environmentCode: "dev" as const, providerEventId: "minipet-admin-probe-v1",
    viewerExternalUserId: "synthetic-admin-alpha", requestChannelId: "synthetic-room-001", targetName: "테스트베타" };
  const first = await service.readLatestAdminInfo(request);
  const replay = await service.readLatestAdminInfo(request);
  assert.equal(first.targetDisplayName, "테스트베타");
  assert.deepEqual(Object.keys(first.adminLegacySnapshot ?? {}).sort(), ["bag", "battle", "collection", "draw", "equipped", "profile"]);
  assert.deepEqual(replay.adminLegacySnapshot, first.adminLegacySnapshot);
  assert.match(formatMiniPetAdminInfo(first), /🔎 테스트베타님의 미니펫 정보/);
  await assert.rejects(service.readLatestAdminInfo({ ...request, providerEventId: "denied-user", viewerExternalUserId: "synthetic-non-admin-gamma" }),
    (error: unknown) => error instanceof ApplicationError && error.statusCode === 403);
  await assert.rejects(service.readLatestAdminInfo({ ...request, providerEventId: "denied-room", requestChannelId: "synthetic-room-denied" }),
    (error: unknown) => error instanceof ApplicationError && error.statusCode === 403);
  await assert.rejects(service.readLatestAdminInfo({ ...request, providerEventId: "self-target", targetName: "테스트알파" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_ADMIN_SELF_TARGET");
  await assert.rejects(service.readLatestAdminInfo({ ...request, providerEventId: "missing-target", targetName: "없는대상" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "MINIPET_ADMIN_TARGET_NOT_FOUND");
  const afterReplay = await counts();
  assert.equal(Number(afterReplay.operations), 1);

  await database.execute("DROP TRIGGER IF EXISTS synthetic_fail_minipet_admin_audit");
  await database.execute(`CREATE TRIGGER synthetic_fail_minipet_admin_audit BEFORE INSERT ON command_audit
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic admin rollback'`);
  await assert.rejects(service.readLatestAdminInfo({ ...request, providerEventId: "minipet-admin-rollback-v1" }));
  await database.execute("DROP TRIGGER synthetic_fail_minipet_admin_audit");
  assert.deepEqual(await counts(), afterReplay);

  const recovery = await service.readLatestAdminInfo({ ...request, providerEventId: "minipet-admin-recovery-v1" });
  assert.equal(recovery.adminLegacySnapshot?.profile, "칭호: 합성 베타\n매력: 12");
  console.log(JSON.stringify({ target: recovery.targetDisplayName, allowedFields: Object.keys(recovery.adminLegacySnapshot ?? {}),
    rbac: true, trustedIdentity: true, allowedChannel: true, replay: true, rollback: true, effectsAfterRecovery: await counts() },
  (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
