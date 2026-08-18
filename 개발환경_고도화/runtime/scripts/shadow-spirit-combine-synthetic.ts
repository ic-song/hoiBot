import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic spirit-combine Shadow is blocked for database: ${config.database.name}`);
}

const verifyRestart = process.argv.includes("--verify-restart");
const providerEventId = process.env.SPIRIT_COMBINE_SHADOW_EVENT_ID
  ?? `spirit-shadow-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
if (verifyRestart && process.env.SPIRIT_COMBINE_SHADOW_EVENT_ID === undefined) {
  throw new Error("SPIRIT_COMBINE_SHADOW_EVENT_ID is required with --verify-restart.");
}
const eventId = `iris:${providerEventId}`;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const database = createDatabaseClient(config.database);
const replies: Array<{ room: string; data: string }> = [];
const app = buildApp(config, {
  database,
  inspectIrisChannel: async () => ({
    mode: "operational",
    channelClass: "open_group",
    reason: "allowed",
    evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false }
  }),
  sendIrisTextReply: async (reply) => { replies.push(reply); }
});

const payload = {
  msg: "/정령조합 2",
  room: "합성 Shadow 방",
  sender: "테스트알파",
  json: { id: providerEventId, chat_id: channelId, user_id: externalUserId, type: 1 }
};

try {
  if (!verifyRestart) {
    await database.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       SET stack.quantity = CASE item.code WHEN 'bag_9b3e69dbd2e91260' THEN 20 WHEN 'bag_55b34cbde0088b29' THEN 5 END,
           stack.version = stack.version + 1
       WHERE stack.player_id = 900000001 AND item.code IN ('bag_9b3e69dbd2e91260', 'bag_55b34cbde0088b29')`
    );
  }

  const first = await app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events",
    headers: { authorization: `Bearer ${config.irisSharedToken}` }, payload
  });
  assert.equal(first.statusCode, 202);
  assert.equal(first.json().duplicate, verifyRestart);
  if (!verifyRestart) {
    assert.deepEqual(replies, [{ room: channelId, data: "2개를 조합합니다\n[테스트알파] 님\n정령 강화석🥀 조합 2개 완성" }]);
    const duplicate = await app.inject({
      method: "POST", url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${config.irisSharedToken}` }, payload
    });
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().duplicate, true);
    assert.equal(replies.length, 1);
  } else {
    assert.equal(replies.length, 0);
  }

  const rows = await database.query<Array<{
    fragment_quantity: bigint; stone_quantity: bigint; operation_count: bigint; inventory_ledger_count: bigint;
    execution_count: bigint; audit_count: bigint; outbox_count: bigint; sent_count: bigint; delivery_count: bigint;
  }>>(
    `SELECT
       MAX(CASE WHEN item.code = 'bag_9b3e69dbd2e91260' THEN stack.quantity END) AS fragment_quantity,
       MAX(CASE WHEN item.code = 'bag_55b34cbde0088b29' THEN stack.quantity END) AS stone_quantity,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'craft.spirit-combine:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'spirit_combine') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ?) AS outbox_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ? AND outbox.status = 'sent') AS sent_count,
       (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id
         JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'craft.spirit-combine:900000004' AND operation_row.idempotency_key = ?) AS delivery_count
     FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001 AND item.code IN ('bag_9b3e69dbd2e91260', 'bag_55b34cbde0088b29')`,
    [eventId, eventId, eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    fragment_quantity: 0n, stone_quantity: 7n, operation_count: 1n, inventory_ledger_count: 2n,
    execution_count: 1n, audit_count: 1n, outbox_count: 1n, sent_count: 1n, delivery_count: 1n
  });
  process.stdout.write(`${JSON.stringify({
    mode: verifyRestart ? "verify-restart" : "shadow", database: config.database.name,
    providerEventId, eventId, balances: { fragments: 0, stones: 7 },
    effects: { operation: 1, inventoryLedger: 2, execution: 1, audit: 1, outbox: 1, delivery: 1 },
    dispatch: true, duplicateSuppressed: true, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await app.close();
}
