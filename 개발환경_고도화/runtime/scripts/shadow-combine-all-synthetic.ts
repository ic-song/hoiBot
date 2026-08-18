import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic combine-all Shadow is blocked for database: ${config.database.name}`);
}

const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.COMBINE_ALL_SHADOW_EVENT_ID
  ?? `combine-all-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
if (verifyRestart && process.env.COMBINE_ALL_SHADOW_EVENT_ID === undefined) {
  throw new Error("COMBINE_ALL_SHADOW_EVENT_ID is required with --verify-restart.");
}
const commands = [
  { message: "/전체조합", variant: "primary", commandCode: "combine_all", providerEventId: `${baseEventId}-primary` },
  { message: "/전체조합2", variant: "secondary", commandCode: "combine_all_2", providerEventId: `${baseEventId}-secondary` }
] as const;
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

// 공용 catalog의 두 stack을 각 entrypoint 실행 전에 같은 합성 상태로 되돌립니다.
async function resetSpiritStacks() {
  await database.execute(
    `INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES
       (900000001, 910000020, 20, 1),
       (900000001, 910000021, 5, 1)
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = version + 1`
  );
}

// 실제 Iris HTTP adapter 경로로 한 명령을 전송합니다.
async function dispatch(entry: typeof commands[number]) {
  return app.inject({
    method: "POST",
    url: "/api/v1/integrations/iris/events",
    headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: {
      msg: entry.message,
      room: "합성 전체조합 Shadow 방",
      sender: "테스트알파",
      json: { id: entry.providerEventId, chat_id: channelId, user_id: externalUserId, type: 1 }
    }
  });
}

try {
  for (const entry of commands) {
    if (!verifyRestart) await resetSpiritStacks();
    const first = await dispatch(entry);
    assert.equal(first.statusCode, 202);
    assert.equal(first.json().duplicate, verifyRestart);
    if (!verifyRestart) {
      assert.deepEqual(replies.at(-1), { room: channelId, data: "🛠️ 전체 조합 결과\n- 정령 강화석🥀 x 2" });
      const duplicate = await dispatch(entry);
      assert.equal(duplicate.statusCode, 202);
      assert.equal(duplicate.json().duplicate, true);
    }
  }
  assert.equal(replies.length, verifyRestart ? 0 : 2);

  const effects: Record<string, unknown> = {};
  for (const entry of commands) {
    const eventId = `iris:${entry.providerEventId}`;
    const scope = `craft.combine-all.${entry.variant}:900000004`;
    const rows = await database.query<Array<{
      operation_count: bigint; ledger_count: bigint; execution_count: bigint;
      audit_count: bigint; outbox_count: bigint; sent_count: bigint; delivery_count: bigint;
    }>>(
      `SELECT
         (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?) AS operation_count,
         (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
           WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS ledger_count,
         (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = ?) AS execution_count,
         (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
           WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS audit_count,
         (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
           WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS outbox_count,
         (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
           WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ? AND outbox.status = 'sent') AS sent_count,
         (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id
           JOIN operations operation_row ON operation_row.id = outbox.operation_id
           WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS delivery_count`,
      [scope, eventId, scope, eventId, eventId, entry.commandCode, scope, eventId, scope, eventId, scope, eventId, scope, eventId]
    );
    assert.deepEqual(rows[0], {
      operation_count: 1n, ledger_count: 2n, execution_count: 1n,
      audit_count: 1n, outbox_count: 1n, sent_count: 1n, delivery_count: 1n
    });
    effects[entry.variant] = { operation: 1, ledger: 2, execution: 1, audit: 1, outbox: 1, delivery: 1 };
  }

  const balances = await database.query<Array<{ fragment_stack_count: bigint; stone_quantity: bigint }>>(
    `SELECT
       SUM(CASE WHEN item.code = 'bag_9b3e69dbd2e91260' THEN 1 ELSE 0 END) AS fragment_stack_count,
       MAX(CASE WHEN item.code = 'bag_55b34cbde0088b29' THEN stack.quantity END) AS stone_quantity
     FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = 900000001 AND item.code IN ('bag_9b3e69dbd2e91260', 'bag_55b34cbde0088b29')`
  );
  assert.equal(Number(balances[0]?.fragment_stack_count), 0);
  assert.equal(balances[0]?.stone_quantity, 7n);

  process.stdout.write(`${JSON.stringify({
    mode: verifyRestart ? "verify-restart" : "shadow",
    database: config.database.name,
    baseEventId,
    commands: commands.map((entry) => entry.message),
    balances: { fragmentStackCount: 0, stones: 7 },
    effects,
    dispatch: true,
    duplicateSuppressed: true,
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await app.close();
}
