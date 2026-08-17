import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { FurnitureBoutiqueBoxCraftService } from "../src/crafting/furniture-boutique-box-craft-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic furniture-boutique-box craft probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = process.env.FURNITURE_BOUTIQUE_BOX_CRAFT_PROBE_EVENT_ID
  ?? `boutique-box-craft-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const replayOnly = process.env.FURNITURE_BOUTIQUE_BOX_CRAFT_PROBE_REPLAY_ONLY === "true";
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  if (!replayOnly) await database.withTransaction(async (transaction) => {
    await transaction.execute(
      `INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES
        ('legacy-pet-home-interior-shop-ticket', '펫스윗홈인테리어샵🖼️(/샵오픈)', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE, 'wbsId', 'CMD-06-0043'), TRUE, 1),
        ('legacy-furniture-boutique-box', '가구 부띠끄상자🧳(/부띠끄오픈)', 'consumable', TRUE, JSON_OBJECT('synthetic', TRUE, 'wbsId', 'CMD-06-0043'), TRUE, 1)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), metadata_json = VALUES(metadata_json), active = TRUE`
    );
    const definitions = await transaction.query<Array<{ id: bigint; code: string }>>(
      "SELECT id, code FROM item_definitions WHERE code IN ('legacy-pet-home-interior-shop-ticket', 'legacy-furniture-boutique-box') ORDER BY code"
    );
    for (const definition of definitions) {
      const quantity = definition.code === "legacy-pet-home-interior-shop-ticket" ? 10000 : 1;
      await transaction.execute(
        "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (900000001, ?, ?, 1) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = version + 1",
        [definition.id, quantity]
      );
    }
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

  const service = new FurnitureBoutiqueBoxCraftService(database);
  const command = { externalUserId, channelId, message: "/부띠끄조합 2", eventId };
  const result = await service.handle(command);
  assert.deepEqual(await service.handle(command), result);
  assert.deepEqual(
    { status: result.status, count: result.craftQuantity, shop: result.shopTicketQuantity, box: result.boutiqueBoxQuantity },
    { status: "crafted", count: "2", shop: "0", box: "3" }
  );
  assert.equal(result.data, "2개를 조합합니다\n[테스트알파] 님\n가구 부띠끄상자🧳(/부띠끄오픈) 2개 생성 완료! 🧳✨");

  const rows = await database.query<Array<{
    shop_quantity: bigint;
    box_quantity: bigint;
    inventory_ledger_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT
       MAX(CASE WHEN item.code = 'legacy-pet-home-interior-shop-ticket' THEN stack.quantity END) AS shop_quantity,
       MAX(CASE WHEN item.code = 'legacy-furniture-boutique-box' THEN stack.quantity END) AS box_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'craft.furniture-boutique-box:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'craft.furniture-boutique-box:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'furniture_boutique_box_craft') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'craft.furniture-boutique-box:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'craft.furniture-boutique-box:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001 AND item.code IN ('legacy-pet-home-interior-shop-ticket', 'legacy-furniture-boutique-box')`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    shop_quantity: 0n,
    box_quantity: 3n,
    inventory_ledger_count: 2n,
    operation_count: 1n,
    execution_count: 1n,
    audit_count: 1n,
    outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name,
    playerId: result.playerId,
    balances: { shopTicket: result.shopTicketQuantity, boutiqueBox: result.boutiqueBoxQuantity },
    effects: { inventoryLedger: 2, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true,
    restartReplay: replayOnly,
    temporaryDefinitions: ["legacy-pet-home-interior-shop-ticket", "legacy-furniture-boutique-box"],
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
