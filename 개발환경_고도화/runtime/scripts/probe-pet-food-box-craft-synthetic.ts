import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { PetFoodBoxCraftService } from "../src/crafting/pet-food-box-craft-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet-food-box craft probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = process.env.PET_FOOD_BOX_CRAFT_PROBE_EVENT_ID
  ?? `pet-food-box-craft-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const replayOnly = process.env.PET_FOOD_BOX_CRAFT_PROBE_REPLAY_ONLY === "true";
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  if (!replayOnly) await database.withTransaction(async (transaction) => {
    await transaction.execute("UPDATE currency_accounts SET balance = 50000000, version = version + 1 WHERE player_id = 900000001 AND currency_code = 'point'");
    await transaction.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       SET stack.quantity = CASE item.code WHEN 'legacy-junk-item' THEN 600 WHEN 'legacy-pet-food-box' THEN 0 END,
           stack.version = stack.version + 1
       WHERE stack.player_id = 900000001 AND item.code IN ('legacy-junk-item', 'legacy-pet-food-box')`
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

  const service = new PetFoodBoxCraftService(database);
  const command = { externalUserId, channelId, message: "/펫먹이조합 2", eventId };
  const result = await service.handle(command);
  assert.deepEqual(await service.handle(command), result);
  assert.deepEqual(
    { status: result.status, count: result.craftQuantity, junk: result.junkQuantity, point: result.pointBalance, box: result.boxQuantity },
    { status: "crafted", count: "2", junk: "0", point: "0", box: "2" }
  );
  assert.equal(result.data, "[테스트알파] 님\n펫먹이상자📦(/상자오픈) 2개 조합이 완료되었습니다!\n(/상자오픈)");

  const rows = await database.query<Array<{
    point_balance: string; junk_quantity: bigint; box_quantity: bigint; inventory_ledger_count: bigint;
    currency_ledger_count: bigint; operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT CAST(account.balance AS CHAR) AS point_balance,
       MAX(CASE WHEN item.code = 'legacy-junk-item' THEN stack.quantity END) AS junk_quantity,
       MAX(CASE WHEN item.code = 'legacy-pet-food-box' THEN stack.quantity END) AS box_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'craft.pet-food-box:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'craft.pet-food-box:900000004' AND operation_row.idempotency_key = ?) AS currency_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'craft.pet-food-box:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'pet_food_box_craft') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'craft.pet-food-box:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'craft.pet-food-box:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM currency_accounts account
     JOIN inventory_stacks stack ON stack.player_id = account.player_id
     JOIN item_definitions item ON item.id = stack.item_id
     WHERE account.player_id = 900000001 AND account.currency_code = 'point'
       AND item.code IN ('legacy-junk-item', 'legacy-pet-food-box')
     GROUP BY account.balance`,
    [eventId, eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    point_balance: "0.000", junk_quantity: 0n, box_quantity: 2n,
    inventory_ledger_count: 2n, currency_ledger_count: 1n, operation_count: 1n,
    execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, playerId: result.playerId,
    balances: { junk: result.junkQuantity, point: result.pointBalance, box: result.boxQuantity },
    effects: { inventoryLedger: 2, currencyLedger: 1, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true, restartReplay: replayOnly, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
