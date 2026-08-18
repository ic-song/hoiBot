import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { BagAddService } from "../src/inventory/bag-add-service.js";
import { MariaBagAddRepository } from "../src/inventory/maria-bag-add-repository.js";
import { InventorySnapshotService } from "../src/inventory/inventory-snapshot-service.js";
import { MariaInventorySnapshotRepository } from "../src/inventory/maria-inventory-snapshot-repository.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic bag-mutate probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const runKey = process.env.PROBE_RUN_KEY ?? randomUUID().replaceAll("-", "").slice(0, 12);
if (!/^[a-z0-9]{6,32}$/i.test(runKey)) throw new Error("PROBE_RUN_KEY must be 6-32 alphanumeric characters.");
const bagEventId = `bag-add-${runKey}`;
const snapshotEventId = `inventory-snapshot-${runKey}`;

async function insertEvent(eventId: string): Promise<void> {
  await database.execute(
    `INSERT IGNORE INTO event_inbox
      (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
       external_user_id, external_identity_id, event_kind, event_origin, direction,
       payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, 'synthetic-room-001', 900000001, 'synthetic-admin-alpha', 900000004,
       'message', 'synthetic_probe', 'incoming', REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId]
  );
}

try {
  await insertEvent(bagEventId);
  await insertEvent(snapshotEventId);
  const itemName = `합성 가방추가 ${runKey}`;
  const bagCommand = {
    externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001",
    message: `/가방추가 테스트알파, ${itemName} 3`, eventId: bagEventId
  };
  const bagService = new BagAddService(new MariaBagAddRepository(database));
  const added = await bagService.handle(bagCommand);
  assert.deepEqual(await bagService.handle(bagCommand), added);
  assert.equal(added.status, "added");
  assert.equal(added.quantity, "3");
  assert.equal(added.quantityDelta, "3");

  const snapshotCommand = {
    externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001",
    message: "/소지품저장", eventId: snapshotEventId
  };
  const snapshotService = new InventorySnapshotService(new MariaInventorySnapshotRepository(database));
  const snapshot = await snapshotService.handle(snapshotCommand);
  assert.deepEqual(await snapshotService.handle(snapshotCommand), snapshot);
  assert.equal(snapshot.status, "saved");
  assert.match(snapshot.contentHash!, /^[a-f0-9]{64}$/);

  const effects = await database.query<Array<{
    bag_operations: bigint; bag_ledgers: bigint; bag_audits: bigint; bag_outbox: bigint;
    snapshot_operations: bigint; snapshot_rows: bigint; snapshot_entries: bigint; snapshot_audits: bigint; snapshot_outbox: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'inventory.bag_add:900000001' AND idempotency_key = ?) bag_operations,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
        WHERE operation_row.idempotency_scope = 'inventory.bag_add:900000001' AND operation_row.idempotency_key = ?) bag_ledgers,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
        WHERE operation_row.idempotency_scope = 'inventory.bag_add:900000001' AND operation_row.idempotency_key = ?) bag_audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
        WHERE operation_row.idempotency_scope = 'inventory.bag_add:900000001' AND operation_row.idempotency_key = ?) bag_outbox,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'inventory.snapshot:900000001' AND idempotency_key = ?) snapshot_operations,
      (SELECT COUNT(*) FROM inventory_snapshots snapshot JOIN operations operation_row ON operation_row.id = snapshot.operation_id
        WHERE operation_row.idempotency_scope = 'inventory.snapshot:900000001' AND operation_row.idempotency_key = ?) snapshot_rows,
      (SELECT COUNT(*) FROM inventory_snapshot_entries WHERE snapshot_id = ?) snapshot_entries,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
        WHERE operation_row.idempotency_scope = 'inventory.snapshot:900000001' AND operation_row.idempotency_key = ?) snapshot_audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
        WHERE operation_row.idempotency_scope = 'inventory.snapshot:900000001' AND operation_row.idempotency_key = ?) snapshot_outbox`,
    [bagEventId, bagEventId, bagEventId, bagEventId, snapshotEventId, snapshotEventId, snapshot.snapshotId, snapshotEventId, snapshotEventId]
  );
  assert.deepEqual(effects[0], {
    bag_operations: 1n, bag_ledgers: 1n, bag_audits: 1n, bag_outbox: 1n,
    snapshot_operations: 1n, snapshot_rows: 1n, snapshot_entries: BigInt(snapshot.itemCount!), snapshot_audits: 1n, snapshot_outbox: 1n
  });
  process.stdout.write(JSON.stringify({
    database: config.database.name, bagAdd: { playerId: added.playerId, itemCode: added.itemCode, quantity: added.quantity },
    snapshot: { snapshotId: snapshot.snapshotId, playerCount: snapshot.playerCount, itemCount: snapshot.itemCount, contentHash: snapshot.contentHash },
    idempotent: true, restartSafeOutbox: true, operationalSnapshotTouched: false
  }) + "\n");
} finally {
  await database.close();
}
