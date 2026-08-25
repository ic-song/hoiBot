import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { AdminDrawGrantService } from "../src/mini-pet/admin-draw-grant-service.js";
import { MariaAdminDrawGrantRepository } from "../src/mini-pet/maria-admin-draw-grant-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new AdminDrawGrantService(new MariaAdminDrawGrantRepository(database));
const base = { externalUserId: "synthetic-admin-alpha", actorDisplayName: "호이 남", channelId: "synthetic-room-001", message: "/부방상여" };

async function quantities() {
  return database.query<Array<{ player_id: bigint; quantity: bigint }>>(
    `SELECT stack.player_id, stack.quantity FROM inventory_stacks stack
     JOIN item_definitions item ON item.id = stack.item_id
     WHERE item.code = 'bag_3241894752b82f7a' AND stack.player_id IN (900000001, 900000002)
     ORDER BY stack.player_id`
  );
}

try {
  const first = await service.handle({ ...base, eventId: "admin-minipet-draw-grant-probe-v1" });
  const replay = await service.handle({ ...base, eventId: "admin-minipet-draw-grant-probe-v1" });
  assert.equal(first.status, "granted");
  assert.deepEqual(first.recipients?.map((row) => [row.displayName, row.quantity]), [["테스트알파", "1010"], ["테스트베타", "1020"]]);
  assert.deepEqual(replay, first);
  assert.deepEqual((await quantities()).map((row) => row.quantity.toString()), ["1010", "1020"]);

  await assert.rejects(service.handle({ ...base, eventId: "admin-minipet-draw-grant-rollback-v1" }));
  assert.deepEqual((await quantities()).map((row) => row.quantity.toString()), ["1010", "1020"]);
  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_code, provider_event_id, event_kind, processing_status, received_at, processed_at, attempt_count)
     VALUES ('admin-minipet-draw-grant-rollback-v1', 'iris', 'admin-minipet-draw-grant-rollback-v1', 'message', 'processed',
       '2026-08-25 05:01:00.000', '2026-08-25 05:01:00.000', 1)`
  );
  const recovery = await service.handle({ ...base, eventId: "admin-minipet-draw-grant-rollback-v1" });
  assert.deepEqual(recovery.recipients?.map((row) => row.quantity), ["2010", "2020"]);

  const rows = await database.query<Array<{ operations: bigint; inventory: bigint; adjustments: bigint; audits: bigint; commands: bigint; outbox: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.minipet_draw_grant:%') operations,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id = ledger.operation_id WHERE operation.idempotency_scope LIKE 'admin.minipet_draw_grant:%') inventory,
      (SELECT COUNT(*) FROM admin_adjustment_ledger ledger JOIN operations operation ON operation.id = ledger.operation_id WHERE operation.idempotency_scope LIKE 'admin.minipet_draw_grant:%') adjustments,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope LIKE 'admin.minipet_draw_grant:%') audits,
      (SELECT COUNT(*) FROM command_executions WHERE command_code = 'admin_minipet_draw_grant') commands,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id = outbox.operation_id WHERE operation.idempotency_scope LIKE 'admin.minipet_draw_grant:%') outbox`
  );
  const row = rows[0]!;
  const effects = { operations: row.operations.toString(), inventory: row.inventory.toString(), adjustments: row.adjustments.toString(),
    audits: row.audits.toString(), commands: row.commands.toString(), outbox: row.outbox.toString() };
  assert.deepEqual(effects, { operations: "2", inventory: "4", adjustments: "4", audits: "2", commands: "2", outbox: "2" });
  console.log(JSON.stringify({ recipients: recovery.recipients, fixedQuantity: "1000", targetOrder: true,
    replay: true, rollback: true, batchAtomic: true, effects }));
} finally {
  await database.close();
}
