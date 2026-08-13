import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { RandomBoxCraftService } from "../src/crafting/random-box-craft-service.js";

const HEART_ITEM_ID = 906003301n;
const RANDOM_BOX_ITEM_ID = 906003302n;
const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic random-box craft probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = `random-box-craft-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  await database.withTransaction(async (transaction) => {
    await transaction.execute(
      `INSERT INTO item_definitions (id, code, display_name, asset_type_code, stackable, metadata_json, active, version)
       VALUES (?, 'legacy-heart', '하트💝', 'material', TRUE, JSON_OBJECT('synthetic', TRUE, 'wbsId', 'CMD-06-0033'), TRUE, 1),
              (?, 'legacy-random-box', '랜덤박스💝', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE, 'wbsId', 'CMD-06-0033'), TRUE, 1)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), metadata_json = VALUES(metadata_json), active = TRUE`,
      [HEART_ITEM_ID, RANDOM_BOX_ITEM_ID]
    );
    await transaction.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       VALUES (900000001, ?, 40, 1), (900000001, ?, 0, 1)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = version + 1`,
      [HEART_ITEM_ID, RANDOM_BOX_ITEM_ID]
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

  const service = new RandomBoxCraftService(database);
  const command = { externalUserId, channelId, message: "/랜덤조합 2", eventId };
  const result = await service.handle(command);
  assert.deepEqual(await service.handle(command), result);
  assert.deepEqual(
    { status: result.status, count: result.craftQuantity, heart: result.heartQuantity, box: result.boxQuantity },
    { status: "crafted", count: "2", heart: "0", box: "2" }
  );
  assert.equal(result.data, "[테스트알파] 아조씨 사랑해요..💝\n랜덤박스💝 2개를 획득하셨습니다.");

  const rows = await database.query<Array<{
    heart_quantity: bigint; box_quantity: bigint; inventory_ledger_count: bigint;
    operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT
       MAX(CASE WHEN item.code = 'legacy-heart' THEN stack.quantity END) AS heart_quantity,
       MAX(CASE WHEN item.code = 'legacy-random-box' THEN stack.quantity END) AS box_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'craft.random-box:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'craft.random-box:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'random_box_craft') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'craft.random-box:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'craft.random-box:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM inventory_stacks stack
     JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001 AND item.code IN ('legacy-heart', 'legacy-random-box')`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    heart_quantity: 0n, box_quantity: 2n, inventory_ledger_count: 2n,
    operation_count: 1n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, playerId: result.playerId,
    balances: { heart: result.heartQuantity, randomBox: result.boxQuantity },
    effects: { inventoryLedger: 2, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true, operationalSnapshotTouched: false, sharedFixtureTouched: false
  })}\n`);
} finally {
  await database.close();
}
