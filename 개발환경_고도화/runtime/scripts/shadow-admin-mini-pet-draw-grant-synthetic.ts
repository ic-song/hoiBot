import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { AdminDrawGrantService } from "../src/mini-pet/admin-draw-grant-service.js";
import { MariaAdminDrawGrantRepository } from "../src/mini-pet/maria-admin-draw-grant-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new AdminDrawGrantService(new MariaAdminDrawGrantRepository(database));

try {
  const replay = await service.handle({ externalUserId: "synthetic-admin-alpha", actorDisplayName: "호이 남",
    channelId: "synthetic-room-001", message: "/부방상여", eventId: "admin-minipet-draw-grant-rollback-v1" });
  assert.equal(replay.status, "granted");
  assert.deepEqual(replay.recipients?.map((row) => row.quantity), ["2010", "2020"]);
  const rows = await database.query<Array<{ operations: bigint; inventory: bigint; adjustments: bigint; audits: bigint; commands: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.minipet_draw_grant:%') operations,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id = ledger.operation_id WHERE operation.idempotency_scope LIKE 'admin.minipet_draw_grant:%') inventory,
      (SELECT COUNT(*) FROM admin_adjustment_ledger ledger JOIN operations operation ON operation.id = ledger.operation_id WHERE operation.idempotency_scope LIKE 'admin.minipet_draw_grant:%') adjustments,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope LIKE 'admin.minipet_draw_grant:%') audits,
      (SELECT COUNT(*) FROM command_executions WHERE command_code = 'admin_minipet_draw_grant') commands`
  );
  const row = rows[0]!;
  const effects = { operations: row.operations.toString(), inventory: row.inventory.toString(), adjustments: row.adjustments.toString(), audits: row.audits.toString(), commands: row.commands.toString() };
  assert.deepEqual(effects, { operations: "2", inventory: "4", adjustments: "4", audits: "2", commands: "2" });
  console.log(JSON.stringify({ shadow: "PASS", recipients: replay.recipients, fixedQuantity: "1000", effects }));
} finally {
  await database.close();
}
