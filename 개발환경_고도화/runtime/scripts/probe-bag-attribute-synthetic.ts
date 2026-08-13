import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { BagAttributeService } from "../src/inventory/bag-attribute-service.js";
import { MariaBagAttributeRepository } from "../src/inventory/maria-bag-attribute-repository.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic bag-attribute probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const runKey = randomUUID().replaceAll("-", "").slice(0, 12);
const eventId = `bag-attribute-${runKey}`;
const command = {
  externalUserId: "synthetic-admin-alpha",
  channelId: "synthetic-room-001",
  message: "/가방속성 테스트알파 1 7",
  eventId
};

try {
  await database.execute(
    `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
        SET stack.quantity = 20, stack.version = stack.version + 1
      WHERE stack.player_id = 900000001 AND item.code = 'legacy-junk-item'`
  );
  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
       external_user_id, external_identity_id, event_kind, event_origin, direction,
       payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, 'synthetic-room-001', 900000001, 'synthetic-admin-alpha', 900000004,
       'message', 'synthetic_probe', 'incoming', REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId]
  );

  const service = new BagAttributeService(new MariaBagAttributeRepository(database));
  const result = await service.handle(command);
  const replay = await service.handle(command);
  assert.deepEqual(replay, result);
  assert.equal(result.status, "changed");
  assert.equal(result.itemCode, "legacy-junk-item");
  assert.equal(result.quantity, "7");
  assert.equal(result.quantityDelta, "-13");
  assert.equal(result.data, "[테스트알파] 님의 가방에서 잡템☠️의 수량이 7개로 변경되었습니다.");

  const rows = await database.query<Array<{
    quantity: bigint;
    ledger_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT stack.quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'inventory.bag_attribute:900000001'
           AND operation_row.idempotency_key = ? AND ledger.quantity_delta = -13) AS ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'inventory.bag_attribute:900000001' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'bag_attribute') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'inventory.bag_attribute:900000001' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'inventory.bag_attribute:900000001' AND operation_row.idempotency_key = ?) AS outbox_count
       FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
      WHERE stack.player_id = 900000001 AND item.code = 'legacy-junk-item'`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    quantity: 7n, ledger_count: 1n, operation_count: 1n,
    execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });
  process.stdout.write(`${JSON.stringify({
    database: config.database.name,
    playerId: result.playerId,
    itemCode: result.itemCode,
    quantity: result.quantity,
    effects: { ledger: 1, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true,
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
