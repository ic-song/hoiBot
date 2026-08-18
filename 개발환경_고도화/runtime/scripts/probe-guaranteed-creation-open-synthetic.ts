import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GuaranteedCreationOpenService } from "../src/mini-pet/guaranteed-creation-open-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic guaranteed creation open probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = "guaranteed-creation-open-tekxp2";
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
           AND definition_row.code = 'mini_pet_4c88c9497b1022a1'`
      );
      await transaction.execute(
        `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
         SELECT 900000001, id, 1, 1 FROM item_definitions WHERE code = 'bag_a0f887c7ace600cd'
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

  const service = new GuaranteedCreationOpenService(database);
  const command = { externalUserId, channelId, message: "/창조오픈", eventId };
  const result = await service.handle(command);
  assert.deepEqual(await service.handle(command), result);
  assert.deepEqual({ status: result.status, package: result.packageQuantity }, { status: "opened", package: "0" });
  assert.equal(result.data, "🐹 창조패키지 확정 오픈!\n\n호이빛💖(+1350000💕)[창조]을(를) 획득했습니다.");

  const rows = await database.query<Array<{
    package_quantity: bigint;
    mini_pet_count: bigint;
    battle_experience: bigint;
    castle_experience: bigint;
    raid_experience: bigint;
    inventory_ledger_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT
       MAX(stack.quantity) AS package_quantity,
       (SELECT COUNT(*) FROM owned_mini_pets owned JOIN mini_pet_definitions definition_row
         ON definition_row.id = owned.mini_pet_definition_id
         WHERE owned.player_id = 900000001 AND owned.equipped = FALSE
           AND definition_row.code = 'mini_pet_4c88c9497b1022a1') AS mini_pet_count,
       (SELECT MAX(owned.battle_experience) FROM owned_mini_pets owned JOIN mini_pet_definitions definition_row
         ON definition_row.id = owned.mini_pet_definition_id
         WHERE owned.player_id = 900000001 AND definition_row.code = 'mini_pet_4c88c9497b1022a1') AS battle_experience,
       (SELECT MAX(owned.castle_experience) FROM owned_mini_pets owned JOIN mini_pet_definitions definition_row
         ON definition_row.id = owned.mini_pet_definition_id
         WHERE owned.player_id = 900000001 AND definition_row.code = 'mini_pet_4c88c9497b1022a1') AS castle_experience,
       (SELECT MAX(owned.raid_experience) FROM owned_mini_pets owned JOIN mini_pet_definitions definition_row
         ON definition_row.id = owned.mini_pet_definition_id
         WHERE owned.player_id = 900000001 AND definition_row.code = 'mini_pet_4c88c9497b1022a1') AS raid_experience,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'mini-pet.guaranteed-creation-open:900000004'
           AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.guaranteed-creation-open:900000004'
         AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'guaranteed_creation_open') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'mini-pet.guaranteed-creation-open:900000004'
           AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'mini-pet.guaranteed-creation-open:900000004'
           AND operation_row.idempotency_key = ?) AS outbox_count
     FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001 AND item.code = 'bag_a0f887c7ace600cd'`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    package_quantity: 0n,
    mini_pet_count: 1n,
    battle_experience: 1350000n,
    castle_experience: 1350000n,
    raid_experience: 1350000n,
    inventory_ledger_count: 1n,
    operation_count: 1n,
    execution_count: 1n,
    audit_count: 1n,
    outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name,
    playerId: result.playerId,
    balances: { package: result.packageQuantity, miniPet: "1" },
    reward: { name: "호이빛", grade: "창조", battleExp: "1350000", castleExp: "1350000", raidExp: "1350000" },
    effects: { inventoryLedger: 1, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true,
    restartSafeReplay: !prepare,
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
