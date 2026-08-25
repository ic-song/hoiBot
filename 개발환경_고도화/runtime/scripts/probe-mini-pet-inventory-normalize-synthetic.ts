import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetInventoryViewNormalizeService } from "../src/mini-pet/inventory-view-normalize-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic mini-pet inventory probe is blocked for database: ${config.database.name}`);
}
const database = createDatabaseClient(config.database);
const key = randomUUID().replaceAll("-", "").slice(0, 12);
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const service = new MiniPetInventoryViewNormalizeService(database);

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

async function resetSwapped(): Promise<void> {
  await database.execute("UPDATE mini_pet_inventory_owned_states SET sort_index=NULL WHERE player_id=900000001");
  await database.execute("UPDATE mini_pet_inventory_owned_states SET sort_index=2 WHERE owned_mini_pet_id=900000001");
  await database.execute("UPDATE mini_pet_inventory_owned_states SET sort_index=1 WHERE owned_mini_pet_id=900000011");
  await database.execute("UPDATE mini_pet_inventory_player_states SET bag_shape_code='missing', version=version+1 WHERE player_id=900000001");
}

try {
  const eventId = `minipet-normalize-${key}`;
  await addEvent(eventId);
  const command = { externalUserId, channelId, message: "/미니펫가방", eventId, environmentCode: "dev" as const };
  const repaired = await service.handle(command);
  const replay = await service.handle(command);
  assert.equal(repaired.status, "repaired");
  assert.equal(replay.replayed, true);
  assert.deepEqual(repaired.items?.map((item) => [item.ownedMiniPetId, item.sortIndex]), [["900000001", 1], ["900000011", 2]]);

  const readEventId = `minipet-read-${key}`;
  const read = await service.handle({ ...command, eventId: readEventId });
  assert.equal(read.status, "read");
  const readEffects = await database.query<Array<{ operation_count: bigint; outbox_count: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id
        WHERE operation_row.idempotency_key=?) AS outbox_count`,
    [readEventId, readEventId]
  );
  assert.deepEqual(readEffects[0], { operation_count: 0n, outbox_count: 0n });

  const repairedEffects = await database.query<Array<{
    shape_code: string; first_sort: number; second_sort: number; stable_count: bigint;
    repair_count: bigint; operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT state.bag_shape_code AS shape_code,
      (SELECT sort_index FROM mini_pet_inventory_owned_states WHERE owned_mini_pet_id=900000001) AS first_sort,
      (SELECT sort_index FROM mini_pet_inventory_owned_states WHERE owned_mini_pet_id=900000011) AS second_sort,
      (SELECT COUNT(DISTINCT stable_owned_id) FROM mini_pet_inventory_owned_states WHERE player_id=900000001) AS stable_count,
      (SELECT COUNT(*) FROM mini_pet_inventory_repair_entries entry JOIN operations operation_row ON operation_row.id=entry.operation_id
        WHERE operation_row.idempotency_key=?) AS repair_count,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count,
      (SELECT COUNT(*) FROM command_executions WHERE event_id=? AND command_code='mini_pet_inventory_view_normalize') AS execution_count,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id
        WHERE operation_row.idempotency_key=?) AS audit_count,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id
        WHERE operation_row.idempotency_key=?) AS outbox_count
     FROM mini_pet_inventory_player_states state WHERE state.player_id=900000001`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(repairedEffects[0], {
    shape_code: "array", first_sort: 1, second_sort: 2, stable_count: 2n,
    repair_count: 2n, operation_count: 1n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  await resetSwapped();
  const rollbackEventId = `minipet-rollback-${key}`;
  await addEvent(rollbackEventId);
  await database.execute(
    "CREATE TRIGGER synthetic_minipet_repair_fault BEFORE INSERT ON mini_pet_inventory_repair_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic minipet repair fault'"
  );
  try {
    await assert.rejects(() => service.handle({ ...command, eventId: rollbackEventId }));
  } finally {
    await database.execute("DROP TRIGGER IF EXISTS synthetic_minipet_repair_fault");
  }
  const rollback = await database.query<Array<{ shape_code: string; first_sort: number; second_sort: number; operation_count: bigint }>>(
    `SELECT bag_shape_code AS shape_code,
      (SELECT sort_index FROM mini_pet_inventory_owned_states WHERE owned_mini_pet_id=900000001) AS first_sort,
      (SELECT sort_index FROM mini_pet_inventory_owned_states WHERE owned_mini_pet_id=900000011) AS second_sort,
      (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count
     FROM mini_pet_inventory_player_states WHERE player_id=900000001`,
    [rollbackEventId]
  );
  assert.deepEqual(rollback[0], { shape_code: "missing", first_sort: 2, second_sort: 1, operation_count: 0n });

  const recoveryEventId = `minipet-recovery-${key}`;
  await addEvent(recoveryEventId);
  const recovery = await service.handle({ ...command, eventId: recoveryEventId });
  assert.equal(recovery.status, "repaired");
  process.stdout.write(`${JSON.stringify({
    database: config.database.name, eventId, recoveryEventId,
    repaired: true, replayed: true, readMutationZero: true, rollback: true,
    effects: { repairEntries: 2, operation: 1, execution: 1, audit: 1, outbox: 1 },
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
