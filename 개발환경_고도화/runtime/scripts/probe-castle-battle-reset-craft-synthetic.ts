import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { CastleBattleResetCraftService } from "../src/castle/castle-battle-reset-craft-service.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic castle-battle-reset craft probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = process.env.CASTLE_BATTLE_RESET_CRAFT_PROBE_EVENT_ID
  ?? `castle-battle-reset-craft-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const replayOnly = process.env.CASTLE_BATTLE_RESET_CRAFT_PROBE_REPLAY_ONLY === "true";
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  if (!replayOnly) await database.withTransaction(async (transaction) => {
    await transaction.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       SET stack.quantity = CASE item.code WHEN 'legacy-seasoned-chicken' THEN 12 WHEN 'legacy-castle-battle-reset-ticket' THEN 0 END,
           stack.version = stack.version + 1
       WHERE stack.player_id = 900000001 AND item.code IN ('legacy-seasoned-chicken', 'legacy-castle-battle-reset-ticket')`
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

  const service = new CastleBattleResetCraftService(database);
  const command = { externalUserId, channelId, message: "/캐슬대전조합 2", eventId };
  const result = await service.handle(command);
  const replay = await service.handle(command);
  assert.deepEqual(replay, result);
  assert.deepEqual(
    { status: result.status, count: result.craftQuantity, chicken: result.chickenQuantity, ticket: result.ticketQuantity },
    { status: "crafted", count: "2", chicken: "0", ticket: "2" }
  );
  assert.equal(result.data, "캐슬대전리셋권🐶 2개가 완성되었습니다!\n/캐슬대전 으로 대전에 참여하세요!");

  const rows = await database.query<Array<{
    chicken_quantity: bigint;
    ticket_quantity: bigint;
    inventory_ledger_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT
       MAX(CASE WHEN item.code = 'legacy-seasoned-chicken' THEN stack.quantity END) AS chicken_quantity,
       MAX(CASE WHEN item.code = 'legacy-castle-battle-reset-ticket' THEN stack.quantity END) AS ticket_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'castle.battle-reset.craft:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'castle.battle-reset.craft:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'castle_battle_reset_craft') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'castle.battle-reset.craft:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'castle.battle-reset.craft:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM inventory_stacks stack
     JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001
       AND item.code IN ('legacy-seasoned-chicken', 'legacy-castle-battle-reset-ticket')`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    chicken_quantity: 0n, ticket_quantity: 2n, inventory_ledger_count: 2n,
    operation_count: 1n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, playerId: result.playerId,
    balances: { chicken: result.chickenQuantity, ticket: result.ticketQuantity },
    effects: { inventoryLedger: 2, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true, restartReplay: replayOnly, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
