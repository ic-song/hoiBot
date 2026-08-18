import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { CollectionGenesisOpenService } from "../src/mini-pet/collection-genesis-open-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic collection genesis open probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = "collection-genesis-open-58lpev";
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const prepare = process.argv.includes("--prepare");

try {
  if (prepare) {
    await database.withTransaction(async (transaction) => {
      await transaction.execute(
        `DELETE owned FROM owned_mini_pets owned
         JOIN mini_pet_definitions definition_row ON definition_row.id = owned.mini_pet_definition_id
         WHERE owned.player_id = 900000001 AND owned.equipped = FALSE
           AND definition_row.code = 'mini_pet_83a8d8d4c759c2a6'`
      );
      await transaction.execute(
        `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
         SELECT 900000001, id, CASE code WHEN 'bag_b2fd551a03f6fe6e' THEN 1 ELSE 0 END, 1
         FROM item_definitions WHERE code IN ('bag_b2fd551a03f6fe6e', 'bag_3241894752b82f7a')
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), inventory_stacks.version = inventory_stacks.version + 1`
      );
      await transaction.execute(
        `INSERT INTO event_inbox
          (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
           external_user_id, external_identity_id, event_kind, event_origin, direction,
           payload_hash, parse_status, processing_status, received_at)
         VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
           REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
        [eventId, eventId, channelId, externalUserId]
      );
    });
  }

  const service = new CollectionGenesisOpenService(database);
  const command = { externalUserId, channelId, message: "/컬렉션창세오픈", eventId };
  const result = await service.handle(command);
  assert.deepEqual(await service.handle(command), result);
  assert.deepEqual(
    { status: result.status, package: result.packageQuantity, ticket: result.ticketQuantity },
    { status: "opened", package: "0", ticket: "1500" }
  );
  assert.equal(result.data, "🐹 컬렉션창세패키지 오픈 완료!\n\n🎁 지급: [컬렉션창세 미니펫🐹] (창세 / 매력+1💕)\n🎟️ 추가지급: 미니펫뽑기🐹(/미니펫오픈) 1500개\n\n👉 /미니펫가방 으로 확인해주세요.");

  const rows = await database.query<Array<{
    package_quantity: bigint;
    ticket_quantity: bigint;
    mini_pet_count: bigint;
    inventory_ledger_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT
       MAX(CASE WHEN item.code = 'bag_b2fd551a03f6fe6e' THEN stack.quantity END) AS package_quantity,
       MAX(CASE WHEN item.code = 'bag_3241894752b82f7a' THEN stack.quantity END) AS ticket_quantity,
       (SELECT COUNT(*) FROM owned_mini_pets owned JOIN mini_pet_definitions definition_row
         ON definition_row.id = owned.mini_pet_definition_id
         WHERE owned.player_id = 900000001 AND owned.equipped = FALSE
           AND definition_row.code = 'mini_pet_83a8d8d4c759c2a6') AS mini_pet_count,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'mini-pet.collection-genesis-open:900000004'
           AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.collection-genesis-open:900000004'
         AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'collection_genesis_open') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'mini-pet.collection-genesis-open:900000004'
           AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'mini-pet.collection-genesis-open:900000004'
           AND operation_row.idempotency_key = ?) AS outbox_count
     FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001
       AND item.code IN ('bag_b2fd551a03f6fe6e', 'bag_3241894752b82f7a')`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  const row = rows[0]!;
  assert.deepEqual({
    inventory_ledger_count: row.inventory_ledger_count,
    operation_count: row.operation_count,
    execution_count: row.execution_count,
    audit_count: row.audit_count,
    outbox_count: row.outbox_count
  }, {
    inventory_ledger_count: 2n,
    operation_count: 1n,
    execution_count: 1n,
    audit_count: 1n,
    outbox_count: 1n
  });
  if (prepare) {
    assert.deepEqual({
      package_quantity: row.package_quantity,
      ticket_quantity: row.ticket_quantity,
      mini_pet_count: row.mini_pet_count
    }, { package_quantity: 0n, ticket_quantity: 1500n, mini_pet_count: 1n });
  } else {
    assert.equal(row.package_quantity, 0n);
    assert.ok(row.mini_pet_count >= 1n);
  }

  process.stdout.write(`${JSON.stringify({
    database: config.database.name,
    playerId: result.playerId,
    balances: { package: result.packageQuantity, ticket: result.ticketQuantity, miniPet: "1" },
    effects: { inventoryLedger: 2, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true,
    restartSafeReplay: !prepare,
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
