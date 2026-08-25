import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { YakitoriPackageUseService } from "../src/mini-pet/yakitori-package-use-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic yakitori probe is blocked for database: ${config.database.name}`);
}
const database = createDatabaseClient(config.database);
const key = randomUUID().replaceAll("-", "").slice(0, 12);
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

async function addEvent(eventId: string): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
       external_user_id, external_identity_id, event_kind, event_origin, direction,
       payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
       REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId, channelId, externalUserId]
  );
}

try {
  const eventId = `yakitori-open-${key}`;
  await addEvent(eventId);
  const service = new YakitoriPackageUseService(database);
  const command = { externalUserId, channelId, message: "/이랏싸이마쎄", eventId, environmentCode: "dev" as const };
  const result = await service.handle(command);
  const replay = await service.handle(command);
  assert.equal(result.status, "opened");
  assert.equal(replay.replayed, true);
  assert.equal(result.packageQuantity, "0");
  assert.equal(result.ticketQuantity, "1500");
  assert.equal(result.ownedMiniPetIds?.length, 10);
  assert.equal(new Set(result.stableOwnedIds).size, 10);

  const effects = await database.query<Array<{
    package_quantity: bigint; ticket_quantity: bigint; reward_count: bigint; owned_count: bigint;
    operation_count: bigint; ledger_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT
       COALESCE((SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
         WHERE stack.player_id=900000001 AND item.code='bag_yakitori_package_10'), 0) AS package_quantity,
       COALESCE((SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
         WHERE stack.player_id=900000001 AND item.code='bag_3241894752b82f7a'), 0) AS ticket_quantity,
       (SELECT COUNT(*) FROM yakitori_package_owned_rewards reward JOIN operations operation_row ON operation_row.id=reward.operation_id
         WHERE operation_row.idempotency_key=?) AS reward_count,
       (SELECT COUNT(*) FROM owned_mini_pets owned JOIN yakitori_package_owned_rewards reward ON reward.owned_mini_pet_id=owned.id
         JOIN operations operation_row ON operation_row.id=reward.operation_id WHERE operation_row.idempotency_key=?) AS owned_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id
         WHERE operation_row.idempotency_key=?) AS ledger_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id=? AND command_code='yakitori_package_use') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id
         WHERE operation_row.idempotency_key=?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id
         WHERE operation_row.idempotency_key=?) AS outbox_count`,
    [eventId, eventId, eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual({
    ...effects[0],
    package_quantity: BigInt(effects[0]!.package_quantity),
    ticket_quantity: BigInt(effects[0]!.ticket_quantity)
  }, {
    package_quantity: 0n, ticket_quantity: 1500n, reward_count: 10n, owned_count: 10n,
    operation_count: 1n, ledger_count: 2n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  await database.execute(
    `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
     SELECT 900000001, id, 1, 1 FROM item_definitions WHERE code='bag_yakitori_package_10'
     ON DUPLICATE KEY UPDATE quantity=1, version=inventory_stacks.version+1`
  );
  await database.execute(
    `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
     SET stack.quantity=0, stack.version=stack.version+1
     WHERE stack.player_id=900000001 AND item.code='bag_3241894752b82f7a'`
  );
  const rollbackEventId = `yakitori-rollback-${key}`;
  await addEvent(rollbackEventId);
  await database.execute(
    "CREATE TRIGGER synthetic_yakitori_fault BEFORE INSERT ON owned_mini_pets FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic yakitori fault'"
  );
  try {
    await assert.rejects(() => service.handle({ ...command, eventId: rollbackEventId }));
  } finally {
    await database.execute("DROP TRIGGER IF EXISTS synthetic_yakitori_fault");
  }
  const rollback = await database.query<Array<{ package_quantity: bigint; ticket_quantity: bigint; operation_count: bigint }>>(
    `SELECT
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
       WHERE stack.player_id=900000001 AND item.code='bag_yakitori_package_10') AS package_quantity,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
       WHERE stack.player_id=900000001 AND item.code='bag_3241894752b82f7a') AS ticket_quantity,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count`,
    [rollbackEventId]
  );
  assert.deepEqual({
    ...rollback[0],
    package_quantity: BigInt(rollback[0]!.package_quantity),
    ticket_quantity: BigInt(rollback[0]!.ticket_quantity)
  }, { package_quantity: 1n, ticket_quantity: 0n, operation_count: 0n });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, eventId, playerId: result.playerId, rewardVersion: "yakitori-eccd437-v1",
    effects: { rewards: 10, owned: 10, ledger: 2, operation: 1, execution: 1, audit: 1, outbox: 1 },
    replayed: true, rollback: true, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
