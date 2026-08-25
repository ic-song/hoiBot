import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GetBagService } from "../src/inventory/get-bag-service.js";
import { MariaBagRepository } from "../src/inventory/maria-bag-repository.js";
import { BagSellService } from "../src/inventory/bag-sell-service.js";
import { MariaBagSellRepository } from "../src/inventory/maria-bag-sell-repository.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error("Synthetic bag-sell probe is blocked for database: " + config.database.name);
}

const database = createDatabaseClient(config.database);
const runKey = randomUUID().replaceAll("-", "").slice(0, 12);

async function insertEvent(eventId: string): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
       external_user_id, external_identity_id, event_kind, event_origin, direction,
       payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, 'synthetic-room-001', 900000001, 'synthetic-user-alpha', 900000001,
       'message', 'synthetic_probe', 'incoming', REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId]
  );
}

try {
  const bagService = new GetBagService(new MariaBagRepository(database));
  const sellService = new BagSellService(new MariaBagSellRepository(database));
  const bag = await bagService.execute("synthetic", "synthetic-user-alpha");
  assert.ok(bag.snapshotId);
  const displaySeq = bag.items.findIndex((item) => item.itemCode === "bag_sell_test") + 1;
  assert.ok(displaySeq > 0);
  const eventId = "bag-sell-" + runKey;
  await insertEvent(eventId);
  const command = {
    providerCode: "synthetic",
    externalUserId: "synthetic-user-alpha",
    channelId: "synthetic-room-001",
    eventId,
    message: "/판매 " + displaySeq + " 2"
  };
  const sold = await sellService.execute(command);
  const replay = await sellService.execute(command);
  assert.equal(sold.status, "sold");
  assert.equal(sold.definitionId, bag.items[displaySeq - 1]?.definitionId);
  assert.equal(sold.catalogObjectKey, "item.bag_sell_test");
  assert.equal(sold.quantity, "2");
  assert.equal(sold.pointDelta, "200000");
  assert.equal(replay.operationId, sold.operationId);
  assert.equal(replay.replayed, true);

  const latest = await bagService.execute("synthetic", "synthetic-user-alpha");
  const staleSeq = latest.items.findIndex((item) => item.itemCode === "bag_sell_test") + 1;
  await database.execute(
    `UPDATE inventory_stacks stack
        JOIN item_definitions item ON item.id = stack.item_id
        SET stack.quantity = stack.quantity + 1, stack.version = stack.version + 1
      WHERE stack.player_id = 900000001 AND item.code = 'bag_sell_test'`
  );
  const staleEvent = "bag-sell-stale-" + runKey;
  await insertEvent(staleEvent);
  const stale = await sellService.execute({
    ...command,
    eventId: staleEvent,
    message: "/판매 " + staleSeq + " 1"
  });
  assert.equal(stale.status, "stale_snapshot");

  const beforeRollback = await database.query<Array<{ quantity: bigint }>>(
    `SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
      WHERE stack.player_id=900000001 AND item.code='bag_sell_test'`
  );
  await assert.rejects(database.withTransaction(async (transaction) => {
    await transaction.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
        SET stack.quantity=stack.quantity-1, stack.version=stack.version+1
        WHERE stack.player_id=900000001 AND item.code='bag_sell_test'`
    );
    throw new Error("synthetic rollback");
  }));
  const afterRollback = await database.query<Array<{ quantity: bigint }>>(
    `SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
      WHERE stack.player_id=900000001 AND item.code='bag_sell_test'`
  );
  assert.equal(afterRollback[0]?.quantity, beforeRollback[0]?.quantity);

  const effects = await database.query<Array<{
    operations: bigint;
    inventory_ledgers: bigint;
    currency_ledgers: bigint;
    audits: bigint;
    outbox: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='inventory.bag_sell:900000001') operations,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') inventory_ledgers,
      (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') currency_ledgers,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') outbox`
  );
  assert.deepEqual(effects[0], {
    operations: 1n,
    inventory_ledgers: 1n,
    currency_ledgers: 1n,
    audits: 1n,
    outbox: 1n
  });
  process.stdout.write(JSON.stringify({
    result: "passed",
    snapshotId: bag.snapshotId,
    definitionId: sold.definitionId,
    objectKey: sold.catalogObjectKey,
    replayed: true,
    staleRejected: true,
    rollback: true,
    effects: { operations: 1, inventoryLedgers: 1, currencyLedgers: 1, audits: 1, outbox: 1 }
  }) + "\n");
} finally {
  await database.close();
}
