import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { PetRenameTicketCraftService } from "../src/pet/pet-rename-ticket-craft-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet-rename-ticket craft probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const runKey = randomUUID().replaceAll("-", "").slice(0, 12);
const eventId = `pet-rename-ticket-craft-${runKey}`;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  await database.withTransaction(async (transaction) => {
    await transaction.execute(
      "UPDATE currency_accounts SET balance = 200000000, version = version + 1 WHERE player_id = 900000001 AND currency_code = 'point'"
    );
    await transaction.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       SET stack.quantity = CASE item.code WHEN 'legacy-junk-item' THEN 20 WHEN 'legacy-pet-name-change-ticket' THEN 2 END,
           stack.version = stack.version + 1
       WHERE stack.player_id = 900000001 AND item.code IN ('legacy-junk-item', 'legacy-pet-name-change-ticket')`
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

  const service = new PetRenameTicketCraftService(database);
  const command = { externalUserId, channelId, message: "/펫이름조합", eventId };
  const result = await service.handle(command);
  const replay = await service.handle(command);
  assert.deepEqual(replay, result);
  assert.equal(result.status, "crafted");
  assert.deepEqual({ junk: result.junkQuantity, point: result.pointBalance, ticket: result.ticketQuantity },
    { junk: "10", point: "100000000", ticket: "3" });
  assert.equal(result.data, "행복주민센터에서 [테스트알파] 님께\n펫 이름변경권🎫을 주었습니다.\n사용법: /펫이름 [변경할이름(6자)]");

  const rows = await database.query<Array<{
    point_balance: string;
    junk_quantity: bigint;
    ticket_quantity: bigint;
    inventory_ledger_count: bigint;
    currency_ledger_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT CAST(account.balance AS CHAR) AS point_balance,
       MAX(CASE WHEN item.code = 'legacy-junk-item' THEN stack.quantity END) AS junk_quantity,
       MAX(CASE WHEN item.code = 'legacy-pet-name-change-ticket' THEN stack.quantity END) AS ticket_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'pet.rename-ticket.craft:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'pet.rename-ticket.craft:900000004' AND operation_row.idempotency_key = ?) AS currency_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'pet.rename-ticket.craft:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'pet_rename_ticket_craft') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'pet.rename-ticket.craft:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'pet.rename-ticket.craft:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM currency_accounts account
     JOIN inventory_stacks stack ON stack.player_id = account.player_id
     JOIN item_definitions item ON item.id = stack.item_id
     WHERE account.player_id = 900000001 AND account.currency_code = 'point'
       AND item.code IN ('legacy-junk-item', 'legacy-pet-name-change-ticket')
     GROUP BY account.balance`,
    [eventId, eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    point_balance: "100000000.000", junk_quantity: 10n, ticket_quantity: 3n,
    inventory_ledger_count: 2n, currency_ledger_count: 1n, operation_count: 1n,
    execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, playerId: result.playerId,
    balances: { junk: result.junkQuantity, point: result.pointBalance, ticket: result.ticketQuantity },
    effects: { inventoryLedger: 2, currencyLedger: 1, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
