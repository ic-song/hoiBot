import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { PetRenameService } from "../src/pet/pet-rename-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet-rename probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const runKey = randomUUID().replaceAll("-", "").slice(0, 12);
const eventId = `pet-rename-${runKey}`;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  await database.withTransaction(async (transaction) => {
    await transaction.execute(
      "UPDATE player_pets SET display_name = '합성펫알파', version = version + 1 WHERE player_id = 900000001"
    );
    await transaction.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       SET stack.quantity = 2, stack.version = stack.version + 1
       WHERE stack.player_id = 900000001 AND item.code = 'legacy-pet-name-change-ticket'`
    );
  });

  await assert.rejects(
    () => new PetRenameService(database).handle({ externalUserId, channelId, message: "/펫이름 새이름 안내", eventId }),
    (error: unknown) => error instanceof ApplicationError && error.code === "INVALID_PET_RENAME_COMMAND"
  );

  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
       external_user_id, external_identity_id, event_kind, event_origin, direction,
       payload_hash, parse_status, processing_status, received_at)
     VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
       REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId, channelId, externalUserId]
  );

  const service = new PetRenameService(database);
  const command = { externalUserId, channelId, message: "/펫이름 새알파", eventId };
  const result = await service.handle(command);
  const replay = await service.handle(command);
  assert.deepEqual(replay, result);
  assert.equal(result.status, "renamed");
  assert.equal(result.petName, "새알파");
  assert.equal(result.ticketQuantity, "1");
  assert.equal(result.data, "펫이름 변경이 완료되었습니다.");

  const rows = await database.query<Array<{
    pet_name: string;
    ticket_quantity: bigint;
    ledger_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT pet.display_name AS pet_name, stack.quantity AS ticket_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'pet.rename:900000004' AND ledger.quantity_delta = -1
           AND operation_row.idempotency_key = ? AND ledger.reason_code = 'pet_rename_ticket_used') AS ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'pet.rename:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'pet_rename') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'pet.rename:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'pet.rename:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM player_pets pet
     JOIN inventory_stacks stack ON stack.player_id = pet.player_id
     JOIN item_definitions item ON item.id = stack.item_id AND item.code = 'legacy-pet-name-change-ticket'
     WHERE pet.player_id = 900000001`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    pet_name: "새알파", ticket_quantity: 1n, ledger_count: 1n,
    operation_count: 1n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, playerId: result.playerId, petName: result.petName,
    ticketQuantity: result.ticketQuantity,
    effects: { ledger: 1, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
