import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { SpiritCombineService } from "../src/crafting/spirit-combine-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic spirit-combine probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const verifyRestart = process.argv.includes("--verify-restart");
const eventId = process.env.SPIRIT_COMBINE_EVENT_ID ?? `spirit-combine-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  if (!verifyRestart) {
    await database.withTransaction(async (transaction) => {
      await transaction.execute(
        `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
         SET stack.quantity = CASE item.code WHEN 'bag_9b3e69dbd2e91260' THEN 20 WHEN 'bag_55b34cbde0088b29' THEN 5 END,
             stack.version = stack.version + 1
         WHERE stack.player_id = 900000001 AND item.code IN ('bag_9b3e69dbd2e91260', 'bag_55b34cbde0088b29')`
      );
      await transaction.execute(
        `INSERT INTO event_inbox
          (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
           external_user_id, external_identity_id, event_kind, event_origin, direction,
           payload_hash, parse_status, processing_status, received_at)
         VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
           REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
        [eventId, eventId, channelId, externalUserId]
      );
    });
  } else if (process.env.SPIRIT_COMBINE_EVENT_ID === undefined) {
    throw new Error("SPIRIT_COMBINE_EVENT_ID is required with --verify-restart.");
  }

  const service = new SpiritCombineService(database);
  const command = { externalUserId, channelId, message: "/정령조합 2", eventId };
  const result = await service.handle(command);
  assert.deepEqual(await service.handle(command), result);
  assert.deepEqual(
    { status: result.status, count: result.craftQuantity, fragments: result.fragmentQuantity, stones: result.stoneQuantity },
    { status: "crafted", count: "2", fragments: "0", stones: "7" }
  );
  assert.equal(result.data, "2개를 조합합니다\n[테스트알파] 님\n정령 강화석🥀 조합 2개 완성");

  const rows = await database.query<Array<{
    fragment_quantity: bigint; stone_quantity: bigint; inventory_ledger_count: bigint;
    operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT
       MAX(CASE WHEN item.code = 'bag_9b3e69dbd2e91260' THEN stack.quantity END) AS fragment_quantity,
       MAX(CASE WHEN item.code = 'bag_55b34cbde0088b29' THEN stack.quantity END) AS stone_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'craft.spirit-combine:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'spirit_combine') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001 AND item.code IN ('bag_9b3e69dbd2e91260', 'bag_55b34cbde0088b29')`
    , [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    fragment_quantity: 0n, stone_quantity: 7n, inventory_ledger_count: 2n,
    operation_count: 1n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    mode: verifyRestart ? "verify-restart" : "apply", database: config.database.name, eventId, playerId: result.playerId,
    balances: { fragments: result.fragmentQuantity, stones: result.stoneQuantity },
    effects: { inventoryLedger: 2, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
