import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
const database = createDatabaseClient(config.database);
const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.ADVANCED_TIER_SHADOW_EVENT_ID ?? `advanced-tier-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
if (verifyRestart && process.env.ADVANCED_TIER_SHADOW_EVENT_ID === undefined) throw new Error("ADVANCED_TIER_SHADOW_EVENT_ID is required with --verify-restart.");
const replies: string[] = [];
const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply.data); } });

// 실제 Iris endpoint로 합성 명령 이벤트를 전송합니다.
async function dispatch(providerEventId: string, message = "/고급티켓조합 2") {
  return app.inject({ method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${config.irisSharedToken}` }, payload: { msg: message, room: "합성 고급티켓 Shadow 방", sender: "테스트알파", json: { id: providerEventId, chat_id: "synthetic-room-001", user_id: "synthetic-admin-alpha", type: 1 } } });
}

try {
  const codes = ["tier_promotion_ticket", "legendary_stone", "pet_enhance_stone", "advanced_tier_promotion_ticket"];
  const normalEvent = `${baseEventId}-normal`;
  if (!verifyRestart) {
    await database.execute(`DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = 900000001 AND item.code IN (?, ?, ?, ?)`, codes);
    for (const [code, quantity] of [[codes[0], 3_050n], [codes[1], 4n], [codes[2], 300n]] as Array<[string, bigint]>) await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) SELECT 900000001, id, ?, 1 FROM item_definitions WHERE code = ?", [quantity, code]);
    const normal = await dispatch(normalEvent); assert.equal(normal.statusCode, 202); assert.match(replies.at(-1) ?? "", /고급 티어 승급티켓.*2개/);
    const duplicate = await dispatch(normalEvent); assert.equal(duplicate.json().duplicate, true); assert.equal(replies.length, 1);
    const suffix = await dispatch(`${baseEventId}-suffix`, "/고급티켓조합 2 안내"); assert.equal(suffix.statusCode, 202); assert.equal(replies.length, 1);
  } else {
    const replay = await dispatch(normalEvent); assert.equal(replay.json().duplicate, true); assert.equal(replies.length, 0);
  }
  const key = `iris:${normalEvent}`;
  const effects = await database.query<Array<{ operations: bigint; executions: bigint; ledgers: bigint; audits: bigint; outbox: bigint; deliveries: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_key = ?) AS operations,
    (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'advanced_tier_ticket_craft') AS executions,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = ?) AS ledgers,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key = ?) AS audits,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?) AS outbox,
    (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?) AS deliveries`, [key, key, key, key, key, key]);
  assert.deepEqual(effects[0], { operations: 1n, executions: 1n, ledgers: 4n, audits: 1n, outbox: 1n, deliveries: 1n });
  process.stdout.write(`${JSON.stringify({ mode: verifyRestart ? "verify-restart" : "shadow", baseEventId, effects: effects[0], operationalSnapshotTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally { await app.close(); }
